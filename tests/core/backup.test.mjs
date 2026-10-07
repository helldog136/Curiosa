import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const F = await import("@/core/backup/format");
const { createTarGz, readTarGz } = await import("@/core/backup/tar");
const { encryptBackup } = await import("@/core/backup/crypto");
const { stash, unstash, purgeStash, dropStash } = await import("@/core/backup/files");
const { installModule, setModuleEnabled } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const { UPLOADS_DIR, DATA_DIR } = await import("@/core/config");
const { BUILTIN_MODULES } = await import("@/modules-builtin");

const PW = "un-mot-de-passe-solide";
const FAST = 1000;
beforeEach(async () => { await db.reset(); fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); });
after(() => db.close());

const UPLOAD = "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("contenu-image")]);

/** Un petit site : propriétaire, réglages (dont un secret), un blog avec 2 entrées dont une traduite, une redirection, une image, des données de module. */
async function seed() {
  const owner = await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash-du-proprietaire", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
  await setSetting("site.name", "Mon site", "fr"); await setSetting("mail.pass", "mot-de-passe-smtp"); await setSetting("updates.latest", "v9.9.9");
  await db.prisma.module.upsert({ where: { id: "blog" }, create: { id: "blog", source: "builtin", version: "1", enabled: true }, update: {} });
  const blog = await createInstance(db.prisma, { manifest: BUILTIN_MODULES.find((b) => b.manifest.id === "blog").manifest, nickname: "Actus", names: { fr: "Actus", en: "News" } });
  const e1 = await createEntry(db.prisma, { instanceId: blog.id, locale: "fr", title: "Premier article", body: "Texte avec accents é à ü\n\n- liste", summary: "Résumé", status: "published", tags: ["promo", "news"], authorId: owner.id, url: "https://exemple.org/x", code: "CODE10" });
  await db.prisma.entryTranslation.create({ data: { entryId: e1.id, instanceId: blog.id, locale: "en", slug: "first-article", title: "First article", summary: "", body: "English body" } });
  await createEntry(db.prisma, { instanceId: blog.id, locale: "fr", title: "Brouillon" });
  await db.prisma.redirect.create({ data: { path: "twitch", targetUrl: "https://twitch.tv/x", permanent: true, hits: 7 } });
  await db.prisma.moduleRecord.create({ data: { instanceId: blog.id, collection: "messages", data: JSON.stringify({ name: "Alice", message: "Salut é" }) } });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, UPLOAD), PNG);
  return { owner, blog, e1 };
}
const make = (opts = {}) => B.createBackup(PW, { iterations: FAST, ...opts });
const filesOf = (b) => Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
const text = (files, p) => files[p]?.toString("utf8");

test("sauvegarde : tout ce qui est à l'utilisateur y est, les jetons d'API et le journal d'audit non", async () => {
  await seed();
  await db.prisma.apiToken.create({ data: { name: "t", hash: "h", prefix: "vit_", createdBy: "x" } });
  await db.prisma.auditLog.create({ data: { actor: "a", action: "b" } });
  const b = await make();
  const files = filesOf(b);
  for (const p of Object.values(F.DATA_FILES)) assert.ok(files[p], p);
  assert.ok(files["README.txt"] && files["backup.json"] && files["readable/site.txt"]);
  assert.ok(!Object.keys(files).some((p) => /token|audit/i.test(p)));
  const users = JSON.parse(text(files, "data/users.json"));
  assert.deepEqual([users.length, users[0].email, users[0].passwordHash], [1, "owner@example.org", "$2a$12$hash-du-proprietaire"]);
  assert.equal(JSON.parse(text(files, "data/settings.json")).find((s) => s.key === "mail.pass").value, "mot-de-passe-smtp", "les secrets du site sont sauvegardés (le fichier est chiffré)");
  assert.ok(!JSON.parse(text(files, "data/settings.json")).some((s) => s.key === "updates.latest"), "réglages volatils exclus");
  assert.ok(files[`uploads/${UPLOAD}`].equals(PNG));
  assert.deepEqual([b.manifest.format, b.manifest.formatVersion, b.manifest.counts.entries, b.manifest.counts.uploads], ["vitrine-backup", 1, 2, 1]);
});

