import { prisma } from "../db";
import { parseTags } from "../entries";
import { pickName } from "../instances";
import { buildContext } from "../modules/context";
import { getActiveInstances } from "../modules/registry";
import type { JsonSchemaLite } from "../modules/types";
import { uniqueSlug } from "../entries";
import { createEntry } from "../services";
import { getSetting, getSiteConfig } from "../settings";
import { slugify } from "../slug";
import { isSafeExternalUrl } from "../url";
import { McpToolError, validateArgs } from "./validate";

export type McpActor = { name: string };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: JsonSchemaLite;
  /** Instance (ou "core") qui fournit l'outil — affiché dans l'admin. */
  source: string;
  call: (args: Record<string, unknown>, actor: McpActor) => Promise<unknown>;
};

const str = (max = 2000) => ({ type: "string" as const, maxLength: max });

/** Clé du réglage qui retire une instance de l'API MCP (case « Exposer ses actions MCP »). */
export const mcpInstanceKey = (instanceId: string) => `instance.${instanceId}.__mcp`;

/**
 * Registre des outils MCP : le cœur collecte les actions déclarées par TOUS les modules actifs
 * (`mcp` du manifeste + `mcp` du code) et ajoute, pour chaque instance à contenu, un jeu d'actions
 * éditoriales génériques. Garde-fous non négociables : aucun outil ne publie, aucun ne supprime.
 */
