import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { audit } from "./permissions";
import { listContexts, listContextValues, type ContextRef } from "./overlays/context";
import { updateLook } from "./overlays/lookService";
import { upsertRule, type LookIssue, type PageLook } from "./overlays/look";
import { listOverlaySkins } from "./overlays/skinLoad";
import { getPage, listPages } from "./overlays/store";
import { getSiteConfig } from "./settings";

/**
 * AI TOOLS FOR OVERLAY SKINS (core 0.8.0): `overlay_skins_list`, `overlay_skin_rules_list` (read), `overlay_skin_rules_create`, `overlay_skin_rules_update` (write).
 * The same validation as the administration (overlays/lookService.ts + look.ts): a skin must be installed and valid, a context must be offered by an active module,
 * a value must be one the module knows. Write tools are never granted by default, and NO tool deletes anything (a rule is neutralised by pointing it at another skin;
 * removing one is done in the administration). Messages are plain English for the agent; the names of skins and values come back in the language of the site.
 */
const str = (max = 200) => ({ type: "string" as const, maxLength: max });
const LIMIT = 30;

async function names() {
  const config = await getSiteConfig();
  const lang = config.defaultLocale;
  return { lang, defaultLocale: config.defaultLocale };
}

function explain(issues: readonly LookIssue[]): string {
  const m: Record<LookIssue["code"], string> = {
    skin: "skin: this skin is not installed or does not work. List the usable ones with overlay_skins_list.",
    ruleSkin: "skin: this skin is not installed or does not work. List the usable ones with overlay_skins_list.",
    context: "context: no active extension offers this context. See availableContexts in overlay_skin_rules_list.",
    tooMany: "rules: 200 rules at most per page.",
    value: "value: give the value to match.",
    duplicate: "value: this value already has a rule; use overlay_skin_rules_update.",
    format: "the request is not in the expected shape.",
  };
  return [...new Set(issues.map((i) => m[i.code]))].join(" ");
}

async function lookView(pageId: string, query: string) {
  const page = await getPage(pageId);
  if (!page) throw new McpToolError("overlay page not found: pass the \"page\" id from overlay_skins_list");
  const { lang, defaultLocale } = await names();
  const [contexts, skins] = await Promise.all([listContexts(lang, defaultLocale), listOverlaySkins()]);
  const b = page.look.byContext;
  const ref: ContextRef | null = b.instance && b.context ? { instance: b.instance, context: b.context } : contexts.length === 1 ? { instance: contexts[0]!.instance, context: contexts[0]!.context } : null;
  const known = ref ? await listContextValues(ref, query, LIMIT) : [];
  const skinName = new Map(skins.map((s) => [s.id, lang === "fr" ? s.name.fr : s.name.en]));
  return {
    page: { id: page.id, name: page.name }, defaultSkin: page.look.skin, skinPerContext: { enabled: b.enabled, instance: b.instance, context: b.context },
    rules: b.rules.map((r) => ({ value: r.value, label: r.label, skin: r.skin, skinName: skinName.get(r.skin) ?? null })),
    availableContexts: contexts.map((c) => ({ instance: c.instance, context: c.context, label: c.label, example: c.example || null })),
    knownValues: known, knownValuesNote: ref ? `At most ${LIMIT} values seen so far, filtered by "query".` : "No context chosen yet: pass \"context\" and \"instance\" in overlay_skin_rules_update (or create a rule with enable: true).",
  };
}