test("sauvegarde : lisible SANS le framework — Markdown des entrées, données des modules, résumé, mode d'emploi", async () => {
  await seed();
  const files = filesOf(await make());
  const md = text(files, "readable/actus/premier-article.fr.md");
  assert.match(md, /^---\ntitle: "Premier article"\nlanguage: "fr"\nslug: "premier-article"\nstatus: "published"/);
  assert.match(md, /tags: \["promo","news"\]/);
  assert.match(md, /code: "CODE10"/);
  assert.match(md, /\n---\n\nTexte avec accents é à ü\n\n- liste\n$/);
  assert.match(text(files, "readable/actus/first-article.en.md"), /English body/);
  assert.ok(text(files, "readable/actus/brouillon.fr.md").includes('status: "draft"'), "les brouillons aussi");
  const rec = JSON.parse(text(files, "readable/modules/actus/records-messages.json"));
  assert.deepEqual([rec[0].name, rec[0].message], ["Alice", "Salut é"]);
  const site = text(files, "readable/site.txt");
  assert.match(site, /Mon site/); assert.match(site, /fr, en/);
  assert.ok(!site.includes("mot-de-passe-smtp") && site.includes("••••"), "le résumé lisible ne montre pas les secrets");
  const readme = text(files, "README.txt");
  assert.match(readme, /openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256/);
  assert.match(readme, /tar xzf/);
  assert.match(readme, /ENGLISH/);
  assert.match(readme, /sans le framework|without/i);
});

test("sauvegarde : empreintes SHA-256 de chaque fichier dans l'inventaire", async () => {
  await seed();
  const b = await make();
  const files = filesOf(b);
  assert.ok(b.manifest.files.length > 10);
  for (const f of b.manifest.files) assert.equal(F.sha256(files[f.path]), f.sha256, f.path);
  assert.ok(!b.manifest.files.some((f) => f.path === "backup.json" || f.path === "README.txt"));
});

test("sauvegarde : nom de fichier sûr, daté ; mot de passe trop court refusé", async () => {
  await seed();
  const b = await make({ now: new Date("2026-03-04T10:00:00Z") });
  assert.equal(b.filename, "backup-mon-site-2026-03-04.tar.gz.enc");
  assert.equal(F.backupFilename("../../Évil /nom\"; rm", new Date("2026-01-02")), "backup-evil-nom-rm-2026-01-02.tar.gz.enc");
  assert.equal(F.backupFilename("", new Date("2026-01-02")), "backup-site-2026-01-02.tar.gz.enc");
  await assert.rejects(() => B.createBackup("court", { iterations: FAST }), /password-too-short/);
});

test("LISIBLE SANS LE FRAMEWORK : le fichier produit s'ouvre avec `openssl` puis `tar`, avec les vraies valeurs", async () => {
  await seed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-bk-"));
  const b = await B.createBackup(PW); // vraies itérations
  fs.writeFileSync(path.join(dir, b.filename), b.buffer);
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256", "-pass", `pass:${PW}`, "-in", path.join(dir, b.filename), "-out", path.join(dir, "b.tar.gz")]);
  execFileSync("tar", ["xzf", "b.tar.gz"], { cwd: dir });
  assert.match(fs.readFileSync(path.join(dir, "README.txt"), "utf8"), /SAUVEGARDE/);
  assert.match(fs.readFileSync(path.join(dir, "readable", "actus", "premier-article.fr.md"), "utf8"), /Texte avec accents é à ü/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "uploads", UPLOAD)), PNG);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "backup.json"), "utf8")).site.name, "Mon site");
  fs.rmSync(dir, { recursive: true });
});

