import { prisma } from "@/core/db";
import { parseTags, uniqueSlug } from "@/core/content/entries";
import { createEntry } from "@/core/content/service";
import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { getSiteConfig } from "@/core/settings";
import { slugify } from "@/core/slug";
import { isSafeExternalUrl } from "@/core/url";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import type { JsonSchemaLite } from "@/core/modules/types";

/**
 * FOURNISSEUR D'OUTILS MCP — le moteur de contenu.
 *
 * Toute instance à contenu (blog, sponsors, liste de liens…) reçoit des actions éditoriales :
 * lister, lire, créer un brouillon, éditer un brouillon. C'est une fonctionnalité du moteur de contenu
 * (il connaît les entrées), pas du mécanisme MCP. Garde-fous : aucune action ne publie ni ne supprime ;
 * seuls les brouillons sont modifiables.
 */
const str = (max = 2000) => ({ type: "string" as const, maxLength: max });

export const contentToolProvider: McpToolProvider = {
  id: "content",
  async list() {
    const tools: McpTool[] = [];
    const config = await getSiteConfig();
    const locales = config.locales;

    for (const { instance, mod } of await getActiveInstances()) {
      if (!mod.manifest.content) continue;
      const label = pickName(instance, "en", config.defaultLocale);
      const add = (name: string, t: Pick<McpTool, "description" | "readOnly" | "input" | "call">) =>
        tools.push({ name: `${instance.key}__${name}`, title: `${label}: ${name}`, source: instance.key, instanceId: instance.id, ...t });

      const listSchema: JsonSchemaLite = { type: "object", properties: { status: { type: "string", enum: ["published", "draft", "all"] }, locale: { type: "string", enum: locales }, limit: { type: "integer", minimum: 1, maximum: 100 } } };
      add("list_entries", {
        description: `[${label}] List entries (id, title, status, summary, link, code, tags). Default: published only.`,
        readOnly: true,
        input: listSchema,
        call: async (raw) => {
          const a = validateArgs(listSchema, raw);
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

      const getSchema: JsonSchemaLite = { type: "object", required: ["id"], properties: { id: str(60), locale: { type: "string", enum: locales } } };
      add("get_entry", {
        description: `[${label}] Read one entry with its full text.`,
        readOnly: true,
        input: getSchema,
        call: async (raw) => {
          const a = validateArgs(getSchema, raw);
          const e = await prisma.entry.findFirst({ where: { id: a.id as string, instanceId: instance.id }, include: { translations: true } });
          if (!e) throw new McpToolError("entry not found");
          const tr = e.translations.find((x) => x.locale === ((a.locale as string) ?? config.defaultLocale)) ?? e.translations[0];
          return { id: e.id, status: e.status, locale: tr?.locale, title: tr?.title, summary: tr?.summary, body: tr?.body, url: e.url, code: e.code, tags: parseTags(e.tags), languages: e.translations.map((x) => x.locale) };
        },
      });

      const draftProps = { title: str(300), summary: str(2000), body: str(50000), url: str(2000), code: str(200), tags: { type: "array" as const, items: { type: "string" as const } }, locale: { type: "string" as const, enum: locales } };
      const createSchema: JsonSchemaLite = { type: "object", required: ["title"], properties: draftProps };
      add("create_draft", {
        description: `[${label}] Create a DRAFT entry. It is never published automatically: a human reviews and publishes it in the admin.`,
        readOnly: false,
        input: createSchema,
        call: async (raw, actor) => {
          const a = validateArgs(createSchema, raw);
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

      const updateSchema: JsonSchemaLite = { type: "object", required: ["id"], properties: { id: str(60), ...draftProps } };
      add("update_draft", {
        description: `[${label}] Edit a DRAFT entry (or add a language version to it). Published entries cannot be changed through MCP.`,
        readOnly: false,
        input: updateSchema,
        call: async (raw, actor) => {
          const a = validateArgs(updateSchema, raw);
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
    return tools;
  },
};
