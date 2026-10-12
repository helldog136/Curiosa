import { prisma } from "../db";
import { getModule } from "./registry";
import { liveProviders, requirementGaps, type Gap } from "./dependencies";
import { bestKnownVersion, installedViews, MAX_DEPTH, rankCandidates, type Candidate } from "./dependencyPlan";
import { ensureDefaultInstance, undoDefaultInstance } from "./defaultInstance";
import { markAuto } from "./autoInstalled";
import { satisfiesVersion, offerVersionOf } from "./serviceVersions";
import type { CatalogueEntry } from "./catalogue";
import type { ParsedManifest } from "./manifest";

/**
 * INSTALLATION DES DÉPENDANCES — exécute le plan : pour chaque service qui manque, installe (si besoin), active le fournisseur choisi
 * (voir dependencyPlan.ts pour la règle de choix) et lui donne son instance par défaut, après avoir fait de même pour SES propres besoins
 * (profondeur 3 au plus, cycle refusé). Tout est consigné dans un JOURNAL : au moindre échec on défait, à l'envers, tout ce qui a été fait.
 * Ce fichier ne sait ni cloner ni supprimer un module : l'installateur lui prête ces gestes (`DepOps`), ce qui évite tout import circulaire.
 */
export type DepOps = {
  catalogue(): Promise<CatalogueEntry[]>;
  /** Installe un module du catalogue SANS résoudre ses dépendances (c'est ici que ça se fait). */
  installEntry(entry: CatalogueEntry): Promise<{ ok: true } | { ok: false; error: string; detail?: string }>;
  /** Supprime un module installé par la cascade (annulation). */
  purge(id: string): Promise<void>;
};

export type Missing = {
  service: string;
  min: number;
  have: number | null;
  /** none : personne ne l'offre · old : version trop ancienne · cycle · depth · failed : un fournisseur a été trouvé mais n'a pas pu être installé. */
  reason: "none" | "old" | "cycle" | "depth" | "failed";
  /** Module en cause (fournisseur qui a échoué, ou fin du cycle) et sa raison. */
  module?: string;
  error?: string;
  detail?: string;
  chain?: string[];
};

export type Journal = {
  /** Consommateur pour lequel on résout. */
  forModule: string;
  undo: (() => Promise<void>)[];
  /** Ce que la cascade a apporté : à marquer « installé automatiquement » une fois tout réussi. */
  auto: { id: string; module: boolean; instances: string[] }[];
  /** Modules apportés (installés ou activés), pour le compte rendu. */
  provided: string[];
};
export const newJournal = (forModule: string): Journal => ({ forModule, undo: [], auto: [], provided: [] });

export async function unwind(journal: Journal, downTo = 0): Promise<void> {
  while (journal.undo.length > downTo) {
    const step = journal.undo.pop()!;
    try { await step(); } catch (error) { console.error("[modules] rollback step failed:", (error as Error)?.message); }
  }
  // Les marques en attente qui concernent des étapes défaites n'ont plus lieu d'être : on ne garde que ce qui survit.
  if (downTo === 0) { journal.auto = []; journal.provided = []; }
}

/** Écrit les marques « installé automatiquement » (une fois toute la chaîne réussie). */
export async function commitJournal(journal: Journal): Promise<void> {
  for (const a of journal.auto) await markAuto(a.id, journal.forModule, { module: a.module, instances: a.instances });
}

export type DepResult = { ok: true; journal: Journal } | { ok: false; missing: Missing[]; journal: Journal };

const missingFor = (g: Gap, extra: Partial<Missing> = {}): Missing => ({ service: g.service, min: g.min, have: g.have, reason: g.reason, ...extra });

/**
 * Fait en sorte que tous les `requires` du module soient fournis par une instance active. Ne touche à rien si tout l'est déjà.
 * En cas d'échec : `ok: false` ET la cascade est déjà défaite par l'appelant via `unwind(journal)` (on ne laisse jamais rien à moitié).
 */