test("restauration : aller-retour complet — mêmes utilisateurs, réglages, instances, entrées traduites, redirections, données de modules, images", async () => {
  const { owner, blog, e1 } = await seed();
  const b = await make();
  const before = {
    entry: await db.prisma.entry.findUnique({ where: { id: e1.id }, include: { translations: { orderBy: { locale: "asc" } } } }),
    settings: await db.prisma.setting.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] }),
  };
  // on abîme tout, puis on restaure
  await db.reset();
  await db.prisma.user.create({ data: { email: "intrus@example.org", name: "X", role: "owner", passwordHash: "x" } });
  await setSetting("site.name", "Autre site");
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  const opened = Rs.openBackup(b.buffer, PW, FAST);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  assert.deepEqual((await db.prisma.user.findMany()).map((u) => [u.id, u.email, u.passwordHash, u.advanced]), [[owner.id, "owner@example.org", "$2a$12$hash-du-proprietaire", true]], "le compte de l'intrus a disparu");
  const after = await db.prisma.entry.findUnique({ where: { id: e1.id }, include: { translations: { orderBy: { locale: "asc" } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before.entry)), "entrée, traductions, dates, identifiants identiques");
  assert.deepEqual(JSON.parse(JSON.stringify(await db.prisma.setting.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] }))).filter((s) => s.key !== "updates.latest"), JSON.parse(JSON.stringify(before.settings)).filter((s) => s.key !== "updates.latest"));
  assert.equal((await db.prisma.moduleInstance.findUnique({ where: { id: blog.id } })).key, "actus");
  assert.equal((await db.prisma.redirect.findUnique({ where: { path: "twitch" } })).hits, 7);
  assert.deepEqual(JSON.parse((await db.prisma.moduleRecord.findFirst()).data), { name: "Alice", message: "Salut é" });
  assert.deepEqual(fs.readFileSync(path.join(UPLOADS_DIR, UPLOAD)), PNG);
  assert.equal((await db.prisma.entry.findFirst({ where: { id: e1.id } })).authorId, owner.id, "l'auteur est relié au compte restauré");
  assert.equal((await db.prisma.auditLog.findFirst({ where: { action: "backup.restore" } })).actor, "owner@example.org");
});

test("restauration : une copie de la base actuelle est gardée avant de la remplacer", async () => {
  await seed();
  const b = await make();
  await setSetting("site.name", "Version d'avant restauration");
  const report = await Rs.applyRestore(Rs.openBackup(b.buffer, PW, FAST).backup, { confirmCustom: [], actor: "o" });
  assert.ok(report.safetyCopy && fs.existsSync(report.safetyCopy));
  assert.match(path.basename(report.safetyCopy), /^pre-restore-\d+\.db$/);
});

