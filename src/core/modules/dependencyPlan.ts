import { getCatalogue, type CatalogueEntry } from "./catalogue";
import { liveProviders } from "./dependencies";
import { listModuleRows, getModule } from "./registry";
import { hardNeeds, normalizeOffers, offerVersionOf, satisfiesVersion, type ServiceNeed, type ServiceOffer } from "./serviceVersions";
import type { ParsedManifest } from "./manifest";

/**
 * RÉSOLUTION DES DÉPENDANCES — QUI fournira un service qui manque (choix + aperçu). Ne modifie rien : l'installation réelle est dans
 * dependencyInstaller.ts. Règle de choix, toujours la même et sans hasard :
 *   1. un fournisseur déjà EN PLACE (instance existante, version suffisante) → rien à faire (si deux le sont, le mécanisme maître/répliques décide) ;
 *   2. sinon un module DÉJÀ INSTALLÉ qui offre le service, version suffisante (mais sans instance), par identifiant ;
 *   3. sinon un module installé mais TROP ANCIEN dont le catalogue propose une version suffisante : il est MIS À JOUR ;
 *   4. sinon un module du CATALOGUE non installé, dans l'ordre de l'index (stable).
 * Le catalogue officiel passe toujours avant l'index supplémentaire (`origin: "extra"`), qui n'est JAMAIS installé ni mis à jour d'office : il n'est que signalé
 * (raison « extra »), pour un clic du propriétaire. Seuls les modules du catalogue, compatibles avec ce cœur, sont installés d'office ; jamais un dépôt personnel.
 * Les besoins FACULTATIFS (`optional`) n'entrent jamais ici.
 */
export type Candidate =
  | { id: string; from: "installed" }
  | { id: string; from: "update"; entry: CatalogueEntry }
  | { id: string; from: "catalogue"; entry: CatalogueEntry };

export type InstalledView = { id: string; offers: ServiceOffer[] };

/** L'entrée vient-elle de l'index supplémentaire (jamais installée d'office) ? Une entrée sans origine (ancienne forme) compte comme officielle. */
export const isExtra = (e: Pick<CatalogueEntry, "origin"> | undefined): boolean => e?.origin === "extra";

/** Candidats pour `need`, du préféré au dernier. Pur : le monde (installés, catalogue) est passé en paramètre. */
export function rankCandidates(need: ServiceNeed, installed: InstalledView[], catalogue: CatalogueEntry[], exclude: ReadonlySet<string>): Candidate[] {
  const offers = (offs: ServiceOffer[] | undefined) => satisfiesVersion(offerVersionOf(offs, need.service), need.min);
  const usable = (e: CatalogueEntry) => !exclude.has(e.id) && e.compatible && !e.needsNewerCore && offers(e.offers);
  const fromInstalled = installed.filter((m) => !exclude.has(m.id) && offers(m.offers));
  const have = new Set(installed.map((m) => m.id));
  // Installé, offre le service mais en version trop ancienne : le catalogue propose-t-il mieux pour ce même module ?
  const tooOld = new Set(installed.filter((m) => !offers(m.offers) && offerVersionOf(m.offers, need.service) !== null).map((m) => m.id));
  const updates = catalogue.filter((e) => tooOld.has(e.id) && usable(e));
  const fromCatalogue = catalogue.filter((e) => !have.has(e.id) && usable(e));
  const byOrigin = (extra: boolean): Candidate[] => [
    ...updates.filter((e) => isExtra(e) === extra).map((entry): Candidate => ({ id: entry.id, from: "update", entry })),
    ...fromCatalogue.filter((e) => isExtra(e) === extra).map((entry): Candidate => ({ id: entry.id, from: "catalogue", entry })),
  ];
  return [
    ...[...fromInstalled].sort((a, b) => a.id.localeCompare(b.id)).map((m): Candidate => ({ id: m.id, from: "installed" })),
    ...byOrigin(false),
    ...byOrigin(true),
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
    if (mod) out.push({ id: row.id, offers: normalizeOffers(mod.manifest.offers) });
  }
  return out;
}

/* ───────────── Aperçu : ce que fera l'installation, avant de la lancer ───────────── */

export type PlanStep = {
  id: string;
  /** present : déjà en place · setup : installé, recevra son instance (ses données gardées, sinon une neuve) · update : installé mais trop ancien, sera mis à jour · install : sera téléchargé, avec son instance. */
  action: "present" | "setup" | "update" | "install";
  services: string[];
};
/** `extra` : seul un module de l'index supplémentaire (non vérifié) l'offre ; il n'est jamais installé d'office (`module` le nomme). */
export type PlanProblem = { service: string; min: number; have: number | null; reason: "none" | "old" | "cycle" | "depth" | "extra"; chain?: string[]; module?: string };
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
      if (need.optional) continue;   // facultatif : jamais installé d'office (voir viewPlan, « Fonctionne mieux avec… »)
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
      if (candidate.from !== "installed" && isExtra(candidate.entry)) { plan.problems.push({ service: need.service, min: need.min, have: bestKnownVersion(need.service, installed), reason: "extra", module: candidate.id }); continue; }
      // Les besoins du fournisseur d'abord (ordre topologique), puis lui.
      const own = candidate.from === "installed"
        ? hardNeeds((await getModule(candidate.id))?.manifest.requires)
        : (candidate.entry.needs ?? []).filter((n) => !n.optional);
      await resolve(candidate.id, own, [...path, candidate.id]);
      add({ id: candidate.id, action: candidate.from === "installed" ? "setup" : candidate.from === "update" ? "update" : "install", services: [need.service] });
    }
  }
  await resolve(rootId, needs, opts.path ?? [rootId]);
  return plan;
}

/** Aperçu pour un module DÉJÀ installé (page du module, activation). */
export async function planForManifest(manifest: ParsedManifest): Promise<DependencyPlan> {
  return planDependencies(manifest.id, hardNeeds(manifest.requires));
}

