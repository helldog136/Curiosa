import { prisma } from "../db";
import { audit, can, type AdminUser } from "../permissions";
import { deleteSetting, getSetting, setSetting } from "../settings";
import { getCatalogue, type CatalogueEntry } from "./catalogue";
import { liveProviders } from "./dependencies";
import { ensureDefaultInstance } from "./defaultInstance";
import { installFromCatalogue, type InstallResult } from "./installer";
import { getModule, listModuleRows } from "./registry";
import { normalizeNeeds, offerVersionOf, satisfiesVersion, SERVICE_RE } from "./serviceVersions";
import type { LocalizedString } from "./types";

/**
 * BLOC `suggestInstall` (panneau d'admin d'une instance) : « il manque un module qui offre ce service ; en voici, à installer d'un clic ».
 * Le module nomme un SERVICE, jamais un module : le cœur cherche dans le catalogue qui l'offre (officiel d'abord, puis l'index supplémentaire, avec avertissement).
 * Règles :
 *   - rien n'est montré si un fournisseur actif existe déjà, ou si le propriétaire a dit « Ne plus proposer » (réglage `suggest.dismissed.<instance>.<service>`,
 *     remis à zéro seulement par « Afficher de nouveau les suggestions », sur la page de l'instance ; aucun minuteur) ;
 *   - seul le PROPRIÉTAIRE installe, et seulement par un clic (`installSuggested`) : jamais un service, une tâche, une migration ni le MCP (`ctx.api` n'expose aucune installation) ;
 *   - lecture du catalogue bornée à 2 s pendant le rendu ; au-delà, « Catalogue injoignable, réessayez plus tard ».
 */
export const SUGGEST_CATALOGUE_TIMEOUT_MS = 2000;
export const MAX_SUGGESTIONS = 10;
export const dismissKey = (instanceId: string, service: string) => `suggest.dismissed.${instanceId}.${service}`;
const dismissPrefix = (instanceId: string) => `suggest.dismissed.${instanceId}.`;

export type SuggestCandidate = { id: string; name: LocalizedString; description: LocalizedString; icon?: string; origin: "official" | "extra" };
export type SuggestView =
  | { state: "hidden" }
  | { state: "unreachable" }
  | { state: "none" }
  | { state: "list"; candidates: SuggestCandidate[] };

const validService = (s: unknown): s is string => typeof s === "string" && SERVICE_RE.test(s);
const validMin = (m: unknown): number => (typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 1000 ? m : 1);

/** Lecture bornée : au-delà de `ms`, on n'attend plus (la lecture elle-même a ses propres délais et sa mémoire, voir recognized.ts). */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false }>((resolve) => { timer = setTimeout(() => resolve({ ok: false }), ms); });
  try {
    return await Promise.race([work.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Le propriétaire a-t-il refusé cette suggestion pour cette instance ? */
export async function isDismissed(instanceId: string, service: string): Promise<boolean> {
  return !!(await getSetting<string>(dismissKey(instanceId, service)));
}

/** Un fournisseur ACTIF (instance qui tourne, données saines) offre-t-il déjà ce service dans une version suffisante ? */
export async function hasActiveProvider(service: string, min = 1, exceptModule?: string): Promise<boolean> {
  return (await liveProviders(exceptModule)).some((p) => satisfiesVersion(offerVersionOf(p.manifest.offers, service), min));
}

/** Entrées du catalogue qui conviennent : compatibles, offrent `service` ≥ `min`, pas déjà installées ; l'officiel d'abord (ordre de l'index), puis l'extra. Pur. */
export function rankSuggestions(catalogue: CatalogueEntry[], service: string, min: number, installed: ReadonlySet<string>): SuggestCandidate[] {
  const fits = catalogue.filter((e) => e.compatible && !e.needsNewerCore && !installed.has(e.id) && satisfiesVersion(offerVersionOf(e.offers, service), min));
  const view = (e: CatalogueEntry): SuggestCandidate => ({ id: e.id, name: e.name, description: e.description, icon: e.icon, origin: e.origin === "extra" ? "extra" : "official" });
  return [...fits.filter((e) => e.origin !== "extra"), ...fits.filter((e) => e.origin === "extra")].slice(0, MAX_SUGGESTIONS).map(view);
}

/** Ce que le bloc montre (lecture seule, ne lève jamais). `catalogue` : injectable pour les tests. */
export async function suggestionView(instanceId: string, service: unknown, min?: unknown, opts: { catalogue?: () => Promise<CatalogueEntry[]>; timeoutMs?: number } = {}): Promise<SuggestView> {
  try {
    if (!validService(service)) return { state: "hidden" };
    const need = validMin(min);
    if (await isDismissed(instanceId, service)) return { state: "hidden" };
    const owner = await prisma.moduleInstance.findUnique({ where: { id: instanceId }, select: { moduleId: true } });
    if (!owner) return { state: "hidden" };
    if (await hasActiveProvider(service, need, owner.moduleId)) return { state: "hidden" };
    const got = await withDeadline((opts.catalogue ?? (() => getCatalogue()))(), opts.timeoutMs ?? SUGGEST_CATALOGUE_TIMEOUT_MS);
    if (!got.ok) return { state: "unreachable" };
    const installed = new Set((await listModuleRows()).map((r) => r.id));
    const candidates = rankSuggestions(got.value, service, need, installed);
    return candidates.length ? { state: "list", candidates } : { state: "none" };
  } catch (error) {
    console.error("[modules] suggestion failed:", (error as Error)?.message);
    return { state: "hidden" };
  }
}

/** « Ne plus proposer » (propriétaire). */
export async function dismissSuggestion(user: AdminUser | null, instanceId: string, service: string): Promise<boolean> {
  if (!user || !can(user, "core:modules.install") || !validService(service)) return false;
  if (!(await prisma.moduleInstance.findUnique({ where: { id: instanceId }, select: { id: true } }))) return false;
  await setSetting(dismissKey(instanceId, service), new Date().toISOString());
  return true;
}

/** Services refusés pour cette instance (pour « Afficher de nouveau les suggestions »). */
export async function dismissedServices(instanceId: string): Promise<string[]> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: dismissPrefix(instanceId) } }, select: { key: true }, take: 50 });
  return rows.map((r) => r.key.slice(dismissPrefix(instanceId).length)).filter(validService);
}

