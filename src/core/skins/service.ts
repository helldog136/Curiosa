/**
 * INSTALLATION DES SKINS DEPUIS UN DÉPÔT GIT (lot S5, docs/SKINS.md §5, §10 et §14).
 *
 * C'est l'API interne que la page Apparence (lot S7) et l'assistant (MCP) appelleront. Aucune interface ici, rien ne change l'apparence du site :
 * on récupère, on contrôle, on pose des fichiers sous `data/skins/<id>/<version>/` et on note le skin dans le registre (réglage `skin.installed`, voir registry.ts).
 *
 * API (toutes les fonctions rendent `{ ok: true, … }` ou `{ ok: false, error, … }`, jamais d'exception pour un cas prévu ; `error` est une clé de traduction `skins.error.*`) :
 *
 *   listCatalogue(opts?)                     → la liste des skins installables (catalogue officiel + index supplémentaire), avec l'état « installé / mise à jour ».
 *                                              Catalogue injoignable : `unreachable: true` + message simple ; les skins installés continuent.
 *   inspect(url)                             → ce que contient le dépôt (README, licences, aperçus, résumé du contrôle) SANS rien installer.
 *                                              Aucune image distante : les aperçus sont lus dans le dépôt et rendus en données locales ; le README est du texte
 *                                              débarrassé de HTML et d'images (à afficher par le rendu Markdown du cœur, sans HTML brut).
 *   install(url, { confirmPersonal, actor }) → installe. `url` = `https://hôte/propriétaire/dépôt[.git][#étiquette-ou-commit[:dossier]]`. Un dépôt qui n'est
 *                                              pas au catalogue officiel (« personnel » ou index supplémentaire) exige `confirmPersonal: true`
 *                                              (la case « je comprends » de l'interface).
 *   installFromCatalogue(id, { confirmExtra, actor })  → installe un skin listé (version épinglée par le catalogue).
 *   checkUpdate(id)                          → { available, target?, level?, needsCore? } sans rien changer.
 *   update(id, { acceptMajor, actor })       → met à jour : étiquette stable la plus haute (dépôt personnel) ou version épinglée par le catalogue ; une montée de
 *                                              version MAJEURE n'est faite qu'avec `acceptMajor: true` ; tout échec laisse l'ancienne version en place.
 *   revert(id, { actor })                    → revient à la version d'avant la dernière mise à jour (gardée sur le disque).
 *   reinstall(id, { actor })                 → réinstalle depuis le dépôt noté (restauration d'une sauvegarde, fichiers perdus).
 *   remove(id, { actor })                    → retire les fichiers ; si le skin était actif, `skin.active` retombe sur « basic » sans rien perdre.
 *   installed()                              → les skins installés, avec leur état (ok / missing / modified / invalid) et leurs problèmes.
 *   activeSkinId()                           → le skin à appliquer : `skin.active` si ses fichiers sont là, sinon « basic ».
 *   loadInstalledSkin(id)                    → manifeste + feuille assainie + jetons assainis d'un skin installé (pour la composition du rendu).
 *
 * Garde-fous (mêmes que les modules) : hôtes de MODULES_ALLOWED_HOSTS, https, récupération superficielle, aucun crochet git, liens symboliques refusés,
 * plafonds de taille, empreinte du contenu, étiquettes `vX.Y.Z`, `#ref`, `#ref:dossier`, installation atomique (dossier temporaire puis renommage).
 * Audit (sans contenu) : skin.install, skin.update, skin.remove, skin.refused.
 */
import fs from "node:fs";
import path from "node:path";
import { SKINS_DIR } from "../config";
import { getCoreVersion } from "../modules/compat";
import { audit } from "../permissions";
import { SKIN_ID_RE } from "./allowlist";
import { clearSkinCatalogueCache, readSkinCatalogue, type CatalogueRead, type SkinCatalogueEntry, type SkinOrigin } from "./catalogue";
import { BASIC_ID } from "./constants";
import type { SkinManifest } from "./manifest";
import { makeIssue, type SkinIssue, type Text } from "./messages";
import type { ReadabilityIssue } from "./readability";
import { fallBackToBasic, filesPresent, pruneUnclaimed, readActiveSetting, readRows, serial, skinDir, writeRows, type SkinRow, type SkinSource } from "./registry";
import { classify, compareVersions, TAG_RE, type UpdateLevel } from "./semver";
import { fetchSkinSource, isCommitRef, latestStableTag, parseSkinRepoUrl, remoteHead, repoAddress, sameRepoUrl, type Fetched, type SkinRepo } from "./source";
import { fingerprintOf, hasErrors, hasSignature, validateSkinFolder, type SkinTokens, type SkinValidation } from "./validate";

