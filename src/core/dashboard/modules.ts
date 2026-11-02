/**
 * TABLEAU DE BORD — ce que les MODULES proposent (clé `dashboard` du manifeste ; format et bornes : spec.ts).
 *
 * Règles (toutes vérifiées par tests/core/dashboard-modules.test.mjs) :
 *  - AFFICHAGE SEULEMENT : le code d'un module n'est appelé que lorsque quelqu'un regarde le tableau de bord. Aucun minuteur, aucune tâche de fond.
 *  - BORNÉ : 1,5 s par appel, 40 appels au plus par affichage, 5 instances par module, une réponse gardée 20 s (un rechargement ne redemande rien), un module en échec n'est pas réinterrogé avant 30 s.
 *  - ISOLÉ : une erreur ou un délai dépassé masque seulement CE module (et une seule ligne au journal du serveur par épisode) ; les autres s'affichent.
 *  - DROITS : un élément n'est montré, et son code n'est appelé, que si la personne détient son droit (`<module>:open` par défaut) ; le contexte du module ne dépend jamais de la personne.
 *  - JAMAIS DE CONFIANCE : tout ce que le module répond passe par spec.ts (types fermés, texte nettoyé, adresses d'administration seulement).
 *  - STREAMÉ : trois fonctions distinctes (`moduleTasks`, `moduleActions`, `moduleCards`) que la page place chacune dans son bloc `Suspense` ; un module lent ne retient que le sien.
 */
import { TIMED_OUT, withDeadline } from "../deadline";
import { can, type AdminUser } from "../auth/access";
import { pickName } from "../instances";
import type { ActiveInstance } from "../modules/registry";
import { buildContext } from "../modules/context";
import type { ModuleContext } from "../modules/types";
import { localized } from "../modules/types";
import { DASHBOARD_LIMITS, fillCount, itemRight, parseCard, parseTaskCount, pickWords, resolveHref, type CardData } from "./spec";

export type ModuleSource = { moduleId: string; moduleName: string; icon: string; instanceId: string; instanceKey: string; instanceName: string; /** Le module a plusieurs instances : le nom de l'instance précise l'élément. */ several: boolean };
export type ModuleTask = ModuleSource & { id: string; label: string; n: number; href: string };
export type ModuleAction = ModuleSource & { id: string; label: string; href: string; icon: string };
export type ModuleCard = ModuleSource & { id: string; title: string; href?: string; data: CardData; empty?: string };

export type DashboardEnv = {
  viewer: AdminUser;
  locale: string;
  defaultLocale: string;
  /** Les instances actives (par défaut : celles du site). Les tests passent les leurs. */
  active?: () => Promise<ActiveInstance[]>;
  /** Le contexte d'une instance (par défaut : celui du cœur). */
  contextFor?: (a: ActiveInstance, locale: string) => Promise<ModuleContext>;
  now?: () => number;
  timeoutMs?: number;
};

// ── Mémoire courte (un seul exemplaire pour tout le processus) ──────────────────────────────────────────────────────────────────────────────

type Memo = { at: number; ok: boolean; value: unknown };
const holder = globalThis as unknown as { curiosaDashboardMemo?: Map<string, Memo> };
const memo = (): Map<string, Memo> => (holder.curiosaDashboardMemo ??= new Map());
/** Oublie tout (tests, restauration). */
export function resetDashboardMemo(): void { memo().clear(); }

async function realActive(): Promise<ActiveInstance[]> {
  const { getActiveInstances } = await import("../modules/registry");
  return getActiveInstances();
}

type Slot = { src: ModuleSource; a: ActiveInstance };

/** Les instances qui ont une déclaration pour cette sorte d'élément, 5 par module au plus, dans l'ordre du site. */
async function slotsFor(env: DashboardEnv, kind: "tasks" | "quickActions" | "cards"): Promise<Slot[]> {
  const all = await (env.active ?? realActive)();
  const perModule = new Map<string, number>();
  const several = new Map<string, number>();
  for (const a of all) if (a.mod.manifest.dashboard?.[kind]?.length) several.set(a.mod.manifest.id, (several.get(a.mod.manifest.id) ?? 0) + 1);
  const out: Slot[] = [];
  for (const a of all) {
    const decl = a.mod.manifest.dashboard?.[kind];
    if (!decl?.length) continue;
    const id = a.mod.manifest.id;
    const taken = perModule.get(id) ?? 0;
    if (taken >= DASHBOARD_LIMITS.instances) continue;
    perModule.set(id, taken + 1);
    out.push({
      a,
      src: {
        moduleId: id,
        moduleName: localized(a.mod.manifest.name, env.locale, env.defaultLocale) || id,
        icon: a.mod.manifest.icon ?? "🧩",
        instanceId: a.instance.id,
        instanceKey: a.instance.key,
        instanceName: pickName(a.instance, env.locale, env.defaultLocale),
        several: (several.get(id) ?? 0) > 1,
      },
    });
  }
  return out;
}

