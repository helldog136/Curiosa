import { getCatalogue, type CatalogueEntry } from "@/core/modules/catalogue";
import { rankCandidates, installedViews } from "@/core/modules/dependencyPlan";
import { settleDependencies } from "@/core/modules/installer";
import { getModule } from "@/core/modules/registry";
import { normalizeNeeds, normalizeOffers, satisfiesVersion, offerVersionOf, type ServiceNeed, type ServiceOffer } from "@/core/modules/serviceVersions";
import type { Missing } from "@/core/modules/dependencyInstaller";

/**
 * DÉPENDANCES ET RESTAURATION. Une sauvegarde remet des modules et leurs données ; ici on s'assure que ceux qui sont actifs retrouvent ce dont
 * ils ont besoin, sans jamais interrompre la restauration ni perdre de donnée :
 *   - avant : réinstaller les modules dans l'ORDRE des dépendances (fournisseurs d'abord) ;
 *   - aperçu : dire « il manque : … » pour un module actif dont le fournisseur n'est ni dans la sauvegarde, ni installé, ni disponible ;
 *   - après : pour chaque module restauré ACTIF, installer d'office le fournisseur disponible (livré, catalogue) avec son instance par défaut ;
 *     sinon le module est gardé tel que sauvegardé et le bilan dit ce qui manque.
 */
export type DependencyIssue = { id: string; missing: Missing[] };
export type ModuleLinks = { offers: ServiceOffer[]; needs: ServiceNeed[] };

/** Ordre topologique STABLE : un fournisseur passe avant ses consommateurs ; sans lien (ou en cycle), l'ordre d'origine est gardé. */
export function orderByDependencies<T extends { id: string }>(items: T[], linksOf: (id: string) => ModuleLinks | undefined): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const providersOf = (item: T): string[] => {
    const links = linksOf(item.id);
    if (!links) return [];
    return items.filter((o) => o.id !== item.id && links.needs.some((n) => satisfiesVersion(offerVersionOf(linksOf(o.id)?.offers, n.service), n.min))).map((o) => o.id);
  };
  const out: T[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (item: T) => {
    if (state.has(item.id)) return;   // déjà placé, ou cycle en cours : on garde l'ordre d'origine
    state.set(item.id, "visiting");
    for (const p of providersOf(item)) { const dep = byId.get(p); if (dep) visit(dep); }
    state.set(item.id, "done");
    out.push(item);
  };
  items.forEach(visit);
  return out;
}

/** Offres et besoins connus d'un module de la sauvegarde SANS le télécharger : installé (manifeste), sinon catalogue (livré : manifeste, reconnu : index). */
export async function linksFor(ids: string[], catalogue?: CatalogueEntry[]): Promise<Map<string, ModuleLinks>> {
  const market = catalogue ?? (await getCatalogue().catch(() => []));
  const out = new Map<string, ModuleLinks>();
  for (const id of ids) {
    const mod = await getModule(id).catch(() => null);
    if (mod) { out.set(id, { offers: normalizeOffers(mod.manifest.offers), needs: normalizeNeeds(mod.manifest.requires) }); continue; }
    const entry = market.find((e) => e.id === id);
    if (entry) out.set(id, { offers: entry.offers ?? [], needs: entry.needs ?? [] });
  }
  return out;
}

/** Aperçu (rien n'est modifié) : les modules ACTIFS de la sauvegarde dont un besoin ne sera couvert par personne. */
export async function previewMissing(modules: { id: string; enabled: boolean; status: string }[], catalogue?: CatalogueEntry[]): Promise<DependencyIssue[]> {
  const market = catalogue ?? (await getCatalogue().catch(() => []));
  const live = modules.filter((m) => m.status !== "unavailable");
  const links = await linksFor(live.map((m) => m.id), market);
  const installed = await installedViews();
  const issues: DependencyIssue[] = [];
  for (const m of live) {
    if (!m.enabled || m.status === "custom") continue;   // un dépôt personnel n'est lu qu'une fois confirmé : on ne devine pas
    const missing: Missing[] = [];
    for (const need of links.get(m.id)?.needs ?? []) {
      const inBackup = live.some((o) => o.id !== m.id && satisfiesVersion(offerVersionOf(links.get(o.id)?.offers, need.service), need.min));
      if (inBackup || rankCandidates(need, installed, market, new Set([m.id])).length) continue;
      missing.push({ service: need.service, min: need.min, have: null, reason: "none" });
    }
    if (missing.length) issues.push({ id: m.id, missing });
  }
  return issues;
}

/** Après la restauration : installe d'office ce qui manque aux modules actifs (fournisseur disponible + instance par défaut) ; sinon le dit. Ne lève jamais. */
export async function settleRestored(ids: string[]): Promise<{ issues: DependencyIssue[]; provided: string[] }> {
  const issues: DependencyIssue[] = [];
  const provided: string[] = [];
  for (const id of ids) {
    const r = await settleDependencies(id);
    if (r.provided) provided.push(...r.provided);
    if (r.missing?.length) issues.push({ id, missing: r.missing });
  }
  return { issues, provided: [...new Set(provided)] };
}