/** The value a rule matches: an id the module knows, or the unique name it gave to one. */
async function resolveValue(ref: ContextRef, asked: string): Promise<{ id: string; name: string }> {
  const seen = await listContextValues(ref, asked, 50);
  const exact = seen.find((v) => v.id === asked) ?? (await listContextValues(ref, "", 200)).find((v) => v.id === asked);
  if (exact) return exact;
  const byName = seen.filter((v) => v.name.toLowerCase() === asked.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  throw new McpToolError(`value: "${asked}" is not one of the values this extension has seen. Call overlay_skin_rules_list with query "${asked.slice(0, 40)}" and use one of the knownValues (its "id").`);
}

export const overlaySkinsToolProvider: McpToolProvider = {
  id: "overlay-skins",
  async list() {
    const base = { source: "core", destructive: false } as const;
    const listSchema: JsonSchemaLite = { type: "object", properties: {} };
    const rulesSchema: JsonSchemaLite = { type: "object", required: ["page"], properties: { page: str(60), query: str(80) } };
    const createSchema: JsonSchemaLite = { type: "object", required: ["page", "value", "skin"], properties: { page: str(60), value: str(120), skin: str(41), instance: str(60), context: str(60), enable: { type: "boolean" } } };
    const updateSchema: JsonSchemaLite = { type: "object", required: ["page"], properties: { page: str(60), value: str(120), skin: str(41), label: str(80), defaultSkin: str(41), enabled: { type: "boolean" }, instance: str(60), context: str(60) } };
    const tools: McpTool[] = [
      {
        ...base, name: "overlay_skins_list", title: "Overlay skins: list", readOnly: true, default: true, input: listSchema,
        description: "List the overlay skins installed on the site (they restyle the OBS overlay pages, never the public site) and the overlay pages with the skin each one wears. Skins: id, name, description, tags, version, status (ok, missing, modified or invalid: only \"ok\" can be used). Pages: id, name, defaultSkin (null = the common style), skinPerContext (on or off). Read only.",
        call: async () => {
          const { lang } = await names();
          const [skins, pages] = await Promise.all([listOverlaySkins(), listPages()]);
          return {
            skins: skins.map((s) => ({ id: s.id, name: lang === "fr" ? s.name.fr : s.name.en, description: lang === "fr" ? s.description.fr : s.description.en, tags: s.tags, version: s.version, status: s.status })),
            pages: pages.map((p) => ({ id: p.id, name: p.name, defaultSkin: p.look.skin, skinPerContext: p.look.byContext.enabled })),
          };
        },
      },
      {
        ...base, name: "overlay_skin_rules_list", title: "Overlay skins: rules of a page", readOnly: true, default: true, input: rulesSchema,
        description: "Read the skin rules of one overlay page (\"page\" = its id): the default skin, whether the skin per context is on, the rules (value → skin), the contexts that active extensions offer (for example the current game) and the values each one has seen so far (\"knownValues\": use their \"id\" in rules; \"query\" filters them). Read only.",
        call: async (raw) => { const a = validateArgs(rulesSchema, raw); return lookView(a.page as string, (a.query as string | undefined) ?? ""); },
      },
      {
        ...base, name: "overlay_skin_rules_create", title: "Overlay skins: add a rule", readOnly: false, default: false, audited: true, input: createSchema,
        description: "Add ONE rule to an overlay page: when the context value \"value\" (an id from knownValues, or its exact name) is current, the page wears \"skin\" (an id from overlay_skins_list with status ok). An existing value is refused (use overlay_skin_rules_update). If the page has no context yet, \"instance\" and \"context\" choose one (or the only one on offer is used). \"enable\": true also turns the skin per context on. Nothing is ever deleted. Rules apply on the live page within seconds, without reloading it.",
        call: async (raw, actor) => {
          const a = validateArgs(createSchema, raw);
          const { lang, defaultLocale } = await names();
          const page = await getPage(a.page as string);
          if (!page) throw new McpToolError("overlay page not found: pass the \"page\" id from overlay_skins_list");
          const contexts = await listContexts(lang, defaultLocale);
          const b = page.look.byContext;
          const chosen = (a.instance && a.context ? contexts.find((c) => c.instance === a.instance && c.context === a.context) : undefined) ?? contexts.find((c) => c.instance === b.instance && c.context === b.context) ?? (contexts.length === 1 ? contexts[0] : undefined);
          if (!chosen) throw new McpToolError("context: no active extension offers a context for this page. See availableContexts in overlay_skin_rules_list.");
          const value = await resolveValue(chosen, a.value as string);
          if (b.rules.some((r) => r.value === value.id)) throw new McpToolError(`value: "${value.name}" already has a rule; use overlay_skin_rules_update.`);
          const r = await updateLook(page.id, (cur) => {
            const moved = cur.byContext.instance === chosen.instance && cur.byContext.context === chosen.context ? cur : { ...cur, byContext: { ...cur.byContext, instance: chosen.instance, context: chosen.context, rules: [] } };
            const next = upsertRule(moved, { value: value.id, label: value.name, skin: a.skin as string });
            return a.enable === true ? { ...next, byContext: { ...next.byContext, enabled: true } } : next;
          }, lang, defaultLocale);
          if (!r.ok) throw new McpToolError(r.error === "notFound" ? "overlay page not found" : explain(r.issues));
          await audit(`mcp:${actor.name}`, "overlay.skin.rule", page.id);
          return { ...(await lookView(page.id, "")), added: { value: value.id, label: value.name, skin: a.skin }, ...(r.page.look.byContext.enabled ? {} : { note: "The skin per context is OFF for this page: the rule does not apply until it is turned on (enabled: true in overlay_skin_rules_update)." }) };
        },
      },
      {
        ...base, name: "overlay_skin_rules_update", title: "Overlay skins: change a rule or the page skin", readOnly: false, default: false, audited: true, input: updateSchema,
        description: "Change an overlay page's skin settings. Only what you pass changes: \"defaultSkin\" (the skin used when no rule applies; an empty string = the common style), \"enabled\" (turn the skin per context on or off), \"instance\" + \"context\" (choose which context drives the skin; this clears the rules, which were about another context), and, with \"value\" (an existing rule), its \"skin\" and \"label\". No tool deletes a rule: point it at another skin, or ask the owner to remove it in the administration.",
        call: async (raw, actor) => {
          const a = validateArgs(updateSchema, raw);
          const { lang, defaultLocale } = await names();
          const page = await getPage(a.page as string);
          if (!page) throw new McpToolError("overlay page not found: pass the \"page\" id from overlay_skins_list");
          if (a.value !== undefined && !page.look.byContext.rules.some((r) => r.value === a.value)) throw new McpToolError(`value: no rule for "${String(a.value)}" on this page; use overlay_skin_rules_create, or check overlay_skin_rules_list.`);
          if (a.value !== undefined && a.skin === undefined && a.label === undefined) throw new McpToolError("pass the new \"skin\" (and/or \"label\") for this rule");
          const r = await updateLook(page.id, (cur: PageLook) => {
            let next: PageLook = cur;
            if (a.instance !== undefined || a.context !== undefined) next = { ...next, byContext: { ...next.byContext, instance: (a.instance as string) ?? null, context: (a.context as string) ?? null, rules: [] } };
            if (a.defaultSkin !== undefined) next = { ...next, skin: (a.defaultSkin as string) || null };
            if (a.enabled !== undefined) next = { ...next, byContext: { ...next.byContext, enabled: a.enabled as boolean } };
            if (a.value !== undefined) { const old = next.byContext.rules.find((x) => x.value === a.value)!; next = upsertRule(next, { value: old.value, label: (a.label as string | undefined) ?? old.label, skin: (a.skin as string | undefined) ?? old.skin }); }
            return next;
          }, lang, defaultLocale);
          if (!r.ok) throw new McpToolError(r.error === "notFound" ? "overlay page not found" : explain(r.issues));
          await audit(`mcp:${actor.name}`, "overlay.skin", page.id);
          return lookView(page.id, "");
        },
      },
    ];
    return tools;
  },
};
