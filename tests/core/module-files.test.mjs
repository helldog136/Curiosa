// ctx.api.files (cœur 0.2.13) : un module revendique un fichier qu'une personne vient d'envoyer, puis le supprime (original + dérivés).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const F = await import("@/core/services/files");
const { UPLOADS_DIR } = await import("@/core/config");
const { cacheName, CROP_CACHE_DIR, removeDerived } = await import("@/core/imageDerive");
const { makeApi } = await import("@/core/modules/api");
const { retireInstance, eraseRetired } = await import("@/core/modules/retired");
const { removeInstance } = await import("@/core/instanceService");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { parseManifest } = await import("@/core/modules/manifest");

beforeEach(async () => { await db.reset(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); fs.rmSync(CROP_CACHE_DIR, { recursive: true, force: true }); });
after(() => db.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const A = { id: "u-a", email: "a@example.org" };
const B2 = { id: "u-b", email: "b@example.org" };
const gallery = { moduleId: "gallery", instanceId: "i-g1", instanceKey: "gallery-1" };
const gallery2 = { moduleId: "gallery", instanceId: "i-g2", instanceKey: "gallery-2" };
const other = { moduleId: "notes", instanceId: "i-n1", instanceKey: "notes-1" };
const onDisk = (name) => fs.existsSync(path.join(UPLOADS_DIR, name));
/** Ce que fait la route d'envoi : écrit le fichier puis le note dans le registre. */
async function upload(by = A.id, size = PNG.length) {
  const name = `${crypto.randomUUID()}.png`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, name), PNG);
  await F.recordUpload(`/uploads/${name}`, by, size);
  return name;
}
const derived = (name, ratio = 1) => {
  const f = path.join(CROP_CACHE_DIR, cacheName(name, { ratio, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff" }, false));
  fs.mkdirSync(CROP_CACHE_DIR, { recursive: true }); fs.writeFileSync(f, "x");
  return f;
};
const audits = async (action) => db.prisma.auditLog.findMany({ where: { action } });

// ── Noms ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("uploadNameOf : seul un envoi du cœur est reconnu ; traversée de chemin, encodages, autres dossiers et noms mal formés sont refusés", () => {
  const id = crypto.randomUUID();
  assert.equal(F.uploadNameOf(`/uploads/${id}.png`), `${id}.png`);
  assert.equal(F.uploadNameOf(`${id}.webp`), `${id}.webp`);
  assert.equal(F.uploadNameOf(`/uploads/${id}.jpg?c=1.0,1,0.5,0.5,ffffff&s=1`), `${id}.jpg`);
  for (const bad of [
    `/uploads/../${id}.png`, `/uploads/../../etc/passwd`, `../${id}.png`, `/uploads/sub/${id}.png`, `/uploads/${id}.png/../x`, `/uploads/%2e%2e/${id}.png`, `/uploads/${id}%2epng`,
    `/uploads\\${id}.png`, `https://example.org/uploads/${id}.png`, `//evil/${id}.png`, `/uploads/${id}.php`, `/uploads/${id}.png.php`, `/uploads/x.png`, `/uploads/`, "", "   ",
    `/uploads/${id}.png\n`, `/uploads/${id}.png\u0000.jpg`, `/data/${id}.png`, `/uploads/${"a".repeat(500)}.png`, null, undefined, 42, {}, [`/uploads/${id}.png`],
  ]) assert.equal(F.uploadNameOf(bad), null, JSON.stringify(bad));
});

// ── Revendiquer ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("revendiquer : la personne qui vient d'envoyer le fichier, une fois ; idempotent pour la même instance ; audit sans contenu", async () => {
  const name = await upload();
  const r = await F.claimFile(gallery, A, `/uploads/${name}`);
  assert.deepEqual(r, { ok: true, url: `/uploads/${name}`, bytes: PNG.length, already: false });
  const again = await F.claimFile(gallery, A, `/uploads/${name}?c=1,1,0.5,0.5,ffffff`);
  assert.equal(again.ok, true); assert.equal(again.already, true);
  assert.equal(await F.ownsFile(gallery, `/uploads/${name}`), true);
  assert.equal(await F.ownsFile(other, `/uploads/${name}`), false);
  const row = await db.prisma.uploadFile.findUnique({ where: { name } });
  assert.equal(row.ownerModule, "gallery"); assert.equal(row.ownerInstance, "i-g1"); assert.ok(row.claimedAt);
  const log = await audits("file.claim");
  assert.equal(log.length, 1, "une seule trace : la deuxième demande ne change rien");
  assert.equal(log[0].actor, "a@example.org"); assert.match(log[0].target, /gallery-1/);
});

