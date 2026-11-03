import type { LocalizedString } from "./types";

/**
 * PROFILS DE DÉPART de l'assistant d'installation (« Vous êtes… ? »). La liste vit dans le dépôt du catalogue (`catalogue/profiles.json`, comme `catalogue/suggested.json`) :
 * le cœur ne connaît ni profil ni module par son nom. Un profil ne fait que PRÉ-COCHER des extensions dans l'étape « extensions » et PROPOSER des pages d'exemple
 * (en brouillon) : la personne garde la main sur tout, et sauter la question reste le chemin par défaut. Le profil « Autre » (qui ne change rien) est celui du cœur,
 * il n'est jamais dans le fichier.
 *
 * Contrat du fichier (additif : un cœur plus ancien ne lit pas ce fichier, un dépôt sans ce fichier ne propose simplement aucun profil) :
 *   { "version": 1, "profiles": [ { "id", "icon", "name": {fr,en}, "description": {fr,en}, "modules": ["blog", …], "samples": ["pages:about-me", …] } ] }
 *   - `modules` : identifiants d'extensions à pré-cocher (ceux que le catalogue ne suggère pas à l'assistant sont écartés à l'affichage) ;
 *   - `samples` : « <extension>:<modèle> », un modèle déclaré par l'extension dans `content.templates` de son manifeste (modèle inconnu : écarté).
 * Tout est borné et nettoyé ici ; un profil abîmé est ignoré sans gêner les autres.
 */
export const MAX_PROFILES = 5;
export const MAX_PROFILE_MODULES = 8;
export const MAX_PROFILE_SAMPLES = 8;
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const SAMPLE_RE = /^([a-z][a-z0-9-]{1,39}):([a-z][a-z0-9-]{1,39})$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
/** Identifiant réservé : « Autre » est celui du cœur. */
export const OTHER_PROFILE = "other";

export type SetupProfile = {
  id: string;
  icon: string;
  name: Record<string, string>;
  description: Record<string, string>;
  modules: string[];
  samples: string[];
};

/** Texte par langue, borné ; chaîne simple : lue comme l'anglais. Rien d'exploitable : `null`. */
function texts(raw: unknown, max: number): Record<string, string> | null {
  const source = typeof raw === "string" ? { en: raw } : raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!source) return null;
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(source)) {
    if (!LOCALE_RE.test(locale) || typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim().slice(0, max);
    if (text) out[locale] = text;
    if (Object.keys(out).length >= 12) break;
  }
  return Object.keys(out).length ? out : null;
}

const idList = (raw: unknown, test: (s: string) => boolean, max: number): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && test(x)))].slice(0, max) : [];

/** Valide le contenu de `catalogue/profiles.json` (`{ profiles: [...] }` ou une liste). Ne lève jamais. */
export function sanitizeProfiles(json: unknown): SetupProfile[] {
  const list = Array.isArray(json) ? json : Array.isArray((json as { profiles?: unknown })?.profiles) ? (json as { profiles: unknown[] }).profiles : [];
  const seen = new Set<string>();
  const out: SetupProfile[] = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    if (typeof r.id !== "string" || !ID_RE.test(r.id) || r.id === OTHER_PROFILE || seen.has(r.id)) continue;
    const name = texts(r.name, 60);
    if (!name) continue;
    const modules = idList(r.modules, (s) => ID_RE.test(s), MAX_PROFILE_MODULES);
    const samples = idList(r.samples, (s) => SAMPLE_RE.test(s), MAX_PROFILE_SAMPLES);
    if (!modules.length && !samples.length) continue;
    seen.add(r.id);
    out.push({ id: r.id, icon: typeof r.icon === "string" ? r.icon.slice(0, 8) : "", name, description: texts(r.description, 140) ?? {}, modules, samples });
    if (out.length >= MAX_PROFILES) break;
  }
  return out;
}

/** Un modèle de page que propose une extension (`content.templates` de son manifeste), tel que l'assistant l'affiche. */
export type SetupTemplate = { id: string; name: LocalizedString; description?: LocalizedString };

/**
 * Profils tels que l'assistant les montre : on garde de chaque profil ce qui existe vraiment (extension proposée par l'assistant, modèle déclaré par cette extension).
 * Un profil qui ne propose plus rien est retiré ; l'ordre du fichier est conservé. Pur.
 */
export function resolveProfiles(profiles: SetupProfile[], offered: { id: string; templates: SetupTemplate[] }[]): SetupProfile[] {
  const byId = new Map(offered.map((m) => [m.id, m]));
  const out: SetupProfile[] = [];
  for (const p of profiles) {
    const modules = p.modules.filter((id) => byId.has(id));
    const samples = p.samples.filter((ref) => {
      const m = SAMPLE_RE.exec(ref);
      return !!m && !!byId.get(m[1]!)?.templates.some((t) => t.id === m[2]);
    });
    if (modules.length || samples.length) out.push({ ...p, modules, samples });
  }
  return out;
}

/** « module:modèle » → ses deux parties (ou `null`). */
export function parseSampleRef(ref: string): { module: string; template: string } | null {
  const m = SAMPLE_RE.exec(ref);
  return m ? { module: m[1]!, template: m[2]! } : null;
}

/** Le texte d'un modèle dans la langue demandée (puis sa langue de base, l'anglais, la première disponible). */
export function pickLocalized(v: LocalizedString | undefined, locale: string): string {
  if (typeof v === "string") return v;
  if (!v) return "";
  return v[locale] ?? v[locale.split("-")[0]!] ?? v.en ?? Object.values(v)[0] ?? "";
}
