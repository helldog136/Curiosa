import { getCatalogue, readBundledManifest, type CatalogueEntry } from "./catalogue";
import { liveProviders } from "./dependencies";
import { listModuleRows, getModule } from "./registry";
import { normalizeNeeds, normalizeOffers, offerVersionOf, satisfiesVersion, type ServiceNeed, type ServiceOffer } from "./serviceVersions";
import type { ParsedManifest } from "./manifest";

/**
 * RÉSOLUTION DES DÉPENDANCES — QUI fournira un service qui manque (choix + aperçu). Ne modifie rien : l'installation réelle est dans
 * dependencyInstaller.ts. Règle de choix, toujours la même et sans hasard :
 *   1. un fournisseur déjà ACTIF (instance active, version suffisante) → rien à faire (si deux le sont, le mécanisme maître/répliques décide) ;
 *   2. sinon un module DÉJÀ INSTALLÉ qui offre le service, version suffisante : d'abord ceux qui sont activés (mais sans instance), puis les
 *      désactivés, chaque groupe par identifiant ;
 *   3. sinon un module du CATALOGUE non installé : dans l'ordre de l'index, dans l'ordre de l'index (stable).
 * Seuls les modules du catalogue (reconnus), compatibles avec ce cœur, sont installés d'office ; jamais un dépôt personnel.
 */
export type Candidate =
  | { id: string; from: "installed"; enabled: boolean }
  | { id: string; from: "catalogue"; entry: CatalogueEntry };

export type InstalledView = { id: string; enabled: boolean; offers: ServiceOffer[] };

/** Candidats pour `need`, du préféré au dernier. Pur : le monde (installés, catalogue) est passé en paramètre. */
export function rankCandidates(need: ServiceNeed, installed: InstalledView[], catalogue: CatalogueEntry[], exclude: ReadonlySet<string>): Candidate[] {
  const offers = (offs: ServiceOffer[] | undefined) => satisfiesVersion(offerVersionOf(offs, need.service), need.min);
  const fromInstalled = installed.filter((m) => !exclude.has(m.id) && offers(m.offers));
  const enabled = fromInstalled.filter((m) => m.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const disabled = fromInstalled.filter((m) => !m.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const have = new Set(installed.map((m) => m.id));
  const fromCatalogue = catalogue.filter((e) => !have.has(e.id) && !exclude.has(e.id) && e.compatible && !e.needsNewerCore && offers(e.offers));
  return [
    ...enabled.map((m): Candidate => ({ id: m.id, from: "installed", enabled: true })),
    ...disabled.map((m): Candidate => ({ id: m.id, from: "installed", enabled: false })),
    ...fromCatalogue.map((entry): Candidate => ({ id: entry.id, from: "catalogue", entry })),
  ];
}

/** Meilleure version d'un service parmi les modules installés ou du catalogue (pour dire « vous avez la 1 »). */
export function bestKnownVersion(service: string, installed: InstalledView[], catalogue: CatalogueEntry[] = []): number | null {
  const v = [...installed.map((m) => offerVersionOf(m.offers, service)), ...catalogue.map((e) => offerVersionOf(e.offers, service))].filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
}

export async function installedViews(): Promise<InstalledView[]> {
  const out: InstalledView[] = [];
  for (const row of await listModuleRows()) {
    const mod = await getModule(row.id);
    if (mod) out.push({ id: row.id, enabled: row.enabled, offers: normalizeOffers(mod.manifest.offers) });
  }
  return out;
}

/* ───────────── Aperçu : ce que fera l'installation, avant de la lancer ───────────── */

export type PlanStep = {
  id: string;
  /** present : déjà actif · enable : installé, sera activé (et recevra une instance si besoin) · install : sera téléchargé, activé, avec son instance. */
  action: "present" | "enable" | "install";
  services: string[];
};
export type PlanProblem = { service: string; min: number; have: number | null; reason: "none" | "old" | "cycle" | "depth"; chain?: string[] };
export type DependencyPlan = { steps: PlanStep[]; problems: PlanProblem[] };

export const MAX_DEPTH = 3;

/**
 * Aperçu pour un module dont on connaît les besoins (`needs`) : installé (manifeste) ou du catalogue (index, facultatif).
 * Ordre topologique : les fournisseurs des fournisseurs d'abord.
 */
export async function planDependencies(rootId: string, needs: ServiceNeed[], opts: { catalogue?: CatalogueEntry[]; path?: string[] } = {}): Promise<DependencyPlan> {
  const catalogue = opts.catalogue ?? (await getCatalogue().catch(() => []));
  const installed = await installedViews();
  const live = await liveProviders(rootId);
  const plan: DependencyPlan = { steps: [], problems: [] };
  const add = (step: PlanStep) => {
    const known = plan.steps.find((s) => s.id === step.id);
    if (known) known.services = [...new Set([...known.services, ...step.services])];
    else plan.steps.push(step);
  };

  async function resolve(id: string, list: ServiceNeed[], path: string[]): Promise<void> {
    for (const need of list) {
      const active = live.filter((p) => p.manifest.id !== id && satisfiesVersion(offerVersionOf(p.manifest.offers, need.service), need.min));
      if (active.length) { for (const a of active) add({ id: a.manifest.id, action: "present", services: [need.service] }); continue; }
      const planned = plan.steps.find((s) => s.action !== "present" && s.id !== id && s.services.includes(need.service));
      if (planned) continue;
      const exclude = new Set(path);
      const cycle = rankCandidates(need, installed, catalogue, new Set()).find((c) => exclude.has(c.id));
      const candidate = rankCandidates(need, installed, catalogue, exclude)[0];
      if (!candidate) {
        if (cycle) plan.problems.push({ service: need.service, min: need.min, have: null, reason: "cycle", chain: [...path, cycle.id] });
        else plan.problems.push({ service: need.service, min: need.min, have: bestKnownVersion(need.service, installed, catalogue), reason: bestKnownVersion(need.service, installed, catalogue) === null ? "none" : "old" });
        continue;
      }
      if (path.length > MAX_DEPTH) { plan.problems.push({ service: need.service, min: need.min, have: null, reason: "depth", chain: [...path, candidate.id] }); continue; }
      // Les besoins du fournisseur d'abord (ordre topologique), puis lui.
      const own = candidate.from === "installed"
        ? normalizeNeeds((await getModule(candidate.id))?.manifest.requires)
        : candidate.entry.source === "bundled" && candidate.entry.dir ? normalizeNeeds(readBundledManifest(candidate.entry.dir)?.requires) : candidate.entry.needs ?? [];
      await resolve(candidate.id, own, [...path, candidate.id]);
      add({ id: candidate.id, action: candidate.from === "installed" ? "enable" : "install", services: [need.service] });
    }
  }
  await resolve(rootId, needs, opts.path ?? [rootId]);
  return plan;
}

/** Aperçu pour un module DÉJÀ installé (page du module, activation). */
export async function planForManifest(manifest: ParsedManifest): Promise<DependencyPlan> {
  return planDependencies(manifest.id, normalizeNeeds(manifest.requires));
}

