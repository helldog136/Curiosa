import { callProvider, providerInstance } from "@/core/modules/dependencies";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { getSetting, setSetting } from "@/core/settings";

/**
 * REPRISE FINALE DES JAQUETTES DE JEUX (RAWG) — le cœur n'a plus de service RAWG depuis la 0.3.0 : les jaquettes sont le service `game.cover` du module officiel « game-covers ».
 * Ce fichier ne fait qu'UNE chose : s'assurer qu'un site qui avait confié sa clé RAWG et ses corrections « Quel est le bon jeu ? » au cœur (versions 0.2.x) les retrouve dans
 * le module, sans rien demander à personne. Il est la raison pour laquelle aucune mise à jour (0.2.13 → 0.3.0, 0.2.14 → 0.3.0, sauvegarde restaurée…) ne fait perdre une clé ou un choix.
 *
 *   1. LIRE, JAMAIS ÉCRIRE. Les anciennes données restent où elles sont : réglages `rawg.key`, `rawg.fixes`, `rawg.toCheck` (journal). Rien n'est effacé, déplacé ni modifié par la 0.3.0
 *      (retour à la 0.2.14 possible, sauvegardes d'avant restaurables ; une purge optionnelle viendra plus tard, voir docs/MODULES.md). Aucune valeur ne sort de ce fichier
 *      sauf vers le seul module officiel `game-covers` (la clé ne traverse que la mémoire) : ni affichée, ni journalisée.
 *   2. REPRENDRE UNE FOIS. Tant que le repère `rawg.handover` (jamais une valeur : des dates et des nombres) ne dit pas « fait » ET qu'il reste des données à reprendre, le module est
 *      installé s'il manque (catalogue officiel, avec son instance), puis `adopt` lui confie la clé, les corrections et le journal. `adopt` ne remplace jamais ce que le module a déjà,
 *      donc rejouer (ou reprendre un site dont la reprise avait déjà eu lieu sans repère) ne change rien. Le repère n'est posé que si le module confirme tenir la clé.
 *   3. QUAND ? Au démarrage, après une installation, une mise à jour de module ou une restauration, quand le propriétaire ouvre Réglages › Services externes, et à la première demande
 *      d'un ancien module (`ctx.api.rawg`). Les tentatives réseau (catalogue, installation) sont espacées de 10 minutes, sauf événement explicite. AUCUN minuteur de fond : un site dont
 *      le catalogue est injoignable garde ses données et réessaie au prochain de ces moments. Une seule installation automatique par site : si le propriétaire désinstalle ensuite le
 *      module, il n'est pas remis.
 */
export const COVERS_SERVICE = "game.cover";
export const COVERS_MODULE = "game-covers";
export const HANDOVER_SETTING = "rawg.handover";
const KEY_SETTING = "rawg.key";
const KEY_IMPORTED_SETTING = "rawg.keyImported";
const FIXES_SETTING = "rawg.fixes";
const TO_CHECK_SETTING = "rawg.toCheck";
/** Les deux modules qui, avant le service du cœur, rangeaient la clé dans leurs propres réglages (`instance.<id>.rawgApiKey`). */
const OLD_KEY_MODULES = ["game-suggestions", "planning"];
const OLD_KEY_SETTING = "rawgApiKey";
/** Bornes de ce qui est confié (celles du module : 1000 corrections, 100 titres à vérifier). */
const MAX_FIXES = 1000;
const MAX_TO_CHECK = 100;
const RETRY_MS = 10 * 60_000;
let lastInstallTry = 0;

export type Handover = { installedAt?: string; doneAt?: string; key?: boolean; fixes?: number; todo?: number };
export async function handoverState(): Promise<Handover> {
  const raw = await getSetting<Handover>(HANDOVER_SETTING);
  return raw && typeof raw === "object" ? raw : {};
}

/** Pour les tests : oublie l'espacement des tentatives d'installation. */
export function resetHandover(): void { lastInstallTry = 0; }

