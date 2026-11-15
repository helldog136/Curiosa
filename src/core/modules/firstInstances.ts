import { prisma } from "../db";
import { audit } from "../permissions";
import { getSetting, setSetting } from "../settings";
import { requirementGaps } from "./dependencies";
import { ensureDefaultInstance } from "./defaultInstance";
import { hasPage, type ParsedManifest } from "./manifest";
import { getModule, listModuleRows } from "./registry";
import { listRetired } from "./retired";
import { normalizeNeeds } from "./serviceVersions";

/**
 * REPRISE DES MODULES INSTALLÉS SANS COPIE (0.16.0). Avant la 0.16.0, installer un module depuis l'admin (page « Ajouter », fiche d'une extension) ne créait aucune instance :
 * il fallait cliquer « Mettre en place ». Un module sans instance ne montre rien (pas d'élément d'overlay) et ne fournit rien (ses services restent muets).
 * Au premier démarrage de cette version, UNE FOIS, on crée la première instance (réglages par défaut) des modules qui sont dans ce cas ET dans la classe sûre ci-dessous.
 * Les autres sont laissés tels quels (« Mettre en place » reste là) : voir `why` pour chaque refus, consigné au journal.
 *
 * Classe sûre, toutes les conditions ensemble :
 *   - aucune instance, aucune donnée gardée (une personne qui a retiré sa copie ne la voit pas revenir), aucune ligne du journal « instance retirée » pour ce module ;
 *   - rien à régler avant : tous ses besoins durs sont déjà fournis (la reprise n'installe ni ne télécharge rien) ;
 *   - ni page publique (pas d'adresse nouvelle, pas d'entrée au menu), ni tâche planifiée, ni crochet `onInstanceCreate` (un crochet peut joindre un service extérieur) ;
 *   - il montre quelque chose au direct (un élément d'overlay) OU fournit un service qu'un autre module installé déclare (`requires`, dur ou facultatif).
 * Aucune connexion, aucun abonnement, aucun robot n'est lancé par le cœur ; chaque création est notée au journal (`instance.create`, acteur « system »).
 */
export const FIRST_INSTANCES_KEY = "core.firstInstances.v1";

export type FirstInstancesReport = { created: string[]; skipped: { module: string; why: string }[]; already: boolean };

type Candidate = { manifest: ParsedManifest; hooked: boolean; tasked: boolean };

/** Pur : pourquoi ce module n'entre PAS dans la classe sûre (null = il y entre). `consumed` : services déclarés dans `requires` par les autres modules installés. */
export function whyNotSafe(c: Candidate, consumed: ReadonlySet<string>): string | null {
  const m = c.manifest;
  if (hasPage(m)) return "public page";
  if (c.hooked) return "creation hook";
  if (c.tasked) return "scheduled task";
  const showsLive = (m.overlayElements?.length ?? 0) > 0;
  const provides = normalizeOfferedServices(m).some((s) => consumed.has(s));
  if (!showsLive && !provides) return "nothing shown or consumed";
  return null;
}

const normalizeOfferedServices = (m: ParsedManifest): string[] => (m.offers ?? []).map((o) => (typeof o === "string" ? o : o.service));

export async function runFirstInstances(opts: { actor?: string } = {}): Promise<FirstInstancesReport> {
  if (await getSetting(FIRST_INSTANCES_KEY)) return { created: [], skipped: [], already: true };
  const report: FirstInstancesReport = { created: [], skipped: [], already: false };
  const rows = await listModuleRows();
  const loaded = new Map<string, NonNullable<Awaited<ReturnType<typeof getModule>>>>();
  for (const r of rows) { const mod = await getModule(r.id).catch(() => null); if (mod) loaded.set(r.id, mod); }
  const consumed = new Set<string>();
  for (const mod of loaded.values()) for (const n of normalizeNeeds(mod.manifest.requires)) consumed.add(n.service);
  const skip = (module: string, why: string) => report.skipped.push({ module, why });

  for (const [id, mod] of [...loaded].sort(([a], [b]) => a.localeCompare(b))) {
    if ((await prisma.moduleInstance.count({ where: { moduleId: id } })) > 0) continue;
    if ((await listRetired(id)).length) { skip(id, "data kept"); continue; }
    const removed = await prisma.auditLog.findFirst({ where: { action: { in: ["instance.delete", "instance.retire"] }, OR: [{ module: id }, { target: id }, { target: { startsWith: `${id}-` } }] }, select: { id: true } });
    if (removed) { skip(id, "instance removed by the owner"); continue; }
    const why = whyNotSafe({ manifest: mod.manifest, hooked: !!mod.def.hooks?.onInstanceCreate, tasked: Object.keys(mod.def.tasks ?? {}).length > 0 }, consumed);
    if (why) { skip(id, why); continue; }
    if ((await requirementGaps(mod.manifest)).length) { skip(id, "missing requirement"); continue; }
    try {
      const made = await ensureDefaultInstance(id);
      if (made?.kind === "created") {
        const row = await prisma.moduleInstance.findUnique({ where: { id: made.instanceId }, select: { key: true } });
        await audit(opts.actor ?? "system", "instance.create", row?.key ?? id, { module: id, instance: row?.key ?? "" });
        report.created.push(id);
      } else if (!made) skip(id, "not loaded");
    } catch (error) {
      skip(id, "failed");
      console.error(`[modules] first instance of ${id} failed:`, (error as Error)?.message);
    }
  }
  // Marqueur : la reprise ne tourne qu'UNE fois. Une instance retirée plus tard à la main ne revient donc jamais. Un échec technique (« failed ») n'en pose pas : le démarrage suivant reprend.
  if (report.skipped.some((x) => x.why === "failed" || x.why === "not loaded")) return report;
  await setSetting(FIRST_INSTANCES_KEY, { at: new Date().toISOString(), created: report.created, skipped: report.skipped.map((s) => `${s.module}: ${s.why}`) });
  return report;
}
