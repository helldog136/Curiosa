/**
 * PHRASES DU JOURNAL quand du code de module ne répond pas (ou répond lentement). Fonctions pures : aucune horloge, aucun état.
 * Chaque phrase nomme le fautif (module + instance + ce qui a été demandé) et dit ce qui a été fait. Jamais de secret ni de donnée de visiteur :
 * seulement des identifiants de module, d'instance et de section, et des durées.
 */
export type UnitKind = "section" | "slot" | "filter" | "page" | "news" | "overlay" | "service" | "topic";
export type Unit = { kind: UnitKind; moduleId: string; instanceKey: string; name: string };

/** Ce que l'on demandait, avec son article et l'accord de « ignoré ». */
const WORDS: Record<UnitKind, { what: (name: string) => string; ignored: string; slow: string }> = {
  section: { what: (n) => `La section « ${n} »`, ignored: "elle est ignorée pour cette page", slow: "est lente" },
  slot: { what: (n) => `L'emplacement « ${n} »`, ignored: "il est ignoré pour cette page", slow: "est lent" },
  filter: { what: (n) => `Le filtre « ${n} »`, ignored: "il est ignoré pour cette page", slow: "est lent" },
  page: { what: () => "La page", ignored: "elle n'est pas affichée", slow: "est lente" },
  news: { what: () => "La pastille de nouveauté", ignored: "elle est ignorée pour cette page", slow: "est lente" },
  overlay: { what: () => "L'overlay", ignored: "il n'est pas affiché", slow: "est lent" },
  service: { what: (n) => `Le service « ${n} »`, ignored: "l'appel est ignoré pour cette page", slow: "est lent" },
  topic: { what: (n) => `Le sujet « ${n} »`, ignored: "ses éléments sont ignorés pour cette page", slow: "est lent" },
};

/** Un nom sûr pour une ligne de journal : sans retour à la ligne ni caractère de contrôle, borné. */
export const safeName = (v: unknown): string => String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** « 8 s », « 3,4 s », « 0,4 s » (virgule française). */
export function seconds(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${Number.isInteger(s) ? s : String(s).replace(".", ",")} s`;
}

const who = (u: Unit) => `${u.kind === "topic" ? "fourni par le" : "du"} module ${safeName(u.moduleId)} (instance ${safeName(u.instanceKey)})`;
const head = (u: Unit) => `${WORDS[u.kind].what(safeName(u.name))} ${who(u)}`;
const tag = "[modules]";

/** Pas de réponse dans le temps imparti. Exemple : « La section « Lecteur » du module démo (instance démo) n'a pas répondu en 8 s ; elle est ignorée pour cette page. » */
export const stalledLine = (u: Unit, ms: number) => `${tag} ${head(u)} n'a pas répondu en ${seconds(ms)} ; ${WORDS[u.kind].ignored}.`;
/** Réponse arrivée à temps, mais lente : le coupable est nommé AVANT qu'il ne dépasse le délai. */
export const slowLine = (u: Unit, tookMs: number, slowMs: number, limitMs: number) => `${tag} ${head(u)} ${WORDS[u.kind].slow} : ${seconds(tookMs)} pour répondre (seuil : ${seconds(slowMs)}) ; passé ${seconds(limitMs)}, ${WORDS[u.kind].ignored}.`;
/** Le fautif répond de nouveau. */
export const recoveredLine = (u: Unit) => `${tag} ${head(u)} répond de nouveau.`;
/** Réinitialisation automatique d'un module resté bloqué. */
export const resetLine = (moduleId: string, episodes: number) => `${tag} Le module ${safeName(moduleId)} est resté sans réponse ${episodes} fois de suite : il est réinitialisé (son code est rechargé ; ses données et ses réglages ne sont pas touchés).`;