async function readRaw(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

/** L'ancienne clé : le réglage du cœur, sinon (si la personne ne l'a jamais retirée) celle qu'un ancien module gardait. LECTURE SEULE. */
async function legacyKey(): Promise<string> {
  const own = await readRaw(KEY_SETTING);
  if (typeof own === "string" && own.trim()) return own.trim();
  if (await readRaw(KEY_IMPORTED_SETTING)) return "";   // déjà reprise, ou retirée exprès par le propriétaire
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId: { in: OLD_KEY_MODULES } }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const instance of instances) {
    const value = await readRaw(`instance.${instance.id}.${OLD_KEY_SETTING}`);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Ce que le cœur garde encore de l'ancien service : de quoi décider s'il y a quelque chose à reprendre. Lecture seule, bornée ; le module valide chaque élément. */
async function legacyData(): Promise<{ key: string; fixes: Record<string, unknown>; todo: unknown[]; empty: boolean }> {
  const key = await legacyKey();
  const rawFixes = await readRaw(FIXES_SETTING);
  const fixes: Record<string, unknown> = {};
  if (rawFixes && typeof rawFixes === "object" && !Array.isArray(rawFixes)) {
    for (const [k, v] of Object.entries(rawFixes as Record<string, unknown>).slice(0, MAX_FIXES)) if (v && typeof v === "object") fixes[k] = v;
  }
  const rawTodo = await readRaw(TO_CHECK_SETTING);
  const todo = (Array.isArray(rawTodo) ? rawTodo : []).filter((d) => d && typeof d === "object").slice(0, MAX_TO_CHECK);
  return { key, fixes, todo, empty: !key && Object.keys(fixes).length === 0 };
}

export type HandoverResult = "nothing" | "done" | "waiting" | "failed";
let running: Promise<HandoverResult> | null = null;

/**
 * Prépare puis fait la reprise. `install` : installer le module du catalogue officiel s'il manque (une seule fois par site, tentatives espacées de 10 minutes). Idempotente :
 * rejouée, elle ne fait rien de plus ; ne lève jamais. « nothing » : le site n'utilisait pas RAWG ; « waiting » : pas de module (encore) ; « failed » : le module a refusé.
 */
export function ensureRawgHandover(opts: { install?: boolean; force?: boolean } = {}): Promise<HandoverResult> {
  // Une tentative est en cours : une demande ordinaire la rejoint ; un événement explicite (`force`) attend qu'elle finisse, puis passe à son tour (elle a pu ignorer l'installation).
  if (running) return opts.force ? running.then(() => ensureRawgHandover(opts)) : running;
  const job = run(opts).catch((error): HandoverResult => { console.error("[rawg] handover failed:", (error as Error)?.name); return "failed"; }).finally(() => { running = null; });
  running = job;
  return job;
}

async function run(opts: { install?: boolean; force?: boolean }): Promise<HandoverResult> {
  const st = await handoverState();
  if (st.doneAt) return "done";
  const legacy = await legacyData();
  if (legacy.empty) return "nothing";

  let provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
  if (!provider && opts.install) {
    await installProvider(st, opts.force === true);
    provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
  }
  if (!provider) return "waiting";

  const r = await callProvider(COVERS_SERVICE, "adopt", { ...(legacy.key ? { key: legacy.key } : {}), fixes: legacy.fixes, todo: legacy.todo }, { moduleId: COVERS_MODULE });
  const v = r.ok && r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : null;
  // Réussi seulement si le module tient bien la clé (quand il y en avait une) : sinon on réessaiera.
  if (!v || v.ok !== true || (legacy.key && v.keyHeld !== true)) return "failed";
  await setSetting(HANDOVER_SETTING, { ...(await handoverState()), doneAt: new Date().toISOString(), key: v.keyHeld === true, fixes: Number(v.fixes) || 0, todo: Number(v.todo) || 0 } satisfies Handover);
  await audit("core", "rawg.handover", COVERS_MODULE);   // jamais une valeur
  return "done";
}

/** Installe le module officiel (avec son instance), une seule fois par site. `force` : un événement explicite passe outre l'espacement. Ne lève jamais ; rien n'est fait sans entrée « officielle » compatible dans le catalogue. */
async function installProvider(st: Handover, force: boolean): Promise<boolean> {
  try {
    const { getModule } = await import("@/core/modules/registry");
    const { ensureDefaultInstance } = await import("@/core/modules/defaultInstance");
    if (await getModule(COVERS_MODULE)) {
      // Installé mais sans instance (une sauvegarde d'avant la reprise vient d'être restaurée, par exemple) alors que le site utilisait RAWG et que la reprise n'est pas faite :
      // il reçoit son instance, sinon il ne fournirait rien. Une reprise déjà faite n'arrive jamais ici : une instance retirée ensuite par la personne n'est pas recréée.
      await ensureDefaultInstance(COVERS_MODULE);
      return true;
    }
    if (st.installedAt) return false;   // installé par nous, puis retiré par la personne : on ne le remet pas
    // Le reste passe par le réseau (catalogue, téléchargement) : tentatives espacées, sauf événement explicite.
    if (!force && Date.now() - lastInstallTry < RETRY_MS) return false;
    lastInstallTry = Date.now();
    const { findCatalogueEntry } = await import("@/core/modules/catalogue");
    const { installFromCatalogue } = await import("@/core/modules/installer");
    const entry = await findCatalogueEntry(COVERS_MODULE);
    if (!entry || entry.origin !== "official" || !entry.compatible || entry.needsNewerCore || !entry.offers?.some((o) => o.service === COVERS_SERVICE)) return false;
    const installed = await installFromCatalogue(COVERS_MODULE);
    if (!installed.ok) { console.error("[rawg] automatic install refused:", installed.error); return false; }
    await ensureDefaultInstance(COVERS_MODULE);
    await setSetting(HANDOVER_SETTING, { ...st, installedAt: new Date().toISOString() } satisfies Handover);
    await audit("core", "module.install.auto", COVERS_MODULE);
    return true;
  } catch (error) {
    console.error("[rawg] automatic install failed:", (error as Error)?.name);
    return false;
  }
}

/** Après une installation, une mise à jour ou une restauration : la reprise se prépare (au mieux, sans jamais faire échouer l'opération). */
export function noteModulesChanged(): Promise<unknown> {
  return ensureRawgHandover({ install: true, force: true }).catch(() => {});
}

/** Reste-t-il des données du cœur à confier au module (reprise pas encore faite) ? Pour l'écran des réglages ; ne lève jamais. */
export async function handoverPending(): Promise<boolean> {
  try { return !(await handoverState()).doneAt && !(await legacyData()).empty; } catch { return false; }
}
