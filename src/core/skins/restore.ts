/**
 * SKINS ET SAUVEGARDE (docs/SKINS.md §10.7, lot S5).
 *
 * Ce qui est sauvegardé : les RÉGLAGES (`skin.active`, `skin.installed` = dépôt, étiquette, commit, empreinte de chaque skin, `skin.options`, les retouches
 * `theme.*`…), qui font déjà partie de `data/settings.json`, plus la liste des skins dans `backup.json` (`skins`, champ facultatif : un cœur plus ancien
 * l'ignore, une sauvegarde plus ancienne n'en a pas). Les FICHIERS des skins ne sont PAS sauvegardés : à la restauration ils sont réinstallés depuis leur dépôt,
 * à l'étiquette notée, comme les modules. Un dépôt personnel n'est réinstallé que si la personne le confirme (`skin:<id>` dans la liste de confirmations).
 *
 * Repli sur basic, sans perte : si un skin ne peut pas être réinstallé (dépôt injoignable, cœur trop ancien, non confirmé), son entrée reste au registre,
 * `skin.active` est gardé tel quel et `activeSkinId()` rend « basic » tant que les fichiers manquent ; le skin se réactive dès qu'il est réinstallé (`reinstall`).
 * Les retouches ne sont jamais touchées. Les skins installés ICI mais absents de la sauvegarde restent installés (comme les modules).
 */
import { validateSkinFolder } from "./validate";
import { getCoreVersion } from "../modules/compat";
import { installed, pruneSkinFiles, reinstall } from "./service";
import { filesPresent, readRows, skinDir, writeRows, type SkinRow, type SkinSource } from "./registry";
import { SETTING_INSTALLED } from "./constants";
import { SKIN_ID_RE } from "./allowlist";
import { SEMVER_RE } from "./semver";

/** Un skin dans `backup.json`. */
export type BackupSkin = { id: string; version: string; repoUrl: string; ref: string | null; subdir: string | null; commit: string; source: SkinSource; name: string };

export type SkinPlan = {
  id: string; name: string; version: string;
  /** installed : déjà là, intact · catalogue : sera réinstallé depuis son dépôt · personal : dépôt personnel, CONFIRMATION requise. */
  status: "installed" | "catalogue" | "personal";
  repoUrl: string; ref: string | null; subdir: string | null; needsConfirmation: boolean;
};
export type SkinOutcome = { id: string; outcome: "kept" | "installed" | "skipped" | "failed"; error?: string; needsCore?: string };

/** Les skins à écrire dans `backup.json` : ceux du registre, avec leur nom lisible. */
export async function backupSkins(): Promise<BackupSkin[]> {
  const rows = await readRows();
  if (!rows.length) return [];
  const names = new Map((await installed()).map((s) => [s.id, s.name.en]));
  return rows.map((r) => ({ id: r.id, version: r.version, repoUrl: r.repo, ref: r.ref, subdir: r.subdir, commit: r.commit, source: r.source, name: names.get(r.id) ?? r.id }));
}

/** Les skins d'une sauvegarde lue : `backup.json`, sinon le réglage `skin.installed` des réglages sauvegardés. Jamais d'exception ; rien n'est cru sur parole. */
export function skinsOfBackup(manifestSkins: unknown, settings: readonly Record<string, unknown>[]): BackupSkin[] {
  const clean = (raw: unknown): BackupSkin[] => {
    if (!Array.isArray(raw)) return [];
    const out: BackupSkin[] = [];
    for (const r of raw.slice(0, 200)) {
      const x = (r ?? {}) as Record<string, unknown>;
      const id = typeof x.id === "string" ? x.id : "";
      const repo = typeof x.repoUrl === "string" ? x.repoUrl : typeof x.repo === "string" ? x.repo : "";
      if (!SKIN_ID_RE.test(id) || id === "basic" || typeof x.version !== "string" || !SEMVER_RE.test(x.version) || !repo || out.some((s) => s.id === id)) continue;
      out.push({
        id, version: x.version, repoUrl: repo.slice(0, 300), ref: typeof x.ref === "string" ? x.ref.slice(0, 100) : null, subdir: typeof x.subdir === "string" ? x.subdir.slice(0, 200) : null,
        commit: typeof x.commit === "string" ? x.commit.slice(0, 64) : "", source: x.source === "personal" ? "personal" : "catalogue", name: typeof x.name === "string" ? x.name.slice(0, 60) : id,
      });
    }
    return out;
  };
  if (Array.isArray(manifestSkins)) return clean(manifestSkins);
  const row = settings.find((s) => s.key === SETTING_INSTALLED && (s.locale ?? "") === "");
  return clean(row?.value);
}

/** Aperçu avant restauration : que va-t-il se passer pour chaque skin ? */
export async function planSkins(skins: readonly BackupSkin[]): Promise<SkinPlan[]> {
  const here = new Map((await readRows()).map((r) => [r.id, r]));
  return skins.map((s): SkinPlan => {
    const base = { id: s.id, name: s.name, version: s.version, repoUrl: s.repoUrl, ref: s.ref, subdir: s.subdir };
    const row = here.get(s.id);
    if (row && row.version === s.version && filesPresent(row.id, row.version)) return { ...base, status: "installed", needsConfirmation: false };
    return s.source === "personal" ? { ...base, status: "personal", needsConfirmation: true } : { ...base, status: "catalogue", needsConfirmation: false };
  });
}

/** Les lignes du registre AVANT la restauration (à passer à `restoreSkins` ensuite). */
export const skinsBeforeRestore = (): Promise<SkinRow[]> => readRows();

/** Le skin est-il en place et intact (fichiers présents, contenu = empreinte notée) ? */
function intact(row: SkinRow): boolean {
  if (!filesPresent(row.id, row.version)) return false;
  const v = validateSkinFolder(skinDir(row.id, row.version), { coreVersion: getCoreVersion(), expectId: row.id });
  return v.ok && v.fingerprint === row.fingerprint;
}

/**
 * Après le remplacement des données : réinstalle les skins du registre restauré dont les fichiers manquent ; garde ceux de cette installation que la
 * sauvegarde ne connaissait pas ; range les dossiers que plus rien ne réclame. Ne lève jamais.
 */
export async function restoreSkins(opts: { before: readonly SkinRow[]; confirmCustom: readonly string[]; actor: string }): Promise<SkinOutcome[]> {
  const outcomes: SkinOutcome[] = [];
  try {
    const restored = await readRows();
    const known = new Set(restored.map((r) => r.id));
    const kept = opts.before.filter((r) => !known.has(r.id) && filesPresent(r.id, r.version));
    if (kept.length) await writeRows([...restored, ...kept].sort((a, b) => (a.id < b.id ? -1 : 1)));
    const confirmed = new Set(opts.confirmCustom);
    for (const row of restored) {
      if (intact(row)) { outcomes.push({ id: row.id, outcome: "kept" }); continue; }
      if (row.source === "personal" && !confirmed.has(`skin:${row.id}`)) { outcomes.push({ id: row.id, outcome: "skipped" }); continue; }
      const r = await reinstall(row.id, { actor: opts.actor });
      outcomes.push(r.ok ? { id: row.id, outcome: "installed" } : { id: row.id, outcome: "failed", error: r.error, ...(r.needsCore ? { needsCore: r.needsCore } : {}) });
    }
    await pruneSkinFiles();
  } catch (error) {
    console.error("[skins] restore failed:", (error as Error)?.message);
  }
  return outcomes;
}