export type Failure = { ok: false; error: string; issues?: SkinIssue[]; detail?: string; needsCore?: string; level?: UpdateLevel; target?: string; origin?: SkinOrigin; /** Version restée en place après un échec de mise à jour. */ kept?: string };
type Opts = { actor?: string };

const systemActor = (o?: Opts) => o?.actor ?? "system";
const fail = (error: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, error, ...extra });

/** Hooks pour les tests : simulent une panne au dernier moment d'une installation ou d'une mise à jour (retour arrière). */
const hooks: { beforeSwitch?: () => void | Promise<void> } = {};
export function setServiceHooksForTests(h: typeof hooks): void { hooks.beforeSwitch = h.beforeSwitch; }

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue

export type CatalogueItem = SkinCatalogueEntry & { installed: boolean; installedVersion?: string; updateAvailable: boolean };
export type CatalogueListing = {
  ok: true;
  items: CatalogueItem[];
  source: CatalogueRead["source"];
  fetchedAt: number | null;
  /** Ni dépôt ni dernière copie reçue : réessayez plus tard. Les skins installés continuent de fonctionner. */
  unreachable: boolean;
  message?: Text;
};

export const CATALOGUE_UNREACHABLE: Text = {
  fr: "La liste des skins est injoignable pour le moment. Vos skins installés continuent de fonctionner ; réessayez plus tard.",
  en: "The list of skins cannot be reached right now. Your installed skins keep working; please try again later.",
};

export async function listCatalogue(opts: { fresh?: boolean; fetchImpl?: typeof fetch } = {}): Promise<CatalogueListing> {
  const cat = await readSkinCatalogue({ coreVersion: getCoreVersion(), fresh: opts.fresh, fetchImpl: opts.fetchImpl });
  const rows = await readRows();
  const items = cat.entries.map((e): CatalogueItem => {
    const row = rows.find((r) => r.id === e.id);
    const newer = !!row && ((!!e.version && compareVersions(e.version, row.version) > 0) || (!e.version && !!e.ref && e.ref !== row.ref));
    return { ...e, installed: !!row, installedVersion: row?.version, updateAvailable: newer };
  });
  return { ok: true, items, source: cat.source, fetchedAt: cat.fetchedAt, unreachable: cat.unreachable, ...(cat.unreachable ? { message: CATALOGUE_UNREACHABLE } : {}) };
}