export async function buildTools(): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  const config = await getSiteConfig();
  const active = await getActiveInstances();

  tools.push({
    name: "site_info",
    title: "Site info",
    description: "Name, languages and the list of module instances of this site (with the MCP tools each one offers).",
    readOnly: true,
    input: { type: "object" },
    source: "core",
    call: async () => ({
      name: config.name,
      defaultLocale: config.defaultLocale,
      locales: config.locales,
      instances: active.map(({ instance, mod }) => ({
        key: instance.key,
        module: mod.manifest.id,
        name: pickName(instance, config.defaultLocale, config.defaultLocale),
        path: instance.basePath,
        hasEntries: !!mod.manifest.content,
      })),
    }),
  });

  for (const { instance, mod } of active) {
    if ((await getSetting<boolean>(mcpInstanceKey(instance.id))) === false) continue;
    const label = pickName(instance, "en", config.defaultLocale);
    const ctxFor = () => buildContext(mod, instance, config.defaultLocale);

    // 1. Actions déclarées par le module.
    for (const decl of mod.manifest.mcp ?? []) {
      const handler = mod.def.mcp?.[decl.name];
      if (!handler) continue;
      tools.push({
        name: `${instance.key}__${decl.name}`,
        title: `${label}: ${decl.name}`,
        description: `[${label}] ${decl.description}`,
        readOnly: decl.readOnly === true,
        input: decl.input ?? { type: "object" },
        source: instance.key,
        call: async (args, actor) => handler(await ctxFor(), validateArgs(decl.input, args), actor),
      });
    }

    // 2. Actions éditoriales générées pour toute instance à contenu (sauf si le module définit les siennes).
    if (mod.manifest.content) {
      const taken = new Set(tools.map((t) => t.name));
      const add = (t: Omit<McpTool, "source" | "title"> & { title?: string }) => {
        if (!taken.has(t.name)) tools.push({ title: `${label}: ${t.name.split("__")[1]}`, source: instance.key, ...t });
      };
      const locales = config.locales;

      add({
        name: `${instance.key}__list_entries`,
        description: `[${label}] List entries (id, title, status, summary, link, code, tags). Default: published only.`,
        readOnly: true,
        input: { type: "object", properties: { status: { type: "string", enum: ["published", "draft", "all"] }, locale: { type: "string", enum: locales }, limit: { type: "integer", minimum: 1, maximum: 100 } } },
        call: async (raw) => {
          const a = validateArgs(tools.find((x) => x.name === `${instance.key}__list_entries`)?.input, raw);
          const locale = (a.locale as string) ?? config.defaultLocale;
          const status = (a.status as string) ?? "published";
          const rows = await prisma.entry.findMany({
            where: { instanceId: instance.id, ...(status === "all" ? {} : { status }) },
            include: { translations: true },
            orderBy: { createdAt: "desc" },
            take: (a.limit as number) ?? 30,
          });
          return rows.map((e) => {
            const tr = e.translations.find((x) => x.locale === locale) ?? e.translations[0];
            return { id: e.id, status: e.status, title: tr?.title, locale: tr?.locale, languages: e.translations.map((x) => x.locale), summary: tr?.summary || undefined, url: e.url ?? undefined, code: e.code ?? undefined, tags: parseTags(e.tags), publishedAt: e.publishedAt?.toISOString() };
          });
        },
      });

      add({
        name: `${instance.key}__get_entry`,
        description: `[${label}] Read one entry with its full text.`,
        readOnly: true,
        input: { type: "object", required: ["id"], properties: { id: str(60), locale: { type: "string", enum: locales } } },
        call: async (raw) => {
          const a = validateArgs({ type: "object", required: ["id"], properties: { id: str(60), locale: { type: "string", enum: locales } } }, raw);
          const e = await prisma.entry.findFirst({ where: { id: a.id as string, instanceId: instance.id }, include: { translations: true } });
          if (!e) throw new McpToolError("entry not found");
          const tr = e.translations.find((x) => x.locale === ((a.locale as string) ?? config.defaultLocale)) ?? e.translations[0];
          return { id: e.id, status: e.status, locale: tr?.locale, title: tr?.title, summary: tr?.summary, body: tr?.body, url: e.url, code: e.code, tags: parseTags(e.tags), languages: e.translations.map((x) => x.locale) };
        },
      });

      const draftProps = { title: str(300), summary: str(2000), body: str(50000), url: str(2000), code: str(200), tags: { type: "array" as const, items: { type: "string" as const } }, locale: { type: "string" as const, enum: locales } };
      add({
        name: `${instance.key}__create_draft`,
        description: `[${label}] Create a DRAFT entry. It is never published automatically: a human reviews and publishes it in the admin.`,
        readOnly: false,
        input: { type: "object", required: ["title"], properties: draftProps },
        call: async (raw, actor) => {
          const a = validateArgs({ type: "object", required: ["title"], properties: draftProps }, raw);
          if (a.url && !isSafeExternalUrl(a.url as string)) throw new McpToolError("url must be http(s) or mailto");
          const entry = await createEntry(prisma, {
            instanceId: instance.id,
            locale: (a.locale as string) ?? config.defaultLocale,
            title: a.title as string,
            summary: a.summary as string | undefined,
            body: a.body as string | undefined,
            url: a.url as string | undefined,
            code: a.code as string | undefined,
            tags: ((a.tags as string[]) ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
            status: "draft",
          });
          await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, action: "entry.create", target: `${instance.key}/${entry.id}` } });
          return { id: entry.id, status: "draft", note: "Draft created. A human must publish it from the admin." };
        },
      });

      add({
        name: `${instance.key}__update_draft`,
        description: `[${label}] Edit a DRAFT entry (or add a language version to it). Published entries cannot be changed through MCP.`,
        readOnly: false,
        input: { type: "object", required: ["id"], properties: { id: str(60), ...draftProps, title: str(300) } },
        call: async (raw, actor) => {
          const props = { id: str(60), ...draftProps };
          const a = validateArgs({ type: "object", required: ["id"], properties: props }, raw);
          const entry = await prisma.entry.findFirst({ where: { id: a.id as string, instanceId: instance.id }, include: { translations: true } });
          if (!entry) throw new McpToolError("entry not found");
          if (entry.status !== "draft") throw new McpToolError("only drafts can be edited through MCP; this entry is published");
          if (a.url && !isSafeExternalUrl(a.url as string)) throw new McpToolError("url must be http(s) or mailto");
          const locale = (a.locale as string) ?? entry.sourceLocale;
          await prisma.entry.update({ where: { id: entry.id }, data: { url: (a.url as string) ?? entry.url, code: (a.code as string) ?? entry.code, ...(a.tags ? { tags: JSON.stringify((a.tags as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean)) } : {}) } });
          const existing = entry.translations.find((x) => x.locale === locale);
          if (!existing && !a.title) throw new McpToolError("a title is required to add a new language version");
          const title = (a.title as string) ?? existing!.title;
          await prisma.entryTranslation.upsert({
            where: { entryId_locale: { entryId: entry.id, locale } },
            create: { entryId: entry.id, instanceId: instance.id, locale, slug: await uniqueSlug(prisma, instance.id, locale, slugify(title), entry.id), title, summary: (a.summary as string) ?? "", body: (a.body as string) ?? "" },
            update: { title, ...(a.summary !== undefined ? { summary: a.summary as string } : {}), ...(a.body !== undefined ? { body: a.body as string } : {}) },
          });
          await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, action: "entry.update", target: `${instance.key}/${entry.id}` } });
          return { id: entry.id, status: "draft", locale };
        },
      });
    }
  }
  return tools;
}