export async function satisfyRequirements(manifest: ParsedManifest, ops: DepOps, journal: Journal = newJournal(manifest.id), path: string[] = [manifest.id]): Promise<DepResult> {
  const gaps = await requirementGaps(manifest);
  if (!gaps.length) return { ok: true, journal };
  const catalogue = await ops.catalogue().catch((): CatalogueEntry[] => []);
  const missing: Missing[] = [];
  for (const gap of gaps) {
    // Un besoin déjà couvert par ce que la cascade vient de faire pour un autre service du même fournisseur.
    if (satisfiesVersion(offerVersionAmong(await liveProviders(manifest.id), gap.service), gap.min)) continue;
    const installed = await installedViews();
    const candidates = rankCandidates({ service: gap.service, min: gap.min }, installed, catalogue, new Set(path));
    if (path.length > MAX_DEPTH) { missing.push(missingFor(gap, { reason: "depth", chain: path })); continue; }
    if (!candidates.length) {
      const cycle = rankCandidates({ service: gap.service, min: gap.min }, installed, catalogue, new Set()).find((c) => path.includes(c.id));
      const known = bestKnownVersion(gap.service, installed, catalogue);
      missing.push(cycle ? missingFor(gap, { reason: "cycle", chain: [...path, cycle.id] }) : missingFor(gap, { have: known, reason: known === null ? "none" : "old" }));
      continue;
    }
    let lastFailure: Missing | null = null;
    let done = false;
    for (const candidate of candidates) {
      const mark = journal.undo.length;
      const autoMark = journal.auto.length;
      const providedMark = journal.provided.length;
      const attempt = await tryCandidate(candidate, gap, manifest, ops, journal, path);
      if (attempt.ok) { done = true; break; }
      lastFailure = attempt.missing[0] ?? missingFor(gap, { reason: "failed", module: candidate.id });
      // Ce candidat n'a pas marché : on défait ce qu'il a apporté avant d'essayer le suivant (l'index a pu mentir sur ce qu'il offre).
      await unwind(journal, mark);
      journal.auto.length = Math.min(journal.auto.length, autoMark);
      journal.provided.length = Math.min(journal.provided.length, providedMark);
      if (lastFailure.reason === "cycle" || lastFailure.reason === "depth") break;
    }
    if (!done) missing.push(lastFailure ?? missingFor(gap, { reason: "failed" }));
  }
  return missing.length ? { ok: false, missing, journal } : { ok: true, journal };
}

const offerVersionAmong = (providers: { manifest: ParsedManifest }[], service: string): number | null => {
  const v = providers.map((p) => offerVersionOf(p.manifest.offers, service)).filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};

async function tryCandidate(c: Candidate, gap: Gap, consumer: ParsedManifest, ops: DepOps, journal: Journal, path: string[]): Promise<DepResult> {
  const fail = (m: Partial<Missing>): DepResult => ({ ok: false, journal, missing: [missingFor(gap, { reason: "failed", module: c.id, ...m })] });
  let installedHere = false;
  if (c.from === "catalogue") {
    const r = await ops.installEntry(c.entry);
    if (!r.ok) return fail({ error: r.error, detail: r.detail });
    installedHere = true;
    journal.undo.push(() => ops.purge(c.id));
  }
  const mod = await getModule(c.id);
  if (!mod) return fail({ error: "modules.error.load" });
  // L'index annonce, le manifeste réel tranche.
  if (!satisfiesVersion(offerVersionOf(mod.manifest.offers, gap.service), gap.min)) return fail({ error: "modules.error.serviceMismatch" });
  const sub = await satisfyRequirements(mod.manifest, ops, journal, [...path, c.id]);
  if (!sub.ok) return sub;
  const row = await prisma.module.findUnique({ where: { id: c.id } });
  if (!row) return fail({ error: "modules.error.notfound" });
  if (!row.enabled) {
    await prisma.module.update({ where: { id: c.id }, data: { enabled: true } });
    journal.undo.push(async () => { await prisma.module.update({ where: { id: c.id }, data: { enabled: false } }); });
  }
  const instance = await ensureDefaultInstance(c.id);
  if (!instance) return fail({ error: "modules.error.load" });
  if (instance.kind !== "present") journal.undo.push(() => undoDefaultInstance(instance));
  if (installedHere || instance.kind !== "present" || !row.enabled) {
    journal.auto.push({ id: c.id, module: installedHere, instances: instance.kind === "created" ? [instance.instanceId] : [] });
    journal.provided.push(c.id);
  }
  void consumer;
  return { ok: true, journal };
}

