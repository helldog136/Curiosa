import { isPlainObject } from "./model";

/**
 * THE LOOK OF AN OVERLAY PAGE (core 0.8.0): which overlay skin it wears, and optionally a skin PER CONTEXT VALUE (docs/OVERLAY-SKINS.md). Pure.
 *
 * `skin` is the default skin (null = the common style of the page, exactly as before 0.8.0). When `byContext.enabled`, the rules map a value of the chosen context
 * (offered by any module through the generic overlay context contract) to a skin; no rule, no module, offline or unknown value = the default skin.
 * One validation (`validateLook`) serves the administration, the AI tools and the backup reader.
 */
export const MAX_RULES = 200;
export const VALUE_MAX = 120;
export const LABEL_MAX = 80;
const SKIN_ID = /^[a-z][a-z0-9-]{1,40}$/;

export type SkinRule = { value: string; label: string; skin: string };
export type PageLook = { skin: string | null; byContext: { enabled: boolean; instance: string | null; context: string | null; rules: SkinRule[] } };
export const DEFAULT_LOOK: PageLook = { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } };

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Reads a stored look without ever throwing: damaged data gives less (the default look), not an error. */
export function parseLook(raw: unknown): PageLook {
  const o = isPlainObject(raw) ? raw : {};
  const b = isPlainObject(o.byContext) ? o.byContext : {};
  const rules: SkinRule[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(b.rules) ? b.rules.slice(0, MAX_RULES) : []) {
    if (!isPlainObject(r)) continue;
    const value = text(r.value, VALUE_MAX), skin = typeof r.skin === "string" && SKIN_ID.test(r.skin) ? r.skin : "";
    if (!value || !skin || seen.has(value)) continue;
    seen.add(value);
    rules.push({ value, label: text(r.label, LABEL_MAX) || value, skin });
  }
  const ref = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9._-]{1,60}$/.test(v) ? v : null);
  return { skin: typeof o.skin === "string" && SKIN_ID.test(o.skin) ? o.skin : null, byContext: { enabled: b.enabled === true, instance: ref(b.instance), context: ref(b.context), rules } };
}

export type LookIssue = { path: string; code: "skin" | "context" | "tooMany" | "value" | "duplicate" | "format" | "ruleSkin" };
export type LookContext = {
  /** Ids of the installed, valid overlay skins. */
  skins: ReadonlySet<string>;
  /** Contexts offered by the active modules right now. */
  contexts: readonly { instance: string; context: string }[];
  previous: PageLook;
};

/** Validates a look sent by the editor or an AI. What was already saved and is unchanged is tolerated (a removed skin or module must not block an unrelated save). */
export function validateLook(raw: unknown, ctx: LookContext): { ok: true; value: PageLook } | { ok: false; issues: LookIssue[] } {
  const issues: LookIssue[] = [];
  if (!isPlainObject(raw)) return { ok: false, issues: [{ path: "", code: "format" }] };
  const value = parseLook(raw);
  if (value.skin && !ctx.skins.has(value.skin) && value.skin !== ctx.previous.skin) issues.push({ path: "skin", code: "skin" });
  const b = isPlainObject(raw.byContext) ? raw.byContext : {};
  if (Array.isArray(b.rules) && b.rules.length > MAX_RULES) issues.push({ path: "rules", code: "tooMany" });
  const prior = new Map(ctx.previous.byContext.rules.map((r) => [r.value, r.skin]));
  const sent = Array.isArray(b.rules) ? b.rules.slice(0, MAX_RULES) : [];
  const values = new Set<string>();
  sent.forEach((r, i) => {
    if (!isPlainObject(r)) { issues.push({ path: `rules.${i}`, code: "format" }); return; }
    const v = text(r.value, VALUE_MAX);
    if (!v) { issues.push({ path: `rules.${i}.value`, code: "value" }); return; }
    if (values.has(v)) issues.push({ path: `rules.${i}.value`, code: "duplicate" });
    values.add(v);
    const skin = typeof r.skin === "string" ? r.skin : "";
    if (!SKIN_ID.test(skin) || (!ctx.skins.has(skin) && prior.get(v) !== skin)) issues.push({ path: `rules.${i}.skin`, code: "ruleSkin" });
  });
  const { instance, context } = value.byContext;
  const same = instance === ctx.previous.byContext.instance && context === ctx.previous.byContext.context;
  if (value.byContext.enabled && (!instance || !context || (!same && !ctx.contexts.some((c) => c.instance === instance && c.context === context)))) issues.push({ path: "context", code: "context" });
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

/** Which skin applies: the rule of the current value, else the default skin, else null (common style). */
export function pickSkin(look: PageLook, current: { id: string } | null): { skin: string | null; source: "rule" | "default" | "none" } {
  const b = look.byContext;
  if (b.enabled && current) {
    const rule = b.rules.find((r) => r.value === current.id);
    if (rule) return { skin: rule.skin, source: "rule" };
  }
  return look.skin ? { skin: look.skin, source: "default" } : { skin: null, source: "none" };
}

/** Adds or replaces ONE rule (the MCP "create"/"update" shape): never deletes anything. */
export function upsertRule(look: PageLook, rule: SkinRule): PageLook {
  const rules = look.byContext.rules.some((r) => r.value === rule.value) ? look.byContext.rules.map((r) => (r.value === rule.value ? rule : r)) : [...look.byContext.rules, rule];
  return { ...look, byContext: { ...look.byContext, rules } };
}
