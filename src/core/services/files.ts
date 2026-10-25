import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { prisma } from "@/core/db";
import { removeDerived } from "@/core/imageDerive";
import { UPLOAD_NAME_RE } from "@/core/services/uploads";

/**
 * FICHIERS D'UN MODULE (cœur 0.2.13) — `ctx.api.files` (permission « files ») : un module peut REVENDIQUER un fichier qu'une personne autorisée vient d'envoyer
 * par /api/admin/upload, puis le SUPPRIMER (original et dérivés en cache). Jamais d'autre fichier.
 *
 * Le registre est la table `UploadFile` (une ligne par envoi) :
 *   - à l'envoi, la route écrit une ligne « en attente » (qui l'a envoyé, quand, quelle taille) ;
 *   - la revendication n'est possible que PAR LA PERSONNE qui l'a envoyé, depuis une de ses actions d'administration (`carryRights`, voir context.ts), dans les CLAIM_WINDOW_MS
 *     qui suivent l'envoi, sur un fichier qui n'a aucun propriétaire ; elle est atomique (un seul gagnant) et idempotente pour la même instance ;
 *   - le propriétaire est l'INSTANCE (comme le stockage : une instance ne touche pas aux fichiers d'une autre) ; le module est gardé pour le quota ;
 *   - supprimer exige d'être le propriétaire ; sans ligne (déjà supprimé, jamais revendiqué, ancien envoi) il n'y a rien à faire : succès sans effet.
 * Les lignes en attente expirées sont oubliées À LA LECTURE (pas de minuteur de fond) ; le fichier, lui, n'est jamais touché : il reste au cœur, comme avant.
 * Rien ne sort jamais de UPLOADS_DIR : seuls les noms qui passent UPLOAD_NAME_RE sont acceptés, et le chemin est recalculé à partir du nom.
 */

/** Temps laissé, après l'envoi, pour revendiquer un fichier. */
export const CLAIM_WINDOW_MS = 30 * 60_000;
/** Plafonds par module (toutes ses instances) : octets et nombre de fichiers revendiqués. */
export const FILES_QUOTA_BYTES = 1024 * 1024 * 1024;
export const FILES_QUOTA_COUNT = 20_000;
/** Nettoyage des envois en attente expirés : au plus une fois par minute et par processus, 1000 lignes par passage. */
const PRUNE_EVERY_MS = 60_000;
const PRUNE_BATCH = 1000;

export type FileOwner = { moduleId: string; instanceId: string; instanceKey: string };
export type FilePerson = { id: string; email: string };

export type FileClaimResult =
  | { ok: true; url: string; bytes: number; already: boolean }
  | { ok: false; reason: "no-permission" | "no-person" | "invalid" | "unknown" | "not-uploader" | "expired" | "missing" | "taken" | "quota" };
export type FileRemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; reason: "no-permission" | "invalid" | "not-yours" | "failed" };
export type FilesUsage = { files: number; bytes: number; limitFiles: number; limitBytes: number };

/**
 * Le nom d'un envoi à partir de ce qu'un module donne : `/uploads/<nom>` (avec ou sans `?c=…` de cadrage ou `#…`) ou le nom seul.
 * Tout le reste (autre dossier, `..`, `%2e`, barre oblique inverse, hôte, nom mal formé) donne null.
 */