test("revendiquer : refusé sans personne, pour une autre personne, un fichier inconnu, un ancien envoi (sans ligne), expiré, absent du disque", async () => {
  const name = await upload();
  assert.deepEqual(await F.claimFile(gallery, null, name), { ok: false, reason: "no-person" });
  assert.deepEqual(await F.claimFile(gallery, B2, name), { ok: false, reason: "not-uploader" });
  assert.deepEqual(await F.claimFile(gallery, A, "not a file"), { ok: false, reason: "invalid" });
  assert.deepEqual(await F.claimFile(gallery, A, `/uploads/${crypto.randomUUID()}.png`), { ok: false, reason: "unknown" });
  // Un fichier du disque envoyé avant la 0.2.13 (ou par le cœur, comme un logo) : pas de ligne, donc jamais revendiquable.
  const legacy = `${crypto.randomUUID()}.png`; fs.writeFileSync(path.join(UPLOADS_DIR, legacy), PNG);
  assert.deepEqual(await F.claimFile(gallery, A, legacy), { ok: false, reason: "unknown" });
  assert.equal(onDisk(legacy), true);
  // Expiré.
  assert.deepEqual(await F.claimFile(gallery, A, name, Date.now() + F.CLAIM_WINDOW_MS + 5000), { ok: false, reason: "expired" });
  const late = await upload();
  assert.equal((await F.claimFile(gallery, A, late, Date.now() + F.CLAIM_WINDOW_MS - 5000)).ok, true, "juste avant la fin de la fenêtre");
  // Fichier disparu du disque.
  const gone = await upload(); fs.rmSync(path.join(UPLOADS_DIR, gone));
  assert.deepEqual(await F.claimFile(gallery, A, gone), { ok: false, reason: "missing" });
  assert.equal((await db.prisma.uploadFile.findUnique({ where: { name: gone } })).ownerInstance, null);
});

test("revendiquer : jamais le fichier d'un autre module ni d'une autre instance ; deux revendications simultanées, un seul gagnant", async () => {
  const name = await upload();
  assert.equal((await F.claimFile(gallery, A, name)).ok, true);
  assert.deepEqual(await F.claimFile(other, A, name), { ok: false, reason: "taken" });
  assert.deepEqual(await F.claimFile(gallery2, A, name), { ok: false, reason: "taken" });
  const race = await upload();
  const results = await Promise.all([F.claimFile(gallery, A, race), F.claimFile(other, A, race), F.claimFile(gallery2, A, race)]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === "taken"));
});

test("les envois en attente expirés sont oubliés à la lecture (sans minuteur) ; le fichier, lui, n'est jamais touché", async () => {
  const name = await upload();
  await db.prisma.uploadFile.update({ where: { name }, data: { createdAt: new Date(Date.now() - F.CLAIM_WINDOW_MS - 60_000) } });
  const claimed = await upload();
  await F.claimFile(gallery, A, claimed);
  await db.prisma.uploadFile.update({ where: { name: claimed }, data: { createdAt: new Date(Date.now() - 10 * F.CLAIM_WINDOW_MS) } });
  assert.equal(await F.prunePending(Date.now(), true), 1);
  assert.equal(await db.prisma.uploadFile.findUnique({ where: { name } }), null);
  assert.ok(await db.prisma.uploadFile.findUnique({ where: { name: claimed } }), "un fichier revendiqué n'expire jamais");
  assert.equal(onDisk(name), true, "le fichier reste au cœur, comme avant");
  assert.equal(onDisk(claimed), true);
});