/** Appelle UNE fonction de module : délai, mémoire courte, isolation. Renvoie la réponse brute, ou undefined si le module n'a pas répondu (jamais d'exception). */
async function guarded(env: DashboardEnv, slot: Slot, key: string, call: (ctx: ModuleContext) => unknown): Promise<unknown | undefined> {
  const now = (env.now ?? Date.now)();
  const store = memo();
  const k = `${slot.src.instanceId}|${env.locale}|${key}`;
  const seen = store.get(k);
  if (seen && now - seen.at < (seen.ok ? DASHBOARD_LIMITS.cacheMs : DASHBOARD_LIMITS.failMs)) return seen.ok ? seen.value : undefined;
  const remember = (ok: boolean, value: unknown) => {
    if (store.size >= DASHBOARD_LIMITS.cacheEntries) store.clear();
    store.set(k, { at: now, ok, value });
  };
  try {
    const ctx = await (env.contextFor ?? ((a, loc) => buildContext(a.mod, a.instance, loc)))(slot.a, env.locale);
    const value = await withDeadline(() => call(ctx), env.timeoutMs ?? DASHBOARD_LIMITS.timeoutMs);
    if (value === TIMED_OUT) {
      if (!seen || seen.ok) console.error(`[dashboard] ${slot.src.instanceKey} ${key} did not answer within ${env.timeoutMs ?? DASHBOARD_LIMITS.timeoutMs} ms: hidden for now`);
      remember(false, undefined);
      return undefined;
    }
    remember(true, value);
    return value;
  } catch (error) {
    if (!seen || seen.ok) console.error(`[dashboard] ${slot.src.instanceKey} ${key} failed:`, error instanceof Error ? error.message : error);
    remember(false, undefined);
    return undefined;
  }
}

/** Au plus `calls` appels par affichage : les suivants ne sont pas faits (ils ne sont pas montrés). */
function budget(): { take: () => boolean } {
  let left: number = DASHBOARD_LIMITS.calls;
  return { take: () => left-- > 0 };
}

const allowed = (env: DashboardEnv, moduleId: string, right: string | undefined): boolean => {
  const full = itemRight(moduleId, right);
  return !!full && can(env.viewer, full);
};

// ── Tâches : « ce qui attend une action » ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les tâches des modules que cette personne a le droit de voir : nombre > 0 seulement, les plus nombreuses d'abord. */
export async function moduleTasks(env: DashboardEnv): Promise<ModuleTask[]> {
  const slots = await slotsFor(env, "tasks");
  const calls = budget();
  const jobs: Promise<ModuleTask | null>[] = [];
  for (const slot of slots) {
    for (const decl of slot.a.mod.manifest.dashboard?.tasks ?? []) {
      const fn = slot.a.mod.def.dashboard?.tasks?.[decl.id];
      if (typeof fn !== "function" || !allowed(env, slot.src.moduleId, decl.right) || !calls.take()) continue;
      jobs.push((async () => {
        const n = parseTaskCount(await guarded(env, slot, `task:${decl.id}`, fn));
        const href = resolveHref(decl.href, { id: slot.src.instanceId, key: slot.src.instanceKey });
        if (!n || !href) return null;
        const label = fillCount(pickWords(decl.label, env.locale, env.defaultLocale), n);
        return { ...slot.src, id: decl.id, label: slot.src.several ? `${label} (${slot.src.instanceName})` : label, n, href };
      })());
    }
  }
  const done = (await Promise.all(jobs)).filter((t): t is ModuleTask => t !== null);
  return done.sort((x, y) => y.n - x.n || x.moduleName.localeCompare(y.moduleName)).slice(0, DASHBOARD_LIMITS.shownTasks);
}

// ── Actions rapides : « Créer… » (déclaration seule, aucun code de module) ───────────────────────────────────────────────────────────────

export async function moduleActions(env: DashboardEnv): Promise<ModuleAction[]> {
  const slots = await slotsFor(env, "quickActions");
  const out: ModuleAction[] = [];
  for (const slot of slots) {
    for (const decl of slot.a.mod.manifest.dashboard?.quickActions ?? []) {
      if (!allowed(env, slot.src.moduleId, decl.right)) continue;
      const href = resolveHref(decl.href, { id: slot.src.instanceId, key: slot.src.instanceKey });
      const label = cleanLabel(pickWords(decl.label, env.locale, env.defaultLocale));
      if (!href || !label) continue;
      out.push({ ...slot.src, id: decl.id, label: slot.src.several ? `${label} (${slot.src.instanceName})` : label, href, icon: decl.icon ?? slot.src.icon });
    }
  }
  return out.slice(0, DASHBOARD_LIMITS.shownActions);
}

const cleanLabel = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, DASHBOARD_LIMITS.labelChars);

// ── Cartes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les cartes d'information des modules (un chiffre, ou une courte liste), 4 au plus. Une carte « liste » vide dit pourquoi (`empty`) au lieu de disparaître si le module l'a prévu. */
export async function moduleCards(env: DashboardEnv): Promise<ModuleCard[]> {
  const slots = await slotsFor(env, "cards");
  const calls = budget();
  const jobs: Promise<ModuleCard | null>[] = [];
  for (const slot of slots) {
    for (const decl of slot.a.mod.manifest.dashboard?.cards ?? []) {
      const fn = slot.a.mod.def.dashboard?.cards?.[decl.id];
      if (typeof fn !== "function" || !allowed(env, slot.src.moduleId, decl.right) || !calls.take()) continue;
      jobs.push((async () => {
        const raw = await guarded(env, slot, `card:${decl.id}`, fn);
        if (raw === undefined) return null;
        const data = parseCard(decl.type, raw, { id: slot.src.instanceId, key: slot.src.instanceKey });
        if (!data) return null;
        const empty = decl.empty ? cleanLabel(pickWords(decl.empty, env.locale, env.defaultLocale)) : "";
        if (data.type === "list" && data.rows.length === 0 && !empty) return null;
        const title = cleanLabel(pickWords(decl.title, env.locale, env.defaultLocale));
        const href = decl.href ? resolveHref(decl.href, { id: slot.src.instanceId, key: slot.src.instanceKey }) : null;
        return { ...slot.src, id: decl.id, title: slot.src.several ? `${title} (${slot.src.instanceName})` : title, ...(href ? { href } : {}), data, ...(empty ? { empty } : {}) };
      })());
    }
  }
  return (await Promise.all(jobs)).filter((c): c is ModuleCard => c !== null).slice(0, DASHBOARD_LIMITS.shownCards);
}