test("restauration : refus net — mauvais mot de passe, fichier étranger, archive altérée ou tronquée, fichier ajouté, version plus récente, sans propriétaire", async () => {
  await seed();
  const b = await make();
  assert.equal(Rs.openBackup(b.buffer, "autre-mot-de-passe", FAST).error, "wrong-password");
  assert.equal(Rs.openBackup(Buffer.from("n'importe quoi, assez long pour passer la taille minimale du fichier"), PW, FAST).error, "not-a-backup");
  // altération d'un fichier de données (empreinte)
  const tamper = (mutate) => { const files = readTarGz(b.plain).map((f) => ({ ...f })); mutate(files); return encryptBackup(createTarGz(files), PW, FAST); };
  assert.equal(Rs.openBackup(tamper((fs_) => { fs_.find((f) => f.path === "data/entries.json").content = Buffer.from("[]"); }), PW, FAST).error, "tampered");
  assert.equal(Rs.openBackup(tamper((fs_) => fs_.push({ path: "data/pirate.json", content: Buffer.from("[]") })), PW, FAST).error, "tampered", "fichier ajouté en douce");
  assert.equal(Rs.openBackup(tamper((fs_) => fs_.splice(fs_.findIndex((f) => f.path === "data/redirects.json"), 1)), PW, FAST).error, "tampered", "fichier retiré");
  const edit = (patch) => tamper((fs_) => { const m = JSON.parse(fs_.find((f) => f.path === "backup.json").content); patch(m); fs_.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(m)); });
  assert.equal(Rs.openBackup(edit((m) => { m.formatVersion = 99; }), PW, FAST).error, "newer-format");
  assert.equal(Rs.openBackup(edit((m) => { m.format = "autre"; }), PW, FAST).error, "not-a-backup");
  const noOwner = tamper((fs_) => {
    const users = fs_.find((f) => f.path === "data/users.json"); users.content = Buffer.from(JSON.stringify([{ email: "e@x.org", role: "editor", passwordHash: "x" }]));
    const m = JSON.parse(fs_.find((f) => f.path === "backup.json").content); m.files.find((f) => f.path === "data/users.json").sha256 = F.sha256(users.content);
    fs_.find((f) => f.path === "backup.json").content = Buffer.from(JSON.stringify(m));
  });
  assert.equal(Rs.openBackup(noOwner, PW, FAST).error, "no-owner", "une restauration ne doit jamais verrouiller l'admin");
});

test("restauration : un échec en cours de route ne laisse AUCUNE donnée à moitié remplacée (transaction)", async () => {
  await seed();
  const b = await make();
  await setSetting("site.name", "Données actuelles", "fr");
  const { backup } = Rs.openBackup(b.buffer, PW, FAST);
  backup.data.entries.push({ ...backup.data.entries[0] }); // clé primaire en double : l'insertion échoue
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o" });
  assert.equal(report.ok, false);
  assert.equal((await db.prisma.setting.findFirst({ where: { key: "site.name", locale: "fr" } })).value, JSON.stringify("Données actuelles"), "base inchangée");
  assert.equal(await db.prisma.user.count(), 1);
  assert.equal(await db.prisma.entry.count(), 2);
});

test("restauration : uploads — noms invalides ignorés, anciens fichiers remplacés", async () => {
  await seed();
  const b = await make();
  fs.writeFileSync(path.join(UPLOADS_DIR, "0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a.png"), "à supprimer");
  const files = readTarGz(b.plain);
  const evil = { path: "uploads/../../evil.png", content: Buffer.from("x") };
  assert.throws(() => createTarGz([evil]));
  const { backup } = Rs.openBackup(b.buffer, PW, FAST);
  assert.deepEqual(backup.uploads.map((u) => u.name), [UPLOAD]);
  await Rs.applyRestore(backup, { confirmCustom: [], actor: "o" });
  assert.deepEqual(fs.readdirSync(UPLOADS_DIR), [UPLOAD], "seul ce que la sauvegarde contient");
  assert.ok(files.length > 0);
});

/* ───────────── Modules ───────────── */

const base = (over) => ({ apiVersion: 2, version: "1.0.0", name: "Perso", ...over });
async function withCustomModule() {
  const repo = makeRepo({ "module.json": base({ id: "perso", main: "index.mjs" }), "index.mjs": "export default { backup: { readable: (ctx) => [{ path: 'resume.csv', content: 'nom;valeur\\nclé;42\\n' }, { path: '../evil.txt', content: 'x' }] } };" });
  await installModule(repo.url);
  await setModuleEnabled("perso", true);
  const mod = await R.getModule("perso");
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, names: { fr: "Perso" } });
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "items", data: JSON.stringify({ a: 1 }) } });
  return { repo, inst };
}