test("quota par module : l'espace est compté sur toutes ses instances ; au-delà, refus ; supprimer rend la place", async () => {
  const filler = await upload();
  await F.claimFile(gallery, A, filler);
  await db.prisma.uploadFile.update({ where: { name: filler }, data: { bytes: F.FILES_QUOTA_BYTES - 50 } });
  assert.deepEqual(await F.filesUsage("gallery"), { files: 1, bytes: F.FILES_QUOTA_BYTES - 50, limitFiles: F.FILES_QUOTA_COUNT, limitBytes: F.FILES_QUOTA_BYTES });
  const big = await upload(); fs.writeFileSync(path.join(UPLOADS_DIR, big), Buffer.alloc(100));
  assert.deepEqual(await F.claimFile(gallery2, A, big), { ok: false, reason: "quota" }, "une autre instance du même module partage le plafond");
  assert.equal((await F.claimFile(other, A, big)).ok, true, "un autre module a le sien");
  const small = await upload(A.id); fs.writeFileSync(path.join(UPLOADS_DIR, small), Buffer.alloc(50));
  assert.equal((await F.claimFile(gallery, A, small)).ok, true, "exactement le plafond");
  assert.equal((await F.removeFile(gallery, "x", filler)).ok, true);
  assert.equal((await F.filesUsage("gallery")).files, 1);
  assert.deepEqual(await F.filesUsage("rien"), { files: 0, bytes: 0, limitFiles: F.FILES_QUOTA_COUNT, limitBytes: F.FILES_QUOTA_BYTES });
});

// ── Supprimer ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("supprimer : l'original, ses dérivés en cache et sa ligne partent ; les dérivés des autres fichiers restent ; audit", async () => {
  const name = await upload(); const neighbour = await upload();
  await F.claimFile(gallery, A, name); await F.claimFile(gallery, A, neighbour);
  const d1 = derived(name, 1), d2 = derived(name, 1.5), keep = derived(neighbour, 1);
  assert.deepEqual(await F.removeFile(gallery, "a@example.org", `/uploads/${name}?c=1,1,0.5,0.5,ffffff`), { ok: true, removed: true });
  assert.equal(onDisk(name), false);
  assert.equal(fs.existsSync(d1), false); assert.equal(fs.existsSync(d2), false);
  assert.equal(fs.existsSync(keep), true); assert.equal(onDisk(neighbour), true);
  assert.equal(await db.prisma.uploadFile.findUnique({ where: { name } }), null);
  const log = await audits("file.remove");
  assert.equal(log.length, 1); assert.equal(log[0].actor, "a@example.org");
});

test("supprimer : idempotent (deux fois = succès sans effet), fichier inconnu = rien à faire", async () => {
  const name = await upload(); await F.claimFile(gallery, A, name);
  assert.deepEqual(await F.removeFile(gallery, "m", name), { ok: true, removed: true });
  assert.deepEqual(await F.removeFile(gallery, "m", name), { ok: true, removed: false });
  assert.deepEqual(await F.removeFile(gallery, "m", `/uploads/${crypto.randomUUID()}.png`), { ok: true, removed: false });
  assert.equal((await audits("file.remove")).length, 1, "la deuxième demande n'écrit rien");
});

