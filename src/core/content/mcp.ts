import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db";
import { entryPath, parseTags, uniqueSlug } from "@/core/content/entries";
import { createEntry } from "@/core/content/service";
import { getInstanceLabeler } from "@/core/modules/labels";
import { getActiveInstances } from "@/core/modules/registry";
import { getSiteConfig } from "@/core/settings";
import { slugify } from "@/core/slug";
import { isSafeExternalUrl } from "@/core/url";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import type { JsonSchemaLite } from "@/core/modules/types";
import { callLevel3 } from "@/core/maintenance/actions";
import { publishInput } from "@/core/maintenance/publish";
import { updatePublishedSummary } from "@/core/maintenance/entryMeta";

/**
 * MCP TOOL PROVIDER: the content engine.
 *
 * Every content instance (blog, sponsors, list of links...) gets editorial tools: list, read, create a draft, edit a draft, and (separate rights, never granted
 * by default) publish a draft and return an entry to draft. This is a feature of the content engine (it knows the entries), not of the MCP mechanism, so every present and
 * future content module gets them with no change of its own. Deleting is never offered here: a module can offer it itself (`destructive` actions, off by default).
 *
 * Publishing never edits content, only publishes an existing draft of THIS instance, and follows the approval setting of the access like updates do
 * (maintenance/publish.ts and maintenance/actions.ts, `callLevel3`). A module that declares its own `publish` / `unpublish` action keeps it: no second tool of that name.
 */
/** Curseur opaque de `list_entries` : (date de création, identifiant) de la dernière entrée rendue. */
const encodeCreatedCursor = (e: { createdAt: Date; id: string }) => Buffer.from(`${e.createdAt.getTime()}|${e.id}`, "utf8").toString("base64url");
function decodeCreatedCursor(raw: string): { createdAt: Date; id: string } | null {
  const m = /^(\d{1,15})\|([\w-]{1,64})$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  return m ? { createdAt: new Date(Number(m[1])), id: m[2]! } : null;
}

const pickPublishArgs = (a: Record<string, unknown>) => ({ id: a.id, ids: a.ids, locale: a.locale });
const str = (max = 2000) => ({ type: "string" as const, maxLength: max });

/** Public path of each language version of an entry (`/blog/hello`, `/fr/blog/bonjour`), and of the one shown. Additive: the list and the read keep every earlier field. */
const pathsOf = (basePath: string | null, translations: { locale: string; slug: string }[], defaultLocale: string): Record<string, string> =>
  Object.fromEntries(translations.map((x) => [x.locale, entryPath({ basePath: basePath ?? "", slug: x.slug, locale: x.locale }, defaultLocale)]));