test("modules : les données de CHAQUE module installé sont sauvegardées (stockage), et il peut ajouter ses fichiers lisibles", async () => {
  await seed();
  const { inst } = await withCustomModule();
  const b = await make();
  const files = filesOf(b);
  assert.deepEqual(JSON.parse(text(files, `readable/modules/${inst.key}/records-items.json`))[0].a, 1);
  assert.equal(text(files, `readable/modules/${inst.key}/resume.csv`), "nom;valeur\nclé;42\n", "fichier lisible fourni par le module");
  assert.ok(!Object.keys(files).some((p) => p.includes("evil")), "un chemin dangereux fourni par un module est ignoré");
  const m = b.manifest.modules.find((x) => x.id === "perso");
  assert.deepEqual([m.source, m.origin, m.enabled, m.repoUrl.startsWith("file:")], ["git", "custom", true, true]);
  assert.equal(b.manifest.modules.find((x) => x.id === "blog").origin, "builtin");
});

test("modules : un module qui plante pendant son export lisible n'empêche pas la sauvegarde", async () => {
  await seed();
  const repo = makeRepo({ "module.json": base({ id: "casse", main: "index.mjs" }), "index.mjs": "export default { backup: { readable: () => { throw new Error('boum'); } } };" });
  await installModule(repo.url); await setModuleEnabled("casse", true);
  await createInstance(db.prisma, { manifest: (await R.getModule("casse")).manifest, names: { fr: "Casse" } });
  const log = console.error; console.error = () => {};
  try { assert.ok((await make()).buffer.length > 100); } finally { console.error = log; }
});

test("plan de restauration : module de base, déjà installé, marketplace, personnel (confirmation), introuvable", async () => {
  const modules = [
    { id: "blog", source: "builtin", origin: "builtin", name: "Blog", version: "1", enabled: true, repoUrl: null, ref: null, commit: null },
    { id: "planning", source: "bundled", origin: "marketplace", name: "Planning", version: "1", enabled: true, repoUrl: null, ref: null, commit: null },
    { id: "sponsors", source: "bundled", origin: "marketplace", name: "Sponsors", version: "1", enabled: false, repoUrl: null, ref: null, commit: null },
    { id: "perso", source: "git", origin: "custom", name: "Perso", version: "2", enabled: true, repoUrl: "https://github.com/moi/perso", ref: "v2", commit: "abc" },
    { id: "fantome", source: "git", origin: "custom", name: "Fantôme", version: "1", enabled: true, repoUrl: null, ref: null, commit: null },
    { id: "disparu", source: "git", origin: "marketplace", name: "Disparu", version: "1", enabled: true, repoUrl: "https://github.com/x/disparu", ref: null, commit: null },
  ];
  await db.prisma.module.create({ data: { id: "sponsors", source: "bundled", version: "1", enabled: true } });
  const plan = Object.fromEntries((await Rs.planModules(modules)).map((p) => [p.id, p]));
  assert.deepEqual(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, [v.status, v.needsConfirmation]])), {
    blog: ["builtin", false], planning: ["marketplace", false], sponsors: ["installed", false], perso: ["custom", true], fantome: ["unavailable", false], disparu: ["custom", true],
  });
});

