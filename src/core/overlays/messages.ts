import type { Translator } from "../i18n/dictionary";
import type { Catalog } from "./model";
import { catalogKey, isPlainObject } from "./model";
import type { Issue } from "./pageInput";

/** Erreurs de validation → messages sous les champs (chemins `name`, `resolution`, `elements.<uid>.options.<id>`), en langage courant et avec un exemple quand le module en donne un. Pur. */
export function issueMessages(issues: readonly Issue[], raw: unknown, catalog: Catalog, t: Translator): { errors: Record<string, string>; general?: string } {
  const errors: Record<string, string> = {};
  let general: string | undefined;
  const list = isPlainObject(raw) && Array.isArray(raw.elements) ? raw.elements : [];
  const byUid = new Map(list.filter(isPlainObject).map((e) => [String(e.uid), e]));
  for (const i of issues) {
    if (i.code === "name") errors.name = t("ovp.err.name");
    else if (i.code === "resolution") errors.resolution = t("ovp.err.resolution");
    else if (i.code === "tooMany") general = t("ovp.err.tooMany");
    else if (i.code === "unknown") errors[i.path] = t("ovp.err.unknown");
    else if (i.code === "option" && i.option) {
      const [, uid, , id] = i.path.split(".");
      const item = byUid.get(uid ?? "");
      const entry = item ? catalog.get(catalogKey(String(item.instance), String(item.element))) : undefined;
      const decl = entry?.decl.options.find((o) => o.id === id);
      const o = i.option;
      const base = o.code === "range"
        ? t(o.min !== undefined && o.max !== undefined ? "ovp.err.option.range" : o.min !== undefined ? "ovp.err.option.rangeMin" : "ovp.err.option.rangeMax", { min: o.min ?? "", max: o.max ?? "" })
        : t(`ovp.err.option.${o.code}`, { limit: o.limit ?? "" });
      const example = decl?.example ? ` ${t("ovp.err.example", { example: decl.example })}` : "";
      errors[i.path] = base + example;
    } else general = t("ovp.err.generic");
  }
  return { errors, general };
}
