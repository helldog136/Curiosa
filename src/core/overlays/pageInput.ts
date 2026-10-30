import { MAX_ELEMENTS_PER_PAGE, MAX_SIDE, MIN_SIDE, NAME_MAX, UID_RE, catalogKey, clampInt, isPlainObject, type Catalog, type OverlayStyle, type PageElement } from "./model";
import { constrainRect, type Rect } from "./layout";
import { checkOptions, keepOptions, type OptionCheck } from "./options";
import { parseStyle } from "./tokens";

/**
 * Validation d'une page d'overlay reçue de l'éditeur (ou d'un import) : le navigateur n'est jamais cru sur parole. Pur : le catalogue des éléments disponibles
 * (modules actifs) et la page déjà enregistrée sont donnés en paramètres. Les cadres sont ramenés à ce que chaque comportement permet (mêmes fonctions que l'éditeur) ;
 * un élément dont le module a disparu et qui figurait déjà dans la page est conservé tel quel (cadre vide), jamais refusé.
 */
export type Issue = { path: string; code: "name" | "resolution" | "tooMany" | "uid" | "duplicateUid" | "unknown" | "format" | "option"; option?: OptionCheck & { ok: false } };
export type PageValue = { name: string; width: number; height: number; style: OverlayStyle; elements: PageElement[] };

export function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

export function validatePageInput(raw: unknown, ctx: { catalog: Catalog; previous: readonly PageElement[] }): { ok: true; value: PageValue } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) return { ok: false, issues: [{ path: "", code: "format" }] };
  const name = cleanName(raw.name);
  if (!name || name.length > NAME_MAX) issues.push({ path: "name", code: "name" });
  const width = clampInt(raw.width, MIN_SIDE, MAX_SIDE, 0), height = clampInt(raw.height, MIN_SIDE, MAX_SIDE, 0);
  const outside = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return !Number.isFinite(n) || n < MIN_SIDE || n > MAX_SIDE; };
  if (!width || !height || outside(raw.width) || outside(raw.height)) issues.push({ path: "resolution", code: "resolution" });
  const page = { width: width || 1920, height: height || 1080 };
  const list = Array.isArray(raw.elements) ? raw.elements : null;
  if (!list) issues.push({ path: "elements", code: "format" });
  if (list && list.length > MAX_ELEMENTS_PER_PAGE) issues.push({ path: "elements", code: "tooMany" });
  const known = new Map(ctx.previous.map((e) => [e.uid, e]));
  const seen = new Set<string>();
  const elements: PageElement[] = [];
  for (const item of (list ?? []).slice(0, MAX_ELEMENTS_PER_PAGE)) {
    if (!isPlainObject(item)) { issues.push({ path: "elements", code: "format" }); continue; }
    const uid = typeof item.uid === "string" ? item.uid : "";
    if (!UID_RE.test(uid)) { issues.push({ path: "elements", code: "uid" }); continue; }
    if (seen.has(uid)) { issues.push({ path: `elements.${uid}`, code: "duplicateUid" }); continue; }
    seen.add(uid);
    const instance = typeof item.instance === "string" ? item.instance : "", element = typeof item.element === "string" ? item.element : "";
    const entry = ctx.catalog.get(catalogKey(instance, element));
    const before = known.get(uid);
    const sameAsBefore = !!before && before.instance === instance && before.element === element;
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    const rect: Rect = { x: num(item.x, 0), y: num(item.y, 0), w: num(item.w, 100), h: num(item.h, 100) };
    if (entry) {
      const { values, errors } = checkOptions(entry.decl.options, item.options);
      for (const [id, e] of Object.entries(errors)) issues.push({ path: `elements.${uid}.options.${id}`, code: "option", option: e });
      const r = constrainRect(entry.decl, rect, page, num(item.keep, 0) === 1 ? "h" : "w");
      elements.push({ uid, instance, element, ...r, visible: item.visible !== false, options: values });
    } else if (sameAsBefore) {
      // Module retiré : l'élément reste en place, vide. Cadre simplement ramené dans la page.
      const w = Math.max(8, Math.min(page.width, Math.round(rect.w))), h = Math.max(8, Math.min(page.height, Math.round(rect.h)));
      elements.push({ uid, instance, element, x: Math.round(Math.min(Math.max(0, rect.x), page.width - w)), y: Math.round(Math.min(Math.max(0, rect.y), page.height - h)), w, h, visible: item.visible !== false, options: keepOptions(item.options) });
    } else {
      issues.push({ path: `elements.${uid}`, code: "unknown" });
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { name, width: page.width, height: page.height, style: parseStyle(raw.style), elements } };
}