/** « Afficher de nouveau les suggestions » (propriétaire) : tous les refus de cette instance sont oubliés. */
export async function resetSuggestions(user: AdminUser | null, instanceId: string): Promise<boolean> {
  if (!user || !can(user, "core:modules.install")) return false;
  for (const service of await dismissedServices(instanceId)) await deleteSetting(dismissKey(instanceId, service));
  return true;
}

export type SuggestInstallResult = InstallResult | { ok: false; error: "modules.error.ownerOnly" | "modules.error.suggestInvalid" | "modules.error.extraConfirm" };

/**
 * Installe le module choisi par le propriétaire dans le bloc. Tout est revérifié côté serveur : propriétaire, instance existante dont le module
 * déclare ce service dans `requires`, entrée du catalogue compatible qui offre bien ce service (version ≥ celle exigée), et, pour une entrée « extra »,
 * la confirmation explicite de l'avertissement. Audit : `module.install.suggested` (module, service, origine ; jamais de secret).
 */
export async function installSuggested(user: AdminUser | null, input: { instanceId: string; service: string; moduleId: string; confirmExtra?: boolean }): Promise<SuggestInstallResult> {
  if (!user || !can(user, "core:modules.install")) return { ok: false, error: "modules.error.ownerOnly" };
  const { instanceId, service, moduleId } = input;
  if (!validService(service) || typeof moduleId !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(moduleId)) return { ok: false, error: "modules.error.suggestInvalid" };
  const inst = await prisma.moduleInstance.findUnique({ where: { id: instanceId }, select: { moduleId: true } });
  const consumer = inst ? await getModule(inst.moduleId) : null;
  const need = consumer ? normalizeNeeds(consumer.manifest.requires).find((n) => n.service === service) : undefined;
  if (!need) return { ok: false, error: "modules.error.suggestInvalid" };
  const entry = (await getCatalogue().catch((): CatalogueEntry[] => [])).find((e) => e.id === moduleId);
  if (!entry || !satisfiesVersion(offerVersionOf(entry.offers, service), need.min)) return { ok: false, error: "modules.error.suggestInvalid" };
  if (!entry.compatible) return { ok: false, error: "modules.error.incompatible" };
  if (entry.needsNewerCore) return { ok: false, error: "modules.error.core", detail: entry.needsNewerCore, needsCore: entry.needsNewerCore };
  if (entry.origin === "extra" && input.confirmExtra !== true) return { ok: false, error: "modules.error.extraConfirm" };
  const result = await installFromCatalogue(moduleId, { confirmExtra: entry.origin === "extra" });
  if (result.ok) {
    // Installé pour FOURNIR le service : sans instance il ne fournirait rien (ses données gardées, s'il y en a, sont déjà revenues).
    await ensureDefaultInstance(moduleId).catch((error) => console.error("[modules] default instance failed:", (error as Error)?.message));
    for (const provided of result.provided ?? []) await audit(user.email, "module.install.auto", provided);
    await audit(user.email, "module.install.suggested", `${moduleId} ${service} ${entry.origin}`);
  }
  return result;
}