function fakeBackup(modules) {
  return { manifest: { createdAt: "2026-01-01T00:00:00Z", frameworkVersion: "1.0.0", site: { name: "S" }, counts: {}, modules, files: [], format: "vitrine-backup", formatVersion: 1 },
    data: { users: [{ id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", advanced: false, locale: null }], settings: [], modules, instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [] }, uploads: [] };
}

test("restauration des modules : marketplace → réinstallés d'office ; personnels → SEULEMENT ceux que l'utilisateur confirme, un par un", async () => {
  const mods = [
    { id: "planning", source: "bundled", origin: "marketplace", name: "P", version: "1", enabled: true, repoUrl: null, ref: null, commit: null },
    { id: "perso-a", source: "git", origin: "custom", name: "A", version: "1", enabled: true, repoUrl: "https://github.com/moi/a", ref: "v1", commit: null },
    { id: "perso-b", source: "git", origin: "custom", name: "B", version: "1", enabled: true, repoUrl: "https://github.com/moi/b", ref: null, commit: null },
    { id: "fantome", source: "git", origin: "custom", name: "F", version: "1", enabled: true, repoUrl: null, ref: null, commit: null },
  ];
  const calls = [];
  const installers = {
    fromMarketplace: async (id) => { calls.push(`marketplace:${id}`); await db.prisma.module.create({ data: { id, source: "bundled", version: "1", enabled: false } }); return { ok: true, id }; },
    fromRepo: async (url) => { calls.push(`repo:${url}`); const id = url.includes("/a") ? "perso-a" : "perso-b"; await db.prisma.module.create({ data: { id, source: "git", version: "1", enabled: false, repoUrl: url } }); return { ok: true, id }; },
  };
  const report = await Rs.applyRestore(fakeBackup(mods), { confirmCustom: ["perso-a"], actor: "o", installers });
  assert.equal(report.ok, true);
  assert.deepEqual(calls, ["marketplace:planning", "repo:https://github.com/moi/a#v1"], "perso-b non confirmé : jamais téléchargé");
  assert.deepEqual(Object.fromEntries(report.modules.map((m) => [m.id, m.outcome])), { planning: "installed", "perso-a": "installed", "perso-b": "skipped", fantome: "unavailable" });
  assert.equal((await db.prisma.module.findUnique({ where: { id: "planning" } })).enabled, true, "remis à « activé » comme sauvegardé");
  assert.equal(await db.prisma.module.findUnique({ where: { id: "perso-b" } }), null);
});

test("restauration des modules : une installation qui échoue est signalée sans bloquer le reste", async () => {
  const mods = [{ id: "planning", source: "bundled", origin: "marketplace", name: "P", version: "1", enabled: true, repoUrl: null, ref: null, commit: null }];
  const installers = { fromMarketplace: async () => ({ ok: false, error: "modules.error.clone" }), fromRepo: async () => ({ ok: false, error: "x" }) };
  const report = await Rs.applyRestore(fakeBackup(mods), { confirmCustom: [], actor: "o", installers });
  assert.equal(report.ok, true, "les données sont restaurées malgré tout");
  assert.deepEqual(report.modules, [{ id: "planning", outcome: "failed", error: "modules.error.clone" }]);
});

test("restauration des modules : les modules de base reprennent leur état activé / désactivé", async () => {
  const mods = [{ id: "blog", source: "builtin", origin: "builtin", name: "Blog", version: "1", enabled: false, repoUrl: null, ref: null, commit: null }];
  await Rs.applyRestore(fakeBackup(mods), { confirmCustom: [], actor: "o" });
  assert.equal((await db.prisma.module.findUnique({ where: { id: "blog" } })).enabled, false);
});

/* ───────────── Mise de côté entre aperçu et confirmation ───────────── */

test("mise de côté : jeton aléatoire, lisible une fois valide, expirée après 30 minutes, jamais d'évasion de chemin", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-stash-"));
  const token = stash(Buffer.from("contenu"), dir);
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(unstash(token, dir).toString(), "contenu");
  assert.equal(unstash(token, dir, Date.now() + 31 * 60_000), null, "expiré");
  assert.equal(unstash(token, dir), null, "supprimé à l'expiration");
  for (const bad of ["../../etc/passwd", "", "x".repeat(32), token.toUpperCase().slice(0, 10)]) assert.equal(unstash(bad, dir), null, bad);
  const t2 = stash(Buffer.from("a"), dir); dropStash(t2, dir); assert.equal(unstash(t2, dir), null);
  const t3 = stash(Buffer.from("b"), dir); purgeStash(dir, Date.now() + 40 * 60_000); assert.equal(unstash(t3, dir), null);
  assert.equal((fs.statSync(path.join(dir, "tmp", "restore")).mode & 0o077), 0, "dossier privé");
  fs.rmSync(dir, { recursive: true });
  assert.ok(DATA_DIR);
});