export function uploadNameOf(ref: unknown): string | null {
  if (typeof ref !== "string" || ref.length > 400) return null;
  const m = /^(?:\/uploads\/)?([^/\\?#%]+)(?:[?#][^\\]*)?$/.exec(ref);
  const name = m?.[1];
  return name && UPLOAD_NAME_RE.test(name) ? name : null;
}

/** Chemin d'un envoi : recalculé à partir du NOM validé, jamais d'un texte reçu ; refus si le résultat n'est pas directement dans UPLOADS_DIR. */
const pathOf = (name: string): string => {
  const file = path.join(UPLOADS_DIR, name);
  if (!UPLOAD_NAME_RE.test(name) || path.basename(file) !== name) throw new Error("path");
  return file;
};

let lastPrune = 0;
/** Oublie les envois jamais revendiqués dont la fenêtre est passée. Appelé à l'envoi et à la revendication : jamais de minuteur. `force` pour les tests. */
export async function prunePending(now = Date.now(), force = false): Promise<number> {
  if (!force && now - lastPrune < PRUNE_EVERY_MS) return 0;
  lastPrune = now;
  try {
    const old = await prisma.uploadFile.findMany({ where: { ownerInstance: null, createdAt: { lt: new Date(now - CLAIM_WINDOW_MS) } }, select: { name: true }, take: PRUNE_BATCH });
    if (!old.length) return 0;
    return (await prisma.uploadFile.deleteMany({ where: { name: { in: old.map((o) => o.name) }, ownerInstance: null } })).count;
  } catch { return 0; }
}

/** Appelé par la route d'envoi pour un fichier que le cœur vient d'écrire : le rend revendiquable, par cette personne seulement, pendant CLAIM_WINDOW_MS. Ne lève jamais. */
export async function recordUpload(url: string, uploaderId: string, bytes: number): Promise<void> {
  const name = uploadNameOf(url);
  if (!name) return;
  try {
    await prisma.uploadFile.upsert({ where: { name }, create: { name, uploaderId, bytes: Math.max(0, Math.trunc(bytes)) }, update: {} });
    void prunePending();
  } catch { /* le registre est une aide : un envoi ne doit jamais échouer à cause de lui */ }
}

export async function filesUsage(moduleId: string): Promise<FilesUsage> {
  const sum = await prisma.uploadFile.aggregate({ where: { ownerModule: moduleId }, _sum: { bytes: true }, _count: { _all: true } });
  return { files: sum._count._all, bytes: sum._sum.bytes ?? 0, limitFiles: FILES_QUOTA_COUNT, limitBytes: FILES_QUOTA_BYTES };
}

export async function ownsFile(owner: FileOwner, ref: unknown): Promise<boolean> {
  const name = uploadNameOf(ref);
  if (!name) return false;
  const row = await prisma.uploadFile.findUnique({ where: { name }, select: { ownerInstance: true } });
  return !!row && row.ownerInstance === owner.instanceId;
}

export async function claimFile(owner: FileOwner, person: FilePerson | null, ref: unknown, now = Date.now()): Promise<FileClaimResult> {
  if (!person) return { ok: false, reason: "no-person" };
  const name = uploadNameOf(ref);
  if (!name) return { ok: false, reason: "invalid" };
  void prunePending(now);
  const row = await prisma.uploadFile.findUnique({ where: { name } });
  if (!row) return { ok: false, reason: "unknown" };
  if (row.ownerInstance === owner.instanceId) return { ok: true, url: `/uploads/${name}`, bytes: row.bytes, already: true };
  if (row.ownerInstance !== null) return { ok: false, reason: "taken" };
  if (row.uploaderId !== person.id) return { ok: false, reason: "not-uploader" };
  if (now - row.createdAt.getTime() > CLAIM_WINDOW_MS) return { ok: false, reason: "expired" };
  let bytes: number;
  try {
    const st = await fs.stat(pathOf(name));
    if (!st.isFile()) return { ok: false, reason: "missing" };
    bytes = st.size;
  } catch { return { ok: false, reason: "missing" }; }
  const used = await filesUsage(owner.moduleId);
  if (used.files + 1 > FILES_QUOTA_COUNT || used.bytes + bytes > FILES_QUOTA_BYTES) return { ok: false, reason: "quota" };
  // Atomique : si deux revendications arrivent ensemble, une seule trouve encore « sans propriétaire ».
  const won = await prisma.uploadFile.updateMany({ where: { name, ownerInstance: null }, data: { ownerModule: owner.moduleId, ownerInstance: owner.instanceId, claimedAt: new Date(now), bytes } });
  if (won.count !== 1) return { ok: false, reason: "taken" };
  await audit(person.email, "file.claim", `${owner.instanceKey}: ${name}`);
  return { ok: true, url: `/uploads/${name}`, bytes, already: false };
}

/** Supprime le fichier du disque, ses dérivés puis sa ligne. Dans cet ordre : si le disque échoue, la ligne reste et un nouvel essai est possible. */
async function destroy(name: string): Promise<boolean> {
  try { await fs.rm(pathOf(name), { force: true }); } catch { return false; }
  await removeDerived(name);
  await prisma.uploadFile.deleteMany({ where: { name } });
  return true;
}

export async function removeFile(owner: FileOwner, actor: string, ref: unknown): Promise<FileRemoveResult> {
  const name = uploadNameOf(ref);
  if (!name) return { ok: false, reason: "invalid" };
  const row = await prisma.uploadFile.findUnique({ where: { name }, select: { ownerInstance: true } });
  if (!row) return { ok: true, removed: false };
  if (row.ownerInstance !== owner.instanceId) return { ok: false, reason: "not-yours" };
  if (!(await destroy(name))) return { ok: false, reason: "failed" };
  await audit(actor, "file.remove", `${owner.instanceKey}: ${name}`);
  return { ok: true, removed: true };
}

/**
 * « Tout effacer » (désinstallation sans garder les données, suppression d'une instance, données gardées effacées) : les fichiers que ces instances ou ce module
 * avaient revendiqués partent aussi, sinon ils resteraient sans propriétaire ni moyen de les retirer. Garder les données garde les fichiers (le registre suit l'instance).
 * Ne lève jamais ; renvoie le nombre de fichiers supprimés.
 */
export async function eraseOwnedFiles(target: { moduleId: string } | { instanceId: string }, actor: string): Promise<number> {
  let done = 0;
  try {
    const where = "moduleId" in target ? { ownerModule: target.moduleId } : { ownerInstance: target.instanceId };
    for (let pass = 0; pass < 50; pass++) {
      const rows = await prisma.uploadFile.findMany({ where, select: { name: true }, take: 500 });
      if (!rows.length) break;
      let progress = 0;
      for (const r of rows) if (await destroy(r.name)) { done++; progress++; }
      if (!progress) break;
    }
    if (done) await audit(actor, "file.erase", `${"moduleId" in target ? target.moduleId : target.instanceId}: ${done}`);
  } catch { /* le nettoyage est au mieux : l'effacement des données, lui, a déjà eu lieu */ }
  return done;
}

async function audit(actor: string, action: string, target: string): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target: target.slice(0, 200) } }).catch(() => {});
}