/** D'où vient ce dépôt ? Le catalogue officiel ou l'index supplémentaire le listent (même dépôt, même dossier, même étiquette) : sinon il est personnel. */
async function originOf(repo: SkinRepo): Promise<{ origin: SkinOrigin; entry?: SkinCatalogueEntry }> {
  const cat = await readSkinCatalogue({ coreVersion: getCoreVersion() }).catch(() => null);
  const entry = cat?.entries.find((e) => sameRepoUrl(e.repo, repo.url) && (e.subdir ?? null) === (repo.subdir ?? null) && (!repo.ref || repo.ref === e.ref));
  return entry ? { origin: entry.origin, entry } : { origin: "personal" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Refus et audit

const codeOf = (issues: readonly SkinIssue[]) => issues.find((i) => i.severity === "error")?.code ?? "invalid";

/** Le refus qu'on dit à la personne : clé de traduction + problèmes détaillés. */
function refusalOf(v: SkinValidation): Failure {
  const issues = v.issues;
  const core = issues.find((i) => i.code === "manifest-core-newer");
  if (core) return fail("skins.error.core", { issues, needsCore: v.manifest?.minCore });
  if (issues.some((i) => i.code === "manifest-contract-newer")) return fail("skins.error.contract", { issues });
  if (issues.some((i) => i.severity === "error" && /^read-/.test(i.code))) return fail("skins.error.unreadable", { issues });
  if (issues.some((i) => i.code === "manifest-missing")) return fail("skins.error.nomanifest", { issues });
  if (issues.some((i) => i.code === "manifest-id-expected")) return fail("skins.error.idmismatch", { issues });
  return fail("skins.error.invalid", { issues });
}

async function refuse(v: SkinValidation, who: string): Promise<Failure> {
  // Sans contenu : l'identifiant (déjà contrôlé par le schéma s'il existe) et le code du premier problème, jamais un extrait du skin.
  const id = v.manifest && SKIN_ID_RE.test(v.manifest.id) ? v.manifest.id : "?";
  await audit(who, "skin.refused", `${id} ${codeOf(v.issues)}`);
  return refusalOf(v);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pose des fichiers (atomique)

/** Écrit le contenu validé dans un dossier temporaire à côté de la destination, puis le renomme : jamais à moitié posé. Rend la destination. */
function placeVersion(v: SkinValidation): string {
  const m = v.manifest!;
  const base = path.join(SKINS_DIR, m.id);
  const target = skinDir(m.id, m.version);
  fs.mkdirSync(base, { recursive: true });
  const staging = fs.mkdtempSync(path.join(base, ".incoming-"));
  try {
    for (const f of v.installFiles) {
      const dest = path.join(staging, f.path);
      if (!dest.startsWith(staging + path.sep)) throw new Error("path");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content, { flag: "wx" });
    }
    // Relecture : ce qui est sur le disque est bien ce qui a été validé.
    const onDisk = fingerprintOf(v.installFiles.map((f) => ({ path: f.path, sha256: v.files.find((x) => x.path === f.path)!.sha256 })));
    if (onDisk !== v.fingerprint) throw new Error("fingerprint");
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    return target;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function contextOf(spec: { url: string; subdir?: string | null }, expectId?: string) {
  return { coreVersion: getCoreVersion(), folderName: spec.subdir ? path.posix.basename(spec.subdir) : null, expectId };
}

// ---------------------------------------------------------------------------------------------------------------------
// Installation

type Spec = { url: string; ref?: string | null; subdir?: string | null };

async function download(spec: Spec): Promise<{ ok: true; fetched: Fetched } | Failure> {
  try { return { ok: true, fetched: await fetchSkinSource(spec.url, spec.ref, spec.subdir) }; }
  catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "skins.error.nosubdir") return fail("skins.error.nosubdir");
    console.error("[skins] fetch failed:", (error as Error)?.message?.split("\n")[0]);
    return fail("skins.error.clone");
  }
}

export type InstallOk = { ok: true; id: string; version: string; source: SkinSource; warnings: SkinIssue[] };

async function installFrom(spec: Spec, o: { source: SkinSource; expectId?: string; actor: string; mode: "install" | "reinstall" }): Promise<InstallOk | Failure> {
  return serial(async () => {
    const got = await download(spec);
    if (!got.ok) return got;
    const { fetched } = got;
    let placed: string | null = null;
    try {
      const v = validateSkinFolder(fetched.root, contextOf(spec, o.expectId));
      if (!v.ok || !v.manifest) return await refuse(v, o.actor);
      const m = v.manifest;
      const rows = await readRows();
      const existing = rows.find((r) => r.id === m.id);
      if (o.mode === "install" && existing) return fail("skins.error.exists", { detail: m.id });
      if (o.mode === "reinstall" && !existing) return fail("skins.error.notfound");
      const hadDir = fs.existsSync(skinDir(m.id, m.version));
      placed = placeVersion(v);
      try {
        await hooks.beforeSwitch?.();
        const row: SkinRow = {
          id: m.id, version: m.version, repo: spec.url, ref: spec.ref ?? null, subdir: spec.subdir ?? null, source: o.source,
          commit: fetched.commit, tree: fetched.tree, fingerprint: v.fingerprint, installedAt: new Date().toISOString(),
        };
        await writeRows([...rows.filter((r) => r.id !== m.id), row].sort((a, b) => (a.id < b.id ? -1 : 1)));
        // Une réinstallation à une autre version laisse l'ancien dossier sans propriétaire : on le range.
        if (existing && existing.version !== m.version) fs.rmSync(skinDir(m.id, existing.version), { recursive: true, force: true });
        if (existing?.previous && existing.previous.version !== m.version) fs.rmSync(skinDir(m.id, existing.previous.version), { recursive: true, force: true });
      } catch (error) {
        if (!hadDir) fs.rmSync(placed, { recursive: true, force: true });
        throw error;
      }
      await audit(o.actor, "skin.install", `${m.id}@${m.version}${o.source === "personal" ? " personal" : ""}`);
      return { ok: true, id: m.id, version: m.version, source: o.source, warnings: v.issues.filter((i) => i.severity === "warning") };
    } catch (error) {
      console.error("[skins] install failed:", (error as Error)?.message);
      return fail("skins.error.failed");
    } finally {
      fetched.cleanup();
    }
  });
}

/**
 * Installe un skin depuis l'adresse d'un dépôt git. Un dépôt du catalogue officiel s'installe tel quel (sa version épinglée par le catalogue) ; tout autre
 * dépôt (personnel, ou index supplémentaire) exige `confirmPersonal: true` — la confirmation explicite de la personne, jamais donnée par une cascade ou l'assistant.
 */
export async function install(url: string, opts: Opts & { confirmPersonal?: boolean; expectId?: string } = {}): Promise<InstallOk | Failure> {
  const parsed = parseSkinRepoUrl(url);
  if (!parsed.ok) return fail(parsed.error);
  const { origin, entry } = await originOf(parsed.repo);
  if (origin !== "official" && opts.confirmPersonal !== true) return fail("skins.error.personalConfirm", { origin });
  if (entry && !entry.compatible) return fail("skins.error.contract");
  if (entry?.needsNewerCore) return fail("skins.error.core", { needsCore: entry.needsNewerCore });
  const spec: Spec = { url: parsed.repo.url, ref: parsed.repo.ref ?? (origin === "official" ? entry?.ref : undefined), subdir: parsed.repo.subdir };
  return installFrom(spec, { source: origin === "official" ? "catalogue" : "personal", expectId: opts.expectId ?? entry?.id, actor: systemActor(opts), mode: "install" });
}

/** Installe un skin listé par le catalogue. Une entrée de l'index supplémentaire exige `confirmExtra: true`. */
export async function installFromCatalogue(id: string, opts: Opts & { confirmExtra?: boolean } = {}): Promise<InstallOk | Failure> {
  const cat = await readSkinCatalogue({ coreVersion: getCoreVersion() });
  const entry = cat.entries.find((e) => e.id === id);
  if (!entry) return fail(cat.unreachable ? "skins.error.catalogue" : "skins.error.notfound");
  if (!entry.compatible) return fail("skins.error.contract");
  if (entry.needsNewerCore) return fail("skins.error.core", { needsCore: entry.needsNewerCore });
  if (entry.origin === "extra" && opts.confirmExtra !== true) return fail("skins.error.personalConfirm", { origin: "extra" });
  return installFrom({ url: entry.repo, ref: entry.ref, subdir: entry.subdir }, { source: entry.origin === "official" ? "catalogue" : "personal", expectId: id, actor: systemActor(opts), mode: "install" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Mise à jour

const isStableTag = (ref: string | null | undefined): ref is string => !!ref && TAG_RE.test(ref);

export type UpdateCheck = { available: boolean; target?: string; level?: UpdateLevel; needsCore?: string; /** La vérification elle-même a échoué (réseau, dépôt absent). */ failed?: boolean };

type Target = { spec: Spec; fromCatalogue: boolean; entry?: SkinCatalogueEntry } | Failure | { none: "pinned" | "uptodate" };

/** Quelle étiquette ou quel commit suivre ? Un skin du catalogue suit la version que le catalogue épingle ; un skin personnel suit la sienne. */
async function targetOf(row: SkinRow): Promise<Target> {
  const cat = await readSkinCatalogue({ coreVersion: getCoreVersion() });
  const entry = cat.entries.find((e) => e.id === row.id && e.origin === "official" && sameRepoUrl(e.repo, row.repo) && (e.subdir ?? null) === row.subdir);
  if (entry) return { spec: { url: row.repo, ref: entry.ref ?? row.ref, subdir: row.subdir }, fromCatalogue: true, entry };
  if (row.source === "catalogue" && cat.unreachable) return fail("skins.error.catalogue");
  if (isCommitRef(row.ref)) return { none: "pinned" };
  if (isStableTag(row.ref)) {
    const latest = await latestStableTag(row.repo);
    if (!latest || !classify(row.ref, latest)) return { none: "uptodate" };
    return { spec: { url: row.repo, ref: latest, subdir: row.subdir }, fromCatalogue: false };
  }
  return { spec: { url: row.repo, ref: row.ref, subdir: row.subdir }, fromCatalogue: false };
}

/** Y a-t-il une version plus récente ? Ne télécharge pas le skin et ne change rien. */
export async function checkUpdate(id: string): Promise<UpdateCheck> {
  const row = (await readRows()).find((r) => r.id === id);
  if (!row) return { available: false };
  try {
    const t = await targetOf(row);
    if ("ok" in t) return { available: false, failed: true };
    if ("none" in t) return { available: false };
    if (t.entry) {
      const e = t.entry;
      const available = (!!e.version && compareVersions(e.version, row.version) > 0) || (!e.version && !!e.ref && e.ref !== row.ref);
      return available ? { available, target: e.version ?? e.ref, level: e.version ? classify(row.version, e.version) ?? undefined : undefined, needsCore: e.needsNewerCore } : { available: false };
    }
    if (isStableTag(t.spec.ref) && t.spec.ref !== row.ref) return { available: true, target: t.spec.ref, level: classify(row.ref ?? "0.0.0", t.spec.ref) ?? undefined };
    const head = await remoteHead(row.repo, t.spec.ref);
    return head && head !== row.commit ? { available: true, target: head.slice(0, 7) } : { available: false };
  } catch { return { available: false, failed: true }; }
}

export type UpdateOk = { ok: true; id: string; version: string; from: string; level: UpdateLevel | null; warnings: SkinIssue[] };

/**
 * Met un skin à jour. La nouvelle version est posée À CÔTÉ de l'ancienne (`data/skins/<id>/<nouvelle version>/`), contrôlée comme à l'installation (lisibilité
 * comprise), puis seulement alors le registre bascule. À la moindre erreur, rien ne change : l'ancienne version reste en place et active (`kept`).
 * L'ancienne version reste sur le disque (`previous`) pour `revert`.
 */
export async function update(id: string, opts: Opts & { acceptMajor?: boolean } = {}): Promise<UpdateOk | Failure> {
  const who = systemActor(opts);
  return serial(async () => {
    const rows = await readRows();
    const row = rows.find((r) => r.id === id);
    if (!row) return fail("skins.error.notfound");
    let fetched: Fetched | null = null;
    try {
      const t = await targetOf(row);
      if ("ok" in t) return t;
      if ("none" in t) return fail(t.none === "pinned" ? "skins.error.pinned" : "skins.error.uptodate", { kept: row.version });
      if (t.entry?.needsNewerCore) return fail("skins.error.core", { needsCore: t.entry.needsNewerCore, kept: row.version });
      const got = await download(t.spec);
      if (!got.ok) return { ...got, kept: row.version };
      fetched = got.fetched;
      if (fetched.tree === row.tree) return fail("skins.error.uptodate", { kept: row.version });
      const v = validateSkinFolder(fetched.root, contextOf(t.spec, id));
      if (!v.ok || !v.manifest) return { ...(await refuse(v, who)), kept: row.version };
      const m = v.manifest;
      const cmp = compareVersions(m.version, row.version);
      if (cmp <= 0) return fail("skins.error.sameVersion", { kept: row.version, detail: m.version });
      const level = classify(row.version, m.version);
      if (level === "major" && opts.acceptMajor !== true) return fail("skins.error.majorConfirm", { level, target: m.version, kept: row.version });
      if (fs.existsSync(skinDir(id, m.version)) && row.previous?.version !== m.version) fs.rmSync(skinDir(id, m.version), { recursive: true, force: true });
      const placed = placeVersion(v);
      try {
        await hooks.beforeSwitch?.();
        const next: SkinRow = {
          ...row, version: m.version, ref: t.spec.ref ?? null, commit: fetched.commit, tree: fetched.tree, fingerprint: v.fingerprint, installedAt: new Date().toISOString(),
          previous: { version: row.version, ref: row.ref, commit: row.commit, tree: row.tree, fingerprint: row.fingerprint },
        };
        await writeRows(rows.map((r) => (r.id === id ? next : r)));
      } catch (error) {
        fs.rmSync(placed, { recursive: true, force: true });
        throw error;
      }
      // Seule une version d'avant est gardée : la précédente de la précédente part.
      if (row.previous && row.previous.version !== m.version && row.previous.version !== row.version) fs.rmSync(skinDir(id, row.previous.version), { recursive: true, force: true });
      await audit(who, "skin.update", `${id}@${m.version}`);
      return { ok: true, id, version: m.version, from: row.version, level, warnings: v.issues.filter((i) => i.severity === "warning") };
    } catch (error) {
      console.error("[skins] update failed:", (error as Error)?.message);
      return fail("skins.error.failed", { kept: row.version });
    } finally {
      fetched?.cleanup();
    }
  });
}

/** Revient à la version d'avant la dernière mise à jour (encore sur le disque). Refusé si ses fichiers ont changé. */
export async function revert(id: string, opts: Opts = {}): Promise<{ ok: true; id: string; version: string } | Failure> {
  return serial(async () => {
    const rows = await readRows();
    const row = rows.find((r) => r.id === id);
    if (!row) return fail("skins.error.notfound");
    const prev = row.previous;
    if (!prev || !filesPresent(id, prev.version)) return fail("skins.error.noprevious");
    const v = validateSkinFolder(skinDir(id, prev.version), { coreVersion: getCoreVersion(), expectId: id });
    if (!v.ok || v.fingerprint !== prev.fingerprint) return fail("skins.error.invalid", { issues: v.issues });
    const { previous: _gone, ...rest } = row;
    void _gone;
    const back: SkinRow = { ...rest, version: prev.version, ref: prev.ref, commit: prev.commit, tree: prev.tree, fingerprint: prev.fingerprint };
    await writeRows(rows.map((r) => (r.id === id ? back : r)));
    fs.rmSync(skinDir(id, row.version), { recursive: true, force: true });
    await audit(systemActor(opts), "skin.update", `${id}@${prev.version} revert`);
    return { ok: true, id, version: prev.version };
  });
}

/** Réinstalle un skin noté au registre dont les fichiers manquent ou ont changé (restauration d'une sauvegarde), depuis son dépôt, à la même étiquette. */
export async function reinstall(id: string, opts: Opts = {}): Promise<InstallOk | Failure> {
  const row = (await readRows()).find((r) => r.id === id);
  if (!row) return fail("skins.error.notfound");
  return installFrom({ url: row.repo, ref: row.ref, subdir: row.subdir }, { source: row.source, expectId: id, actor: systemActor(opts), mode: "reinstall" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Retrait

/**
 * Retire un skin : ses fichiers partent (un skin n'a pas de données). S'il était actif, `skin.active` retombe sur « basic » ; les retouches de la personne
 * restent, seules les options du skin retiré sont nettoyées.
 */
export async function remove(id: string, opts: Opts = {}): Promise<{ ok: true; id: string; wasActive: boolean } | Failure> {
  return serial(async () => {
    const rows = await readRows();
    if (!rows.some((r) => r.id === id)) return fail("skins.error.notfound");
    const wasActive = (await readActiveSetting()) === id;
    await writeRows(rows.filter((r) => r.id !== id));
    if (wasActive) await fallBackToBasic();
    fs.rmSync(path.join(SKINS_DIR, id), { recursive: true, force: true });
    await audit(systemActor(opts), "skin.remove", id);
    return { ok: true, id, wasActive };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Liste des skins installés

export type InstalledSkin = {
  id: string;
  version: string;
  name: Text;
  description: Text;
  author?: string;
  license?: string;
  modes: ("light" | "dark")[];
  tags: string[];
  source: SkinSource;
  repo: string;
  ref: string | null;
  subdir: string | null;
  commit: string;
  fingerprint: string;
  installedAt: string;
  active: boolean;
  /** ok : prêt · missing : fichiers absents (basic s'applique en attendant) · modified : fichiers changés depuis l'installation · invalid : ne passe plus le contrôle. */
  status: "ok" | "missing" | "modified" | "invalid";
  problems: SkinIssue[];
  previews: { file: string; mode?: "light" | "dark"; alt: Text }[];
  previous?: { version: string };
};

export async function installed(): Promise<InstalledSkin[]> {
  const rows = await readRows();
  const active = await readActiveSetting();
  const out: InstalledSkin[] = [];
  for (const row of rows) {
    const base = { id: row.id, version: row.version, source: row.source, repo: row.repo, ref: row.ref, subdir: row.subdir, commit: row.commit, fingerprint: row.fingerprint, installedAt: row.installedAt, active: active === row.id, ...(row.previous ? { previous: { version: row.previous.version } } : {}) };
    const fallbackName: Text = { fr: row.id, en: row.id };
    if (!filesPresent(row.id, row.version)) {
      out.push({ ...base, name: fallbackName, description: { fr: "", en: "" }, modes: [], tags: [], status: "missing", problems: [makeIssue("skin-files-missing")], previews: [] });
      continue;
    }
    const v = validateSkinFolder(skinDir(row.id, row.version), { coreVersion: getCoreVersion(), expectId: row.id });
    const m = v.manifest;
    const modified = v.ok && v.fingerprint !== row.fingerprint;
    out.push({
      ...base, name: m?.name ?? fallbackName, description: m?.description ?? { fr: "", en: "" }, author: m?.author?.name, license: m?.license, modes: m?.modes ?? [], tags: m?.tags ?? [],
      status: modified ? "modified" : v.ok ? "ok" : "invalid",
      problems: modified ? [makeIssue("skin-modified"), ...v.issues] : v.issues,
      previews: (m?.previews ?? []).map((p) => ({ file: p.file, mode: p.mode, alt: p.alt })),
    });
  }
  return out;
}

/** Le skin à appliquer : `skin.active` si ses fichiers sont en place, sinon « basic » (un skin qui disparaît se remplace par basic sans perte). */
export async function activeSkinId(): Promise<string> {
  const id = await readActiveSetting();
  if (id === BASIC_ID) return BASIC_ID;
  const row = (await readRows()).find((r) => r.id === id);
  return row && filesPresent(row.id, row.version) ? id : BASIC_ID;
}

export type LoadedSkin = { ok: true; id: string; version: string; manifest: SkinManifest; css: string; tokens: SkinTokens; assetBase: string } | { ok: false; id: string; issues: SkinIssue[] };
const loadMemo = new Map<string, { at: number; value: LoadedSkin }>();
const LOAD_TTL = 10 * 60_000;

/**
 * Relit un skin installé : feuille et jetons ASSAINIS de nouveau (le fichier source n'est jamais servi, §6). Mis en cache 10 minutes par (id, version, empreinte).
 * `ok: false` : le skin ne passe plus le contrôle (fichiers absents ou altérés) — l'appelant applique basic.
 */
export async function loadInstalledSkin(id: string, opts: { now?: number } = {}): Promise<LoadedSkin> {
  const row = (await readRows()).find((r) => r.id === id);
  if (!row || !filesPresent(row.id, row.version)) return { ok: false, id, issues: [makeIssue("skin-files-missing")] };
  const key = `${row.id}@${row.version}:${row.fingerprint}:${getCoreVersion()}`;
  const now = opts.now ?? Date.now();
  const hit = loadMemo.get(key);
  if (hit && now - hit.at < LOAD_TTL) return hit.value;
  const v = validateSkinFolder(skinDir(row.id, row.version), { coreVersion: getCoreVersion(), expectId: row.id });
  let value: LoadedSkin;
  if (!v.ok || !v.manifest || !v.tokens) value = { ok: false, id, issues: v.issues };
  else if (v.fingerprint !== row.fingerprint) value = { ok: false, id, issues: [makeIssue("skin-modified")] };
  else value = { ok: true, id, version: row.version, manifest: v.manifest, css: v.css, tokens: v.tokens, assetBase: `/skins/${id}/${row.version}/` };
  loadMemo.set(key, { at: now, value });
  if (loadMemo.size > 50) loadMemo.delete(loadMemo.keys().next().value!);
  return value;
}
export const clearSkinCaches = (): void => { loadMemo.clear(); clearSkinCatalogueCache(); };

/** Octets d'une image d'aperçu (`previews/….webp`, 150 Ko au plus, signature vérifiée) lue dans `root`, ou null. */
function readPreviewFile(root: string, file: string): Buffer | null {
  try {
    if (!/^previews\/[a-z0-9][a-z0-9._-]{0,63}\.webp$/.test(file)) return null;
    const p = path.join(root, file);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 150 * 1024) return null;
    const b = fs.readFileSync(p);
    return hasSignature(file, b) ? b : null;
  } catch { return null; }
}

/** Un aperçu d'un skin installé (octets d'une image `.webp` listée dans son manifeste), pour l'administration : jamais servi aux visiteurs. */
export function readInstalledPreview(id: string, version: string, file: string): Buffer | null {
  try { return readPreviewFile(skinDir(id, version), file); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Aperçu avant installation

export type InspectAsset = { file: string; kind: "font" | "image"; license?: string; author?: string; source?: string; family?: string };
export type InspectSummary = {
  id: string;
  name: Text;
  description: Text;
  version: string;
  author?: { name: string; url?: string };
  license: string;
  minCore?: string;
  skinContract: number;
  modes: ("light" | "dark")[];
  tags: string[];
  /** Polices et images embarquées avec leur licence (§10.5). */
  assets: InspectAsset[];
  options: { id: string; label: Text; values: { id: string; label: Text }[] }[];
  breakpoints: number[];
  sizeBytes: number;
  files: number;
  /** Un skin ne fait que de l'apparence : il ne peut rien exécuter, rien charger d'un autre site, rien changer du contenu, ni toucher à l'administration. */
  permissions: { executesCode: false; loadsFromOtherSites: false; changesContent: false; touchesAdmin: false };
  /** Texte du README (sans HTML ni image) à afficher par le rendu Markdown du cœur. */
  readme: string | null;
  readmeTruncated: boolean;
  /** Texte de la licence du skin (fichier LICENSE), si le dépôt en a un. */
  licenseText: string | null;
  /** Aperçus lus DANS le dépôt, en données locales (aucune image n'est chargée depuis un site extérieur). */
  previews: { file: string; mode?: "light" | "dark"; alt: Text; dataUrl: string }[];
};
export type InspectResult =
  | { ok: true; origin: SkinOrigin; repo: { url: string; ref?: string; subdir?: string }; compatible: boolean; needsCore?: string; alreadyInstalled?: { version: string }; summary: InspectSummary; issues: SkinIssue[]; readability: ReadabilityIssue[]; installable: boolean }
  | { ok: true; origin: SkinOrigin; repo: { url: string; ref?: string }; candidates: { subdir: string; id: string; name: Text }[]; summary?: undefined }
  | Failure;

/** Retire d'un README tout ce qui pourrait appeler l'extérieur ou porter du HTML : balises, images (remplacées par leur description), liens `javascript:`. */
export function plainReadme(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>\n]{1,500}>/g, "")
    .replace(/!\[([^\]\n]{0,200})\]\([^)\n]{0,500}\)/g, "$1")
    .replace(/!\[([^\]\n]{0,200})\]\[[^\]\n]{0,100}\]/g, "$1")
    .replace(/\]\(\s*(javascript|data|vbscript):[^)\n]*\)/gi, "](#)");
}

const readText = (file: string, max: number): { text: string; truncated: boolean } | null => {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return null;
    const raw = fs.readFileSync(file, "utf8");
    return { text: raw.slice(0, max), truncated: raw.length > max };
  } catch { return null; }
};

function findCandidates(root: string): { subdir: string; id: string; name: Text }[] {
  const out: { subdir: string; id: string; name: Text }[] = [];
  const probe = (rel: string) => {
    const dir = path.join(root, rel);
    try {
      if (!fs.lstatSync(dir).isDirectory()) return;
      const j = JSON.parse(fs.readFileSync(path.join(dir, "skin.json"), "utf8"));
      if (typeof j?.id === "string" && SKIN_ID_RE.test(j.id)) out.push({ subdir: rel, id: j.id, name: { fr: String(j.name?.fr ?? j.id).slice(0, 40), en: String(j.name?.en ?? j.id).slice(0, 40) } });
    } catch { /* pas un skin */ }
  };
  for (const base of ["skins", ""]) {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(root, base), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith(".")).map((e) => e.name).sort(); } catch { continue; }
    for (const n of names) { probe(base ? `${base}/${n}` : n); if (out.length >= 60) return out; }
  }
  return out;
}

/** Ce qu'un dépôt contient, SANS rien installer ni changer (même contrôle qu'à l'installation, mêmes garde-fous de récupération). */
export async function inspect(url: string): Promise<InspectResult> {
  const parsed = parseSkinRepoUrl(url);
  if (!parsed.ok) return fail(parsed.error);
  const { origin, entry } = await originOf(parsed.repo);
  const spec: Spec = { url: parsed.repo.url, ref: parsed.repo.ref ?? (origin === "official" ? entry?.ref : undefined), subdir: parsed.repo.subdir };
  const got = await download(spec);
  if (!got.ok) return got;
  const { fetched } = got;
  try {
    if (!spec.subdir && !fs.existsSync(path.join(fetched.root, "skin.json"))) {
      const candidates = findCandidates(fetched.root);
      if (!candidates.length) return fail("skins.error.nomanifest");
      return { ok: true, origin, repo: { url: spec.url, ...(spec.ref ? { ref: spec.ref } : {}) }, candidates };
    }
    const v = validateSkinFolder(fetched.root, { ...contextOf(spec, entry?.id), advice: true });
    const m = v.manifest;
    if (!m) return fail(refusalOf(v).error, { issues: v.issues });
    const rows = await readRows();
    const own = (name: RegExp) => v.files.find((f) => name.test(f.path) && !f.path.includes("/"));
    const readme = own(/^README(\.[a-z]{2})?\.md$/);
    const readmeText = readme ? readText(path.join(fetched.root, readme.path), 100_000) : null;
    const lic = own(/^LICENSE(\.md|\.txt)?$/);
    const licText = lic ? readText(path.join(fetched.root, lic.path), 20_000) : null;
    const previews = (m.previews ?? []).flatMap((p) => {
      const b = readPreviewFile(fetched.root, p.file);
      return b ? [{ file: p.file, mode: p.mode, alt: p.alt, dataUrl: `data:image/webp;base64,${b.toString("base64")}` }] : [];
    });
    const summary: InspectSummary = {
      id: m.id, name: m.name, description: m.description, version: m.version, author: m.author, license: m.license, minCore: m.minCore, skinContract: m.skinContract,
      modes: m.modes, tags: m.tags,
      assets: m.assets.map((a) => ({ file: a.file, kind: a.kind, license: a.license, author: a.author, source: a.source, family: a.family })),
      options: (m.options ?? []).map((o) => ({ id: o.id, label: o.label, values: o.values.map((x) => ({ id: x.id, label: x.label })) })),
      breakpoints: m.breakpoints ?? [], sizeBytes: v.totalBytes, files: v.files.length,
      permissions: { executesCode: false, loadsFromOtherSites: false, changesContent: false, touchesAdmin: false },
      readme: readmeText ? plainReadme(readmeText.text) : null, readmeTruncated: readmeText?.truncated ?? false, licenseText: licText?.text ?? null, previews,
    };
    const existing = rows.find((r) => r.id === m.id);
    return {
      ok: true, origin, repo: { url: spec.url, ...(spec.ref ? { ref: spec.ref } : {}), ...(spec.subdir ? { subdir: spec.subdir } : {}) },
      compatible: !v.issues.some((i) => i.code === "manifest-contract-newer"), needsCore: v.issues.some((i) => i.code === "manifest-core-newer") ? m.minCore : undefined,
      ...(existing ? { alreadyInstalled: { version: existing.version } } : {}), summary, issues: v.issues, readability: v.readability, installable: !hasErrors(v.issues),
    };
  } catch (error) {
    console.error("[skins] inspect failed:", (error as Error)?.message);
    return fail("skins.error.failed");
  } finally {
    fetched.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Restauration (appelée par backup/restore.ts)

/** Range les dossiers de `data/skins` que le registre ne réclame plus. */
export async function pruneSkinFiles(): Promise<string[]> {
  return serial(async () => pruneUnclaimed(await readRows()));
}