test("supprimer : jamais le fichier d'un autre module, d'une autre instance, ni un envoi non revendiqué ; rien hors de /uploads", async () => {
  const mine = await upload(); await F.claimFile(gallery, A, mine);
  const pending = await upload();
  assert.deepEqual(await F.removeFile(other, "m", mine), { ok: false, reason: "not-yours" });
  assert.deepEqual(await F.removeFile(gallery2, "m", mine), { ok: false, reason: "not-yours" });
  assert.deepEqual(await F.removeFile(gallery, "m", pending), { ok: false, reason: "not-yours" });
  assert.equal(onDisk(mine), true); assert.equal(onDisk(pending), true);
  // Un fichier du cœur à côté (logo, sauvegarde, base) : atteignable par aucune adresse.
  const secret = path.join(path.dirname(UPLOADS_DIR), "secret.png"); fs.writeFileSync(secret, PNG);
  const legacy = `${crypto.randomUUID()}.png`; fs.writeFileSync(path.join(UPLOADS_DIR, legacy), PNG);
  for (const bad of ["/uploads/../secret.png", "../secret.png", `/uploads/..%2fsecret.png`, secret, `/uploads/${legacy}/../../secret.png`, "/uploads/", "x"]) {
    assert.equal((await F.removeFile(gallery, "m", bad)).ok, false, bad);
  }
  assert.deepEqual(await F.removeFile(gallery, "m", legacy), { ok: true, removed: false }, "un ancien envoi n'a pas de propriétaire");
  assert.equal(fs.existsSync(secret), true); assert.equal(onDisk(legacy), true);
});

test("supprimer : si le disque refuse, la ligne reste (un nouvel essai est possible) ; un fichier déjà parti du disque se nettoie quand même", async () => {
  const name = await upload(); await F.claimFile(gallery, A, name);
  fs.rmSync(path.join(UPLOADS_DIR, name));                                    // disparu du disque (ou restauration partielle) : la ligne est nettoyée
  assert.deepEqual(await F.removeFile(gallery, "m", name), { ok: true, removed: true });
  assert.equal(await db.prisma.uploadFile.findUnique({ where: { name } }), null);
  const stuck = await upload(); await F.claimFile(gallery, A, stuck);
  fs.rmSync(path.join(UPLOADS_DIR, stuck)); fs.mkdirSync(path.join(UPLOADS_DIR, stuck));   // un dossier à la place : rm sans recursive échoue
  fs.writeFileSync(path.join(UPLOADS_DIR, stuck, "f"), "x");
  assert.deepEqual(await F.removeFile(gallery, "m", stuck), { ok: false, reason: "failed" });
  assert.ok(await db.prisma.uploadFile.findUnique({ where: { name: stuck } }));
});

test("removeDerived : seulement les dérivés de CE fichier, et rien pour un nom invalide", async () => {
  const a = crypto.randomUUID() + ".png", b = crypto.randomUUID() + ".png";
  const fa = derived(a), fb = derived(b);
  fs.writeFileSync(path.join(CROP_CACHE_DIR, "unrelated.webp"), "x");
  assert.equal(await removeDerived("../x"), 0); assert.equal(await removeDerived(""), 0);
  assert.equal(await removeDerived(a), 1);
  assert.equal(fs.existsSync(fa), false); assert.equal(fs.existsSync(fb), true); assert.equal(fs.existsSync(path.join(CROP_CACHE_DIR, "unrelated.webp")), true);
  assert.equal(await removeDerived(a), 0, "idempotent");
});

// ── Désinstallation, suppression d'instance ─────────────────────────────────────────────────────────────────────────

async function withInstance(id, moduleId) {
  return db.prisma.moduleInstance.create({ data: { id, moduleId, key: `${moduleId}-${id}`, basePath: null, nickname: id } });
}

test("retirer en gardant les données garde les fichiers ; réinstaller les retrouve ; « effacer » les supprime avec leurs dérivés", async () => {
  await withInstance("i-g1", "gallery");
  const name = await upload(); await F.claimFile(gallery, A, name); const d = derived(name);
  assert.ok(await retireInstance("i-g1", "uninstall"));
  assert.equal(onDisk(name), true, "gardé");
  assert.equal(await F.ownsFile(gallery, name), true, "le registre suit l'instance rangée");
  assert.equal(await eraseRetired({ id: "i-g1" }), 1);
  assert.equal(onDisk(name), false); assert.equal(fs.existsSync(d), false);
  assert.equal(await db.prisma.uploadFile.count(), 0);
  assert.equal((await audits("file.erase")).length, 1);
});

