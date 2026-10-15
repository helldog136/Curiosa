import { getCatalogue, type CatalogueEntry } from "./catalogue";
import { cleanupSuggestions, readAuto } from "./autoInstalled";
import { liveProviders, lossesIfStopped, requirementGaps, type Gap } from "./dependencies";
import { planDependencies, type DependencyPlan, type PlanProblem, type PlanStep } from "./dependencyPlan";
import { listModuleRows, loadModule, getModule } from "./registry";
import { localized } from "./types";
import { normalizeNeeds, offerVersionOf, satisfiesVersion, type ServiceNeed } from "./serviceVersions";
import type { Names } from "./dependencyMessages";

/**
 * DONNÉES DE L'INTERFACE pour les dépendances : tout ce que les écrans affichent (Catalogue, fiche, page d'un module, liste des modules),
 * déjà en clair (noms localisés) et sans rien modifier. Les composants ne font que mettre en page.
 */

/** Noms lisibles : modules installés et du catalogue ; un service prend le libellé déclaré (`label` d'un `offers`/`requires`), sinon le nom du module qui le fournit. */
export async function buildNames(locale: string, defaultLocale: string, catalogue?: CatalogueEntry[]): Promise<Names> {
  const market = catalogue ?? (await getCatalogue().catch((): CatalogueEntry[] => []));
  const modules = new Map<string, string>();
  const services = new Map<string, string>();
  const remember = (service: string, label: string | undefined, fallback: string) => { if (!services.has(service) || label) services.set(service, label || services.get(service) || fallback); };
  for (const e of market) {
    modules.set(e.id, localized(e.name, locale, defaultLocale));
    for (const o of e.offers ?? []) remember(o.service, undefined, localized(e.name, locale, defaultLocale));
  }
  for (const row of await listModuleRows()) {
    const mod = await loadModule(row).catch(() => null);
    if (!mod) continue;
    const name = localized(mod.manifest.name, locale, defaultLocale);
    modules.set(row.id, name);
    for (const o of mod.manifest.offers ?? []) remember(o.service, o.label ? localized(o.label, locale, defaultLocale) : undefined, name);
    for (const r of mod.manifest.requires ?? []) if (r.label && !services.has(r.service)) services.set(r.service, localized(r.label, locale, defaultLocale));
  }
  return { module: (id) => modules.get(id) ?? id, service: (s) => services.get(s) ?? s };
}

export type PlanLine = { id: string; name: string; icon: string; action: PlanStep["action"]; /** Libellés des services qu'il apporte. */ services: string[] };
export type PlanView = { lines: PlanLine[]; problems: (PlanProblem & { text?: never })[]; /** Quelque chose sera installé ou activé en plus. */ adds: boolean };

/** Ce que l'installation de ce module apportera aussi, avant de la lancer. `needs` : manifeste réel si on l'a lu, sinon ce que l'index annonce. */
export async function viewPlan(rootId: string, needs: ServiceNeed[], names: Names, catalogue?: CatalogueEntry[]): Promise<PlanView> {
  if (!needs.length) return { lines: [], problems: [], adds: false };
  const market = catalogue ?? (await getCatalogue().catch((): CatalogueEntry[] => []));
  const plan: DependencyPlan = await planDependencies(rootId, needs, { catalogue: market });
  const iconOf = async (id: string) => (await getModule(id).catch(() => null))?.manifest.icon ?? market.find((e) => e.id === id)?.icon ?? "🧩";
  const lines: PlanLine[] = [];
  for (const s of plan.steps) lines.push({ id: s.id, name: names.module(s.id), icon: await iconOf(s.id), action: s.action, services: s.services.map(names.service) });
  return { lines, problems: plan.problems, adds: plan.steps.some((s) => s.action !== "present") };
}

/* ───────────── Page d'un module ───────────── */

export type NeedView = { service: string; label: string; min: number; ok: boolean; /** Modules qui le fournissent (actifs d'abord). */ providers: { id: string; name: string; active: boolean }[]; gap?: Gap };
export type UsedByView = { id: string; name: string; services: string[] };
export type ModuleLinksView = {
  needs: NeedView[];
  usedBy: UsedByView[];
  gaps: Gap[];
  /** Installé automatiquement pour : noms des modules. */
  autoFor: string[] | null;
  /** Le nettoyage est proposé (plus personne n'en dépend) ; `hasData` : il porte des données ou des réglages. */
  cleanup: { hasData: boolean } | null;
  /** Ce que perdraient les dépendants si on l'arrêtait (pour expliquer un refus). */
  losses: { module: string; name: string; services: string[] }[];
};

export async function viewModuleLinks(moduleId: string, names: Names): Promise<ModuleLinksView> {
  const mod = await getModule(moduleId);
  const rows = await listModuleRows();
  const live = await liveProviders(moduleId);
  const needs: NeedView[] = [];
  const gaps = mod ? await requirementGaps(mod.manifest) : [];
  for (const n of normalizeNeeds(mod?.manifest.requires)) {
    const providers: NeedView["providers"] = [];
    for (const row of rows) {
      if (row.id === moduleId) continue;
      const other = await getModule(row.id);
      if (!other || !satisfiesVersion(offerVersionOf(other.manifest.offers, n.service), n.min)) continue;
      providers.push({ id: row.id, name: names.module(row.id), active: live.some((p) => p.manifest.id === row.id) });
    }
    providers.sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));
    const gap = gaps.find((g) => g.service === n.service);
    needs.push({ service: n.service, label: names.service(n.service), min: n.min, ok: !gap, providers, gap });
  }
  const usedBy: UsedByView[] = [];
  const offered = new Set((mod?.manifest.offers ?? []).map((o) => o.service));
  if (offered.size) {
    for (const row of rows) {
      if (row.id === moduleId) continue;
      const other = await getModule(row.id);
      const used = (other?.manifest.requires ?? []).filter((r) => offered.has(r.service));
      if (used.length) usedBy.push({ id: row.id, name: names.module(row.id), services: used.map((r) => names.service(r.service)) });
    }
  }
  const auto = (await readAuto())[moduleId];
  const suggestion = (await cleanupSuggestions()).find((c) => c.id === moduleId);
  const rowIds = new Set(rows.map((r) => r.id));
  const autoFor = auto?.module ? auto.for.filter((f) => rowIds.has(f)).map(names.module) : null;
  const losses = (await lossesIfStopped(moduleId)).map((l) => ({ module: l.module, name: names.module(l.module), services: l.services.map(names.service) }));
  return { needs, usedBy, gaps, autoFor: autoFor && autoFor.length ? autoFor : auto?.module ? [] : null, cleanup: suggestion ? { hasData: suggestion.hasData } : null, losses };
}

/** Modules actifs auxquels il manque quelque chose (pastille « Il manque » dans la liste des modules). */
export async function missingByModule(): Promise<Map<string, Gap[]>> {
  const out = new Map<string, Gap[]>();
  for (const row of await listModuleRows()) {
    const mod = await getModule(row.id);
    const gaps = mod ? await requirementGaps(mod.manifest) : [];
    if (gaps.length) out.set(row.id, gaps);
  }
  return out;
}
