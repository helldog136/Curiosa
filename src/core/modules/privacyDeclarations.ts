import { pickName } from "../instances";
import type { ActiveInstance } from "./registry";
import { localized, type LocalizedString, type PrivacyDeclarations } from "./types";

/** Bornes de `ctx.api.privacy.declarations()` : « dézoom permanent », rien de non borné. */
export const MAX_PRIVACY_MODULES = 100;
export const MAX_PRIVACY_INSTANCES = 10;
export const MAX_PRIVACY_LANGUAGES = 20;
export const MAX_PRIVACY_TEXT = 500;

/** La déclaration `privacy` d'un manifeste, langue par langue (un texte simple vaut pour la langue par défaut). Rien d'autre que du texte, borné. */
export function privacyByLanguage(value: LocalizedString | undefined, defaultLocale: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") {
    const text = value.trim().slice(0, MAX_PRIVACY_TEXT);
    if (text) out[defaultLocale] = text;
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [lang, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_PRIVACY_LANGUAGES) break;
    if (typeof raw !== "string" || !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(lang)) continue;
    const text = raw.trim().slice(0, MAX_PRIVACY_TEXT);
    if (text) out[lang] = text;
  }
  return out;
}

/**
 * Ce que chaque module ACTIF (au moins une instance) déclare comme collecte de données personnelles. Lecture seule : texte, noms et clés d'instance uniquement
 * (aucun réglage, secret ni donnée). Triés par identifiant de module pour un résultat stable ; 100 modules au plus (`truncated` le dit), 10 instances par module.
 */
export function privacyDeclarations(actives: ActiveInstance[], locale: string, defaultLocale: string): PrivacyDeclarations {
  const byModule = new Map<string, ActiveInstance[]>();
  for (const a of actives) {
    const list = byModule.get(a.mod.manifest.id) ?? [];
    list.push(a);
    byModule.set(a.mod.manifest.id, list);
  }
  const ids = [...byModule.keys()].sort();
  const modules = ids.slice(0, MAX_PRIVACY_MODULES).map((id) => {
    const list = byModule.get(id)!;
    const manifest = list[0]!.mod.manifest;
    const text = privacyByLanguage(manifest.privacy, defaultLocale);
    return {
      module: id,
      name: localized(manifest.name, locale, defaultLocale),
      instances: list.slice(0, MAX_PRIVACY_INSTANCES).map((a) => ({ key: a.instance.key, name: pickName(a.instance, locale, defaultLocale) })),
      declares: Object.keys(text).length > 0,
      text,
    };
  });
  return { modules, truncated: ids.length > MAX_PRIVACY_MODULES };
}