test("« effacer les données gardées d'un module » ne touche que les fichiers des instances rangées de CE module", async () => {
  await withInstance("i-g1", "gallery"); await withInstance("i-n1", "notes");
  const g = await upload(); await F.claimFile(gallery, A, g);
  const n = await upload(); await F.claimFile(other, A, n);
  await retireInstance("i-g1", "uninstall");
  await eraseRetired({ moduleId: "gallery" });
  assert.equal(onDisk(g), false); assert.equal(onDisk(n), true);
});

test("supprimer une instance en effaçant tout supprime ses fichiers ; la garder (retirer) les garde ; une autre instance n'est pas touchée", async () => {
  await withInstance("i-g1", "gallery"); await withInstance("i-g2", "gallery");
  const a = await upload(); await F.claimFile(gallery, A, a);
  const b = await upload(); await F.claimFile(gallery2, A, b);
  assert.equal(await removeInstance("i-g1", { keepData: false }), true);
  assert.equal(onDisk(a), false); assert.equal(onDisk(b), true);
  assert.equal(await removeInstance("i-g2", { keepData: true }), true);
  assert.equal(onDisk(b), true, "garder les données = garder les fichiers");
});

test("eraseOwnedFiles par module : tous ses fichiers (toutes instances), jamais ceux d'un autre module ; ne lève jamais", async () => {
  const a = await upload(); await F.claimFile(gallery, A, a);
  const b = await upload(); await F.claimFile(gallery2, A, b);
  const c = await upload(); await F.claimFile(other, A, c);
  assert.equal(await F.eraseOwnedFiles({ moduleId: "gallery" }, "system"), 2);
  assert.equal(onDisk(a) || onDisk(b), false); assert.equal(onDisk(c), true);
  assert.equal(await F.eraseOwnedFiles({ moduleId: "gallery" }, "system"), 0);
});

// ── ctx.api.files ───────────────────────────────────────────────────────────────────────────────────────────────────

const view = (o) => ({ id: o.instanceId, key: o.instanceKey, moduleId: o.moduleId, nickname: null, basePath: null, names: {}, descriptions: {} });
const apiFor = (o, permissions, person) => makeApi(view(o), "en", permissions, { person: person ? { ...person, name: "n", level: "owner", roles: [], rights: new Set() } : null });

test("ctx.api.files : sans la permission « files », rien n'est revendiqué ni supprimé et rien ne lève ; avec elle, le parcours complet", async () => {
  const name = await upload();
  const denied = apiFor(gallery, ["storage"], A).files;
  assert.deepEqual(await denied.claim(name), { ok: false, reason: "no-permission" });
  assert.deepEqual(await denied.remove(name), { ok: false, reason: "no-permission" });
  assert.equal(await denied.owns(name), false);
  assert.deepEqual(await denied.usage(), { files: 0, bytes: 0, limitFiles: 0, limitBytes: 0 });
  assert.equal(await db.prisma.uploadFile.count({ where: { ownerInstance: { not: null } } }), 0);

  const api = apiFor(gallery, ["storage", "files"], A).files;
  assert.equal((await api.claim(`/uploads/${name}`)).ok, true);
  assert.equal(await api.owns(name), true);
  assert.deepEqual(await api.usage(), { files: 1, bytes: PNG.length, limitFiles: F.FILES_QUOTA_COUNT, limitBytes: F.FILES_QUOTA_BYTES });
  assert.deepEqual(await apiFor(other, ["files"], A).files.remove(name), { ok: false, reason: "not-yours" });
  assert.deepEqual(await api.remove(name), { ok: true, removed: true });
  assert.equal(onDisk(name), false);
  assert.deepEqual(await api.remove(name), { ok: true, removed: false });
  assert.equal(await api.owns(name), false);
});