export const contentToolProvider: McpToolProvider = {
  id: "content",
  async list() {
    const tools: McpTool[] = [];
    const config = await getSiteConfig();
    const locales = config.locales;
    const labeler = await getInstanceLabeler("en", config.defaultLocale);

    for (const { instance, mod } of await getActiveInstances()) {
      if (!mod.manifest.content) continue;
      const label = labeler.label(instance);
      const add = (name: string, t: Pick<McpTool, "description" | "readOnly" | "input" | "call"> & { default?: boolean; request?: boolean; audited?: boolean }) =>
        tools.push({ name: `${instance.key}__${name}`, title: `${label}: ${name}`, source: instance.key, instanceId: instance.id, default: t.default ?? true, destructive: false, ...t });

      const listSchema: JsonSchemaLite = { type: "object", properties: { status: { type: "string", enum: ["published", "draft", "all"] }, locale: { type: "string", enum: locales }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: str(200) } };
      add("list_entries", {
        description: `[${label}] List entries (id, title, status, summary, public path, paths per language, link, code, tags), newest first. Default: published only, 30 per call (100 at most). With no "cursor" and nothing left, the answer is the plain list; when more remain (or when a "cursor" was given) it is { items, next }: pass "next" as "cursor" to read the following page; next is null on the last page.`,
        readOnly: true,
        input: listSchema,
        call: async (raw) => {
          const a = validateArgs(listSchema, raw);
          const locale = (a.locale as string) ?? config.defaultLocale;
          const status = (a.status as string) ?? "published";
          const take = (a.limit as number) ?? 30;
          const after = a.cursor ? decodeCreatedCursor(a.cursor as string) : null;
          if (a.cursor && !after) throw new McpToolError("invalid cursor: pass the \"next\" value of the previous answer, unchanged");
          const where: Prisma.EntryWhereInput = {
            instanceId: instance.id,
            ...(status === "all" ? {} : { status }),
            ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
          };
          const found = await prisma.entry.findMany({ where, include: { translations: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1 });
          const rows = found.slice(0, take);
          const items = rows.map((e) => {
            const tr = e.translations.find((x) => x.locale === locale) ?? e.translations[0];
            const paths = pathsOf(instance.basePath, e.translations, config.defaultLocale);
            return { id: e.id, status: e.status, title: tr?.title, locale: tr?.locale, languages: e.translations.map((x) => x.locale), path: tr ? paths[tr.locale] : undefined, paths, summary: tr?.summary || undefined, url: e.url ?? undefined, code: e.code ?? undefined, tags: parseTags(e.tags), publishedAt: e.publishedAt?.toISOString() };
          });
          const next = found.length > take ? encodeCreatedCursor(rows[rows.length - 1]!) : null;
          // Forme d'avant (un tableau) tant qu'il n'y a ni curseur ni page suivante ; sinon { items, next }.
          return next || a.cursor ? { items, next } : items;
        },
      });

      const getSchema: JsonSchemaLite = { type: "object", required: ["id"], properties: { id: str(60), locale: { type: "string", enum: locales } } };
      add("get_entry", {
        description: `[${label}] Read one entry with its full text, its public path and the path of each language version.`,
        readOnly: true,
        input: getSchema,
        call: async (raw) => {
          const a = validateArgs(getSchema, raw);
          const e = await prisma.entry.findFirst({ where: { id: a.id as string, instanceId: instance.id }, include: { translations: true } });
          if (!e) throw new McpToolError("entry not found");
          const tr = e.translations.find((x) => x.locale === ((a.locale as string) ?? config.defaultLocale)) ?? e.translations[0];
          const paths = pathsOf(instance.basePath, e.translations, config.defaultLocale);
          return { id: e.id, status: e.status, locale: tr?.locale, title: tr?.title, summary: tr?.summary, body: tr?.body, url: e.url, code: e.code, tags: parseTags(e.tags), languages: e.translations.map((x) => x.locale), path: tr ? paths[tr.locale] : undefined, paths };
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

      // Publishing: a separate right per instance, off by default. One tool for the engine, so every content module has it.
      const own = new Set((mod.manifest.mcp ?? []).map((m) => m.name));
      const pubSchema = publishInput(locales);
      if (!own.has("publish")) {
        add("publish", {
          description: `[${label}] PUBLISH existing DRAFT entries (id, or ids for several: one request for all). It never edits content: it only changes the status of a draft that already exists in this list, after the same checks as the admin's Publish button (every language version has a title, and every site language exists when this list shows each language only when it is written; otherwise it says which version is missing and publishes nothing). It follows the owner's approval setting for this access: either a request the owner approves in Admin > AI assistants (poll maintenance_request_status), or done at once. A published entry is never overwritten: use it only for drafts.`,
          readOnly: false, default: false, request: true, audited: true, input: pubSchema,
          call: (raw, actor) => callLevel3("entry_publish", { instance: instance.key, ...pickPublishArgs(validateArgs(pubSchema, raw)) }, actor),
        });
      }
      if (!own.has("unpublish")) {
        add("unpublish", {
          description: `[${label}] Return PUBLISHED entries to draft (id, or ids for several). Content is not changed and nothing is deleted: the entry just stops showing on the site until it is published again. Follows the owner's approval setting for this access, like publish.`,
          readOnly: false, default: false, request: true, audited: true, input: pubSchema,
          call: (raw, actor) => callLevel3("entry_unpublish", { instance: instance.key, ...pickPublishArgs(validateArgs(pubSchema, raw)) }, actor),
        });
      }
      if (!own.has("update_published_meta")) {
        const metaSchema: JsonSchemaLite = {
          type: "object", required: ["id", "locale", "summary"],
          properties: {
            id: { type: "string", maxLength: 60, description: "Identifier of a PUBLISHED entry, as returned by list_entries." },
            locale: { type: "string", enum: locales, description: "The language version to correct." },
            summary: { type: "string", maxLength: 2000, description: "The new summary (description) of that language version." },
          },
        };
        add("update_published_meta", {
          description: `[${label}] Correct the SUMMARY (short description) of one language version of a PUBLISHED entry, without taking it off the site. Only id, locale and summary are accepted: the title, address, text and status cannot be changed here. Refuses drafts (use update_draft). The previous summary is kept so the owner can put it back.`,
          readOnly: false, default: false, audited: true, input: metaSchema,
          call: (raw, actor) => {
            const a = validateArgs(metaSchema, raw);
            return updatePublishedSummary(instance, actor, { id: a.id as string, locale: a.locale as string, summary: a.summary as string });
          },
        });
      }
    }
    return tools;
  },
};
