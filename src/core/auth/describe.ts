/**
 * « Ce que cette personne peut faire », en phrases simples (page Équipe). Logique pure : le niveau, les droits et le catalogue entrent, des phrases sortent.
 * Jamais d'identifiant technique ni de JSON à l'écran.
 */
import type { Translator } from "../i18n/dictionary";
import { localized } from "../modules/types";
import { systemRights, type Level, type RightInfo } from "./rights";

/** Libellé d'un droit pour une case à cocher ou une phrase : « Écrire et modifier les contenus », « Ouvrir Contacts », « Contacts : voir les e-mails ». */
export function rightLabel(r: RightInfo, t: Translator, locale: string, defaultLocale: string): string {
  if (!r.moduleId) return t(`right.core.${r.local}`);
  const mod = localized(r.moduleName ?? r.moduleId, locale, defaultLocale) || r.moduleId;
  if (r.local === "open") return t("right.open", { module: mod });
  return `${mod} : ${localized(r.label ?? r.local, locale, defaultLocale) || r.local}`;
}

/** Les droits d'une personne : ceux de son niveau prédéfini, plus ceux (valides) de ses rôles personnalisés. */
export function rightsOf(level: Level, customRights: Iterable<string>, catalogue: RightInfo[]): Set<string> {
  const out = systemRights(level, catalogue);
  const allowed = new Set(catalogue.filter((r) => !r.reserved).map((r) => r.id));
  for (const r of customRights) if (allowed.has(r)) out.add(r);
  return out;
}

/** Phrases : celle du niveau (propriétaire, administrateur, éditeur), puis chaque droit en plus de ce niveau. Aucune = « Rien pour l'instant ». */
export function describeAccess(level: Level, rights: ReadonlySet<string>, catalogue: RightInfo[], t: Translator, locale: string, defaultLocale: string): string[] {
  if (level === "owner") return [t("access.owner")];
  const out: string[] = level === "none" ? [] : [t(`access.${level}`)];
  const implied = systemRights(level, catalogue);
  for (const r of catalogue) if (!r.reserved && rights.has(r.id) && !implied.has(r.id)) out.push(rightLabel(r, t, locale, defaultLocale));
  return out.length ? out : [t("access.nothing")];
}