test("ctx.api.files.claim : hors action d'administration (aucune personne : page, route, tâche, MCP), refus", async () => {
  const name = await upload();
  assert.deepEqual(await apiFor(gallery, ["files"], null).files.claim(name), { ok: false, reason: "no-person" });
  assert.deepEqual(await apiFor(gallery, ["files"], B2).files.claim(name), { ok: false, reason: "not-uploader" });
  // Supprimer, en revanche, n'exige pas de personne (une tâche peut nettoyer ses propres fichiers) : l'acteur du journal est alors le module.
  assert.equal((await apiFor(gallery, ["files"], A).files.claim(name)).ok, true);
  assert.deepEqual(await apiFor(gallery, ["files"], null).files.remove(name), { ok: true, removed: true });
  assert.equal((await audits("file.remove"))[0].actor, "module:gallery-1");
});

// ── Route d'envoi, sauvegarde, manifeste ────────────────────────────────────────────────────────────────────────────

test("la route d'envoi note l'envoi dans le registre (pour la personne connectée seulement) et les logos SVG n'y entrent pas", () => {
  const src = fs.readFileSync("src/app/api/admin/upload/route.ts", "utf8");
  assert.match(src, /recordUpload\(url, user\.id, buf\.length\)/);
  assert.ok(src.indexOf("looksLikeSvg(buf)") < src.lastIndexOf("recordUpload"), "le chemin des logos SVG répond avant");
});

test("sauvegarde : le propriétaire des fichiers revendiqués est exporté et restauré avec le fichier ; les envois en attente ne le sont pas", async () => {
  await db.prisma.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "h" } });
  await withInstance("i-g1", "gallery");
  const kept = await upload(); await F.claimFile(gallery, A, kept);
  const pending = await upload();
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.deepEqual(opened.backup.data.uploadFiles.map((r) => r.name), [kept]);
  // Le fichier est supprimé APRÈS la sauvegarde : restaurer le ramène avec son propriétaire (les données du module restaurées le désignent aussi).
  await F.removeFile(gallery, "m", kept);
  assert.equal(onDisk(kept), false);
  const res = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "o" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(onDisk(kept), true);
  assert.equal(await F.ownsFile(gallery, kept), true);
  assert.equal(await db.prisma.uploadFile.findUnique({ where: { name: pending } }), null);
  assert.deepEqual(await F.removeFile(gallery, "m", kept), { ok: true, removed: true }, "la suppression marche après une restauration");
  // Une sauvegarde d'avant la 0.2.13 (sans le fichier du registre) se restaure : aucun fichier n'a de propriétaire.
  const old = opened.backup; old.data.uploadFiles = undefined;
  assert.equal((await Rs.applyRestore(old, { confirmCustom: [], actor: "o" })).ok, true);
  assert.equal(await db.prisma.uploadFile.count(), 0);
});

test("manifeste : la permission « files » est connue ; une permission inventée est refusée ; le texte simple existe en français et en anglais", () => {
  const base = { apiVersion: 2, id: "x-mod", name: { en: "X", fr: "X" }, version: "1.0.0", instances: "single" };
  assert.equal(parseManifest({ ...base, permissions: ["files"] }).ok, true);
  assert.equal(parseManifest({ ...base, permissions: ["fil"] }).ok, false);
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  assert.equal(fr["perm.files"], "Garder et supprimer les fichiers que vous envoyez via ce module");
  assert.equal(en["perm.files"], "Keep and delete the files you upload through this module");
  for (const k of ["file.claim", "file.remove", "file.erase"]) { assert.ok(fr[`audit.action.${k}`]); assert.ok(en[`audit.action.${k}`]); }
});
