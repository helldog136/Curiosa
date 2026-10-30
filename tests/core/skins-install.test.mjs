// Installation des skins depuis un dépôt git (lot S5) avec de VRAIS dépôts git locaux jetables (comme tests/modules-mgmt) : catalogue, installation,
// refus, mise à jour avec retour arrière, retrait, repli sur basic, catalogue injoignable, aperçu sans installer. Aucun réseau.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { copySkin, createSkinsRepo, fakeFont, fakePng, SKINS_HTTPS, TEST_CORE } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const S = await import("@/core/skins/service");
const R = await import("@/core/skins/registry");
const { setSetting, getSetting } = await import("@/core/settings");
const cat = createSkinsRepo();

const SKINS = path.join(db.dir, "skins");
const rows = () => R.readRows();
const audits = async () => (await db.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).filter((a) => a.action.startsWith("skin.")).map((a) => `${a.action} ${a.target}`);
const personal = (id, version = "1.0.0", folder = id) => `${cat.url}#${id}-v${version}:skins/${folder}`;
const asset = (file, kind, extra = {}) => ({ file, kind, license: "OFL-1.1", licenseFile: "LICENSES/ofl.txt", author: "Fonderie de test", source: "https://example.org/font", ...extra });

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.setServiceHooksForTests({});
  S.clearSkinCaches();
  delete process.env.SKINS_INDEX_URL;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
});
after(() => { db.close(); cat.close(); });

test("catalogue : lit l'index du dépôt de skins, écarte les entrées douteuses, dit ce qui est installé", async () => {
  await cat.publish("plain-light");
  await cat.setIndex(
    { id: "plain-light", name: { fr: "Clair simple", en: "Plain light" }, description: { fr: "d", en: "d" }, repo: SKINS_HTTPS, subdir: "skins/plain-light", ref: "plain-light-v1.0.0", version: "1.0.0", skinContract: 1, tags: ["light", "inconnue"], modes: ["light"], requires: { core: "0.4.0" } },
    { id: "basic", name: "Basic", repo: SKINS_HTTPS },                                  // réservé
    { id: "Mauvais Id", name: "x", repo: SKINS_HTTPS },                                  // identifiant invalide
    { id: "ailleurs", name: "x", repo: "https://evil.example.org/o/r" },                 // hébergeur non autorisé
    { id: "local", name: "x", repo: "file:///tmp/depot" },                               // jamais de dépôt local dans un index
    { id: "avec-mdp", name: "x", repo: "https://u:p@github.com/o/r" },
    { id: "futur", name: "x", repo: SKINS_HTTPS, subdir: "skins/futur", skinContract: 9 },
    { id: "trop-recent", name: "x", repo: SKINS_HTTPS, subdir: "skins/tr", requires: { core: "9.0.0" } },
    { id: "plain-light", name: "doublon", repo: SKINS_HTTPS },
  );
  const l = await S.listCatalogue();
  assert.equal(l.ok, true);
  assert.equal(l.source, "repository");
  assert.equal(l.unreachable, false);
  assert.deepEqual(l.items.map((i) => i.id), ["plain-light", "futur", "trop-recent"]);
  const p = l.items[0];
  assert.deepEqual(p.tags, ["light"], "étiquettes hors vocabulaire écartées");
  assert.equal(p.origin, "official");
  assert.equal(p.installed, false);
  assert.equal(l.items[1].compatible, false, "contrat plus récent : listé mais pas installable");
  assert.equal(l.items[2].needsNewerCore, "9.0.0");
  assert.equal((await S.installFromCatalogue("futur")).error, "skins.error.contract");
  const tooNew = await S.installFromCatalogue("trop-recent");
  assert.deepEqual([tooNew.error, tooNew.needsCore], ["skins.error.core", "9.0.0"], "refusé AVANT de télécharger quoi que ce soit");
  assert.equal(fs.existsSync(SKINS) ? fs.readdirSync(SKINS).length : 0, 0);
});

test("installation depuis le catalogue : fichiers posés, ligne au registre (dépôt, étiquette, commit, empreinte, date), audit, rien d'autre", async () => {
  await cat.publish("plain-light");
  const r = await S.installFromCatalogue("plain-light", { actor: "owner@test" });
  assert.deepEqual({ ok: r.ok, id: r.id, version: r.version, source: r.source, warnings: r.warnings }, { ok: true, id: "plain-light", version: "1.0.0", source: "catalogue", warnings: [] });
  const dir = path.join(SKINS, "plain-light", "1.0.0");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["README.md", "previews", "skin.css", "skin.json", "tokens.json"], "ni .git ni fichier inattendu");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")), ["1.0.0"], "aucun dossier temporaire ne reste");
  assert.deepEqual(fs.readdirSync(SKINS), ["plain-light"]);
  const [row] = await rows();
  assert.equal(row.repo, SKINS_HTTPS);
  assert.equal(row.ref, "plain-light-v1.0.0");
  assert.equal(row.subdir, "skins/plain-light");
  assert.equal(row.source, "catalogue");
  assert.match(row.commit, /^[0-9a-f]{40}$/);
  assert.match(row.tree, /^[0-9a-f]{40}$/);
  assert.match(row.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(Date.now() - Date.parse(row.installedAt)) < 60_000);
  assert.deepEqual(await audits(), ["skin.install plain-light@1.0.0"]);
  const [s] = await S.installed();
  assert.deepEqual({ id: s.id, version: s.version, status: s.status, active: s.active, problems: s.problems }, { id: "plain-light", version: "1.0.0", status: "ok", active: false, problems: [] });
  assert.equal(s.name.fr, "Clair simple");
  assert.equal((await S.installFromCatalogue("plain-light")).error, "skins.error.exists");
  assert.equal((await S.listCatalogue()).items[0].installedVersion, "1.0.0");
  // L'installation ne choisit pas le skin et ne touche à aucun réglage d'apparence.
  assert.equal(await getSetting("skin.active"), undefined);
  assert.equal(await S.activeSkinId(), "basic");
});

test("dépôt PERSONNEL : confirmation explicite exigée (rien n'est téléchargé sans elle) ; avec elle, installé comme « personnel »", async () => {
  await cat.publish("mon-skin", { listed: false });
  const refused = await S.install(personal("mon-skin"));
  assert.deepEqual([refused.ok, refused.error, refused.origin], [false, "skins.error.personalConfirm", "personal"]);
  assert.deepEqual(await rows(), []);
  assert.equal((await S.install(personal("mon-skin"), { confirmPersonal: false })).error, "skins.error.personalConfirm");
  const ok = await S.install(personal("mon-skin"), { confirmPersonal: true, actor: "owner@test" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.source, "personal");
  assert.equal((await rows())[0].source, "personal");
  assert.deepEqual(await audits(), ["skin.install mon-skin@1.0.0 personal"]);
});

test("un skin listé au catalogue officiel s'installe sans confirmation, même par son adresse ; l'index supplémentaire exige la confirmation", async () => {
  await cat.publish("plain-light");
  const ok = await S.install(`${SKINS_HTTPS}#plain-light-v1.0.0:skins/plain-light`);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.source, "catalogue");
  await S.remove("plain-light");
  // Index supplémentaire (SKINS_INDEX_URL) : il ne peut qu'AJOUTER des skins, jamais installés sans confirmation.
  await cat.publish("venu-d-ailleurs", { listed: false });
  process.env.SKINS_INDEX_URL = "https://index.example.org/skins.json";
  const fetchImpl = async () => new Response(JSON.stringify({ version: 1, skins: [
    { id: "venu-d-ailleurs", name: "Ailleurs", repo: SKINS_HTTPS, subdir: "skins/venu-d-ailleurs", ref: "venu-d-ailleurs-v1.0.0", version: "1.0.0" },
    { id: "plain-light", name: "usurpateur", repo: SKINS_HTTPS, subdir: "skins/autre" },
  ] }));
  const l = await S.listCatalogue({ fresh: true, fetchImpl });
  assert.deepEqual(l.items.map((i) => [i.id, i.origin]), [["plain-light", "official"], ["venu-d-ailleurs", "extra"]], "un id déjà au catalogue officiel n'est pas remplacé");
  assert.equal((await S.installFromCatalogue("venu-d-ailleurs")).error, "skins.error.personalConfirm");
  assert.deepEqual(await rows(), []);
  const done = await S.installFromCatalogue("venu-d-ailleurs", { confirmExtra: true });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.source, "personal", "non vérifié : noté comme personnel");
});

test("adresses refusées : hôte interdit, http, identifiants, requête, étiquette ou dossier dangereux, dépôt local hors développement", async () => {
  const bad = async (url, code, opts) => { const r = await S.install(url, { confirmPersonal: true, ...opts }); assert.deepEqual([r.ok, r.error], [false, code], url); };
  await bad("https://evil.example.org/o/r", "skins.error.host");
  await bad("http://github.com/o/r", "skins.error.url");
  await bad("https://user:pw@github.com/o/r", "skins.error.url");
  await bad("https://github.com/o/r?x=1", "skins.error.url");
  await bad("pas une adresse", "skins.error.url");
  await bad("https://github.com/o/r#v1:../x", "skins.error.subdir");
  await bad("https://github.com/o/r#v1:/abs", "skins.error.subdir");
  await bad("https://github.com/o/r#bad ref", "skins.error.ref");
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "0";
  await bad(`${cat.url}#x`, "skins.error.local");
  assert.equal(fs.existsSync(SKINS) && fs.readdirSync(SKINS).length, 0 || false);
  assert.deepEqual(await audits(), [], "un refus d'adresse n'écrit rien");
  // MODULES_ALLOWED_HOSTS est le réglage commun des hébergeurs git de confiance.
  process.env.MODULES_ALLOWED_HOSTS = "gitlab.com";
  try { await bad("https://github.com/o/r", "skins.error.host"); } finally { delete process.env.MODULES_ALLOWED_HOSTS; }
});

test("dépôt injoignable ou dossier absent : message simple, rien n'est installé", async () => {
  const r = await S.install(`file://${db.dir}/nexiste-pas#v1`, { confirmPersonal: true });
  assert.deepEqual([r.ok, r.error], [false, "skins.error.clone"]);
  await cat.publish("mon-skin", { listed: false });
  assert.equal((await S.install(`${cat.url}#mon-skin-v1.0.0:skins/inconnu`, { confirmPersonal: true })).ok, false);
  assert.equal((await S.install(`${cat.url}#mon-skin-v1.0.0`, { confirmPersonal: true })).error, "skins.error.nomanifest", "racine sans skin.json");
  assert.deepEqual(await rows(), []);
  assert.deepEqual(fs.readdirSync(SKINS), [], "aucun reste temporaire");
});

// ---------------------------------------------------------------------------------------------------------------------
// Refus à l'installation : chaque cas laisse le site exactement comme avant et écrit un « skin.refused » sans contenu.

async function refused(id, opts, expectedError, expectedCode) {
  await cat.publish(id, { listed: false, ...opts });
  const r = await S.install(personal(id, opts.version ?? "1.0.0"), { confirmPersonal: true });
  assert.equal(r.ok, false, `${id} aurait dû être refusé`);
  assert.equal(r.error, expectedError, `${id} : ${JSON.stringify(r.issues?.map((i) => i.code))}`);
  if (expectedCode) assert.ok(r.issues.some((i) => i.code === expectedCode), `${id} : ${expectedCode} attendu parmi ${r.issues.map((i) => i.code)}`);
  assert.deepEqual(await rows(), [], `${id} : rien au registre`);
  assert.ok(!fs.existsSync(path.join(SKINS, id)), `${id} : aucun fichier installé`);
  assert.deepEqual(fs.readdirSync(SKINS).filter((n) => n.startsWith(".")), [], "aucun dossier temporaire");
  const log = (await audits()).filter((a) => a.startsWith("skin.refused"));
  assert.equal(log.length, 1);
  assert.match(log[0], new RegExp(`^skin\\.refused (${id}|\\?) `), "l'identifiant s'il est connu, jamais un extrait du skin");
  await db.prisma.auditLog.deleteMany();
  return r;
}

test("refus : skin illisible (sous le seuil AA) avec le message simple FR/EN, sans rien installer", async () => {
  const r = await refused("faded-grey", { from: "faded-grey" }, "skins.error.unreadable", "read-low-1");
  assert.match(r.issues.find((i) => i.code === "read-low-1").message.fr, /En mode clair, le texte serait difficile à lire sur le fond de la page \(rapport 1,6 ; il faut au moins 4,5\)/);
  assert.match(r.issues.find((i) => i.code === "read-low-1").message.en, /In light mode, the text would be hard to read/);
});

test("refus : skin hostile — et l'audit ne contient AUCUN extrait du skin", async () => {
  await refused("hostile-sheet", { from: "hostile-sheet" }, "skins.error.invalid", "import-forbidden");
  const all = JSON.stringify(await db.prisma.auditLog.findMany());
  assert.ok(!/evil|example\.org|Offre|expression/i.test(all));
});

test("refus : ressources trop grosses, mauvaise signature, licence absente, lien symbolique, fichier hors liste, SVG dangereux", async () => {
  const lic = { "LICENSES/ofl.txt": "Licence." };
  await refused("police-lourde", { patch: (m) => { m.id = "police-lourde"; m.assets = [asset("fonts/a.woff2", "font")]; }, files: { ...lic, "fonts/a.woff2": fakeFont(160 * 1024) } }, "skins.error.invalid", "file-too-large");
  await refused("deux-mega", { files: { "images/a.png": fakePng(1024), ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`LICENSES/l${i}.txt`, "x".repeat(90 * 1024)])) } }, "skins.error.invalid", "skin-too-big");
  await refused("fausse-police", { patch: (m) => { m.assets = [asset("fonts/a.woff2", "font")]; }, files: { ...lic, "fonts/a.woff2": "<html>pas une police</html>" + "x".repeat(40) } }, "skins.error.invalid", "asset-signature");
  await refused("sans-licence", { patch: (m) => { m.assets = [{ file: "images/a.png", kind: "image" }]; }, files: { "images/a.png": fakePng() } }, "skins.error.invalid", "asset-license-missing");
  await refused("svg-piege", { patch: (m) => { m.assets = [asset("images/m.svg", "image")]; }, files: { ...lic, "images/m.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' } }, "skins.error.invalid", "asset-svg-refused");
  await refused("intrus", { files: { "install.sh": "rm -rf /" } }, "skins.error.invalid", "skin-file-unlisted");
});

test("refus : lien symbolique dans le dépôt (git le garde tel quel) — jamais suivi", async () => {
  await cat.publish("avec-lien", { listed: false, files: { "extra.txt": "x" } });
  const dir = path.join(cat.dir, "skins", "avec-lien");
  fs.rmSync(path.join(dir, "extra.txt"));
  fs.symlinkSync("/etc/passwd", path.join(dir, "images-secretes"));
  cat.repo.g("add", "-A"); cat.repo.g("commit", "-qm", "lien"); cat.repo.g("tag", "-f", "avec-lien-v1.0.0");
  const r = await S.install(personal("avec-lien"), { confirmPersonal: true });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "skin-symlink"));
  assert.deepEqual(await rows(), []);
  // Dossier du skin lui-même qui pointe hors du dépôt.
  const outside = makeTempDir("dehors-", { in: path.dirname(cat.dir) });
  copySkin("plain-light", path.join(outside, "x"), { id: "evasion" });
  fs.symlinkSync(path.join(outside, "x"), path.join(cat.dir, "skins", "evasion"));
  cat.repo.g("add", "-A"); cat.repo.g("commit", "-qm", "evasion"); cat.repo.g("tag", "-f", "evasion-v1");
  assert.equal((await S.install(`${cat.url}#evasion-v1:skins/evasion`, { confirmPersonal: true })).ok, false);
  assert.deepEqual(await rows(), []);
});

test("refus : id du manifeste différent du dossier, du catalogue, ou réservé ; cœur et contrat trop récents", async () => {
  await cat.publish("mal-range", { listed: false, folder: "autre-dossier" });
  const folder = await S.install(`${cat.url}#mal-range-v1.0.0:skins/autre-dossier`, { confirmPersonal: true });
  assert.ok(!folder.ok && folder.issues.some((i) => i.code === "manifest-id-folder"), "l'id doit être le nom du dossier");
  await db.prisma.auditLog.deleteMany();
  await cat.publish("annonce", { listed: false }); await cat.publish("vrai-nom", { listed: false, folder: "annonce", tag: "annonce-v2" });
  // Un dépôt reconnu ne peut pas servir un autre skin que celui annoncé.
  await cat.setIndex({ id: "annonce", name: "x", repo: SKINS_HTTPS, subdir: "skins/annonce", ref: "annonce-v2" });
  const mismatch = await S.installFromCatalogue("annonce");
  assert.deepEqual([mismatch.ok, mismatch.error], [false, "skins.error.idmismatch"]);
  await db.prisma.auditLog.deleteMany();
  await refused("trop-neuf", { patch: (m) => { m.minCore = "9.0.0"; } }, "skins.error.core", "manifest-core-newer");
  await refused("contrat-futur", { patch: (m) => { m.skinContract = 2; } }, "skins.error.contract", "manifest-contract-newer");
  assert.equal((await S.install(personal("trop-neuf"), { confirmPersonal: true })).needsCore, "9.0.0");
});

test("installation simultanée du même skin : une seule réussit, l'autre dit « déjà installé »", async () => {
  await cat.publish("plain-light");
  const [a, b] = await Promise.all([S.installFromCatalogue("plain-light"), S.installFromCatalogue("plain-light")]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal([a, b].find((x) => !x.ok).error, "skins.error.exists");
  assert.equal((await rows()).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Mise à jour

async function installed100() {
  await cat.publish("plain-light");
  const r = await S.installFromCatalogue("plain-light");
  assert.equal(r.ok, true);
}

test("mise à jour : la nouvelle version est posée à côté, l'ancienne est gardée (revenir en arrière), audit", async () => {
  await installed100();
  await setSetting("skin.active", "plain-light");
  assert.equal((await S.checkUpdate("plain-light")).available, false);
  await cat.publish("plain-light", { version: "1.0.1", patch: (m) => { m.description.fr = "Nouvelle description."; } });
  const check = await S.checkUpdate("plain-light");
  assert.deepEqual({ available: check.available, target: check.target, level: check.level }, { available: true, target: "1.0.1", level: "patch" });
  assert.equal((await S.listCatalogue()).items[0].updateAvailable, true);
  const r = await S.update("plain-light", { actor: "owner@test" });
  assert.deepEqual({ ok: r.ok, version: r.version, from: r.from, level: r.level }, { ok: true, version: "1.0.1", from: "1.0.0", level: "patch" });
  const [row] = await rows();
  assert.equal(row.version, "1.0.1");
  assert.equal(row.ref, "plain-light-v1.0.1");
  assert.equal(row.previous.version, "1.0.0");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")).sort(), ["1.0.0", "1.0.1"]);
  assert.equal((await S.installed())[0].previous.version, "1.0.0");
  assert.equal(await getSetting("skin.active"), "plain-light", "le skin reste actif");
  assert.deepEqual(await audits(), ["skin.install plain-light@1.0.0", "skin.update plain-light@1.0.1"]);
  assert.equal((await S.update("plain-light")).error, "skins.error.uptodate");
  // « Revenir à la version d'avant »
  const back = await S.revert("plain-light");
  assert.deepEqual([back.ok, back.version], [true, "1.0.0"]);
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")), ["1.0.0"]);
  const [after] = await rows();
  assert.equal(after.version, "1.0.0");
  assert.equal(after.previous, undefined);
  assert.equal((await S.revert("plain-light")).error, "skins.error.noprevious");
});

test("mise à jour : une version MAJEURE est signalée et n'est faite qu'avec accord ; rien ne change sans lui", async () => {
  await installed100();
  await cat.publish("plain-light", { version: "2.0.0" });
  const check = await S.checkUpdate("plain-light");
  assert.equal(check.level, "major");
  const r = await S.update("plain-light");
  assert.deepEqual([r.ok, r.error, r.level, r.target, r.kept], [false, "skins.error.majorConfirm", "major", "2.0.0", "1.0.0"]);
  assert.equal((await rows())[0].version, "1.0.0");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")), ["1.0.0"]);
  const ok = await S.update("plain-light", { acceptMajor: true });
  assert.deepEqual([ok.ok, ok.version, ok.level], [true, "2.0.0", "major"]);
});

test("mise à jour refusée (nouvelle version illisible, hostile, cœur trop récent, même numéro) : l'ancienne version reste en place, active", async () => {
  await installed100();
  await setSetting("skin.active", "plain-light");
  const before = (await rows())[0];
  const keep = async (expectedError) => {
    const r = await S.update("plain-light");
    assert.deepEqual([r.ok, r.error, r.kept], [false, expectedError, "1.0.0"]);
    assert.deepEqual((await rows())[0], before, "registre inchangé");
    assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")), ["1.0.0"], "aucun dossier de la nouvelle version, aucun reste");
    assert.equal(await S.activeSkinId(), "plain-light");
    assert.equal((await S.installed())[0].status, "ok");
  };
  await cat.publish("plain-light", { version: "1.1.0", from: "faded-grey", patch: (m) => { m.id = "plain-light"; } });
  await keep("skins.error.unreadable");
  await cat.publish("plain-light", { version: "1.1.1", from: "hostile-sheet", patch: (m) => { m.id = "plain-light"; } });
  await keep("skins.error.invalid");
  await cat.publish("plain-light", { version: "1.1.2", patch: (m) => { m.minCore = "9.0.0"; } });
  await keep("skins.error.core");
  await cat.publish("plain-light", { version: "1.0.0", files: { "skin.css": '[data-skin-part="card"] { border-width: 2px; }\n' } });
  await keep("skins.error.sameVersion");
  const log = await audits();
  assert.equal(log.filter((l) => l.startsWith("skin.refused")).length, 2, "deux refus notés, sans contenu (le cœur trop ancien est vu dans l'index, avant de télécharger)");
  assert.ok(!log.some((l) => l.startsWith("skin.update")));
});

test("mise à jour : panne au dernier moment (après la pose des fichiers) → retour arrière complet, jamais à moitié", async () => {
  await installed100();
  await cat.publish("plain-light", { version: "1.0.1" });
  const before = (await rows())[0];
  S.setServiceHooksForTests({ beforeSwitch: () => { throw new Error("panne simulée"); } });
  const r = await S.update("plain-light");
  assert.deepEqual([r.ok, r.error, r.kept], [false, "skins.error.failed", "1.0.0"]);
  assert.deepEqual((await rows())[0], before);
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")), ["1.0.0"], "la version posée à côté a été retirée");
  S.setServiceHooksForTests({});
  assert.equal((await S.update("plain-light")).ok, true, "et la mise à jour réussit une fois la panne passée");
  // Même garantie à l'installation.
  await cat.publish("autre", { version: "1.0.0" });
  S.setServiceHooksForTests({ beforeSwitch: () => { throw new Error("panne simulée"); } });
  assert.equal((await S.installFromCatalogue("autre")).ok, false);
  assert.deepEqual((await rows()).map((x) => x.id), ["plain-light"]);
  assert.ok(!fs.existsSync(path.join(SKINS, "autre")) || fs.readdirSync(path.join(SKINS, "autre")).length === 0);
});

test("mise à jour : on ne garde qu'UNE version d'avant (la précédente de la précédente part)", async () => {
  await installed100();
  await cat.publish("plain-light", { version: "1.0.1" });
  await S.update("plain-light");
  await cat.publish("plain-light", { version: "1.0.2" });
  await S.update("plain-light");
  assert.deepEqual(fs.readdirSync(path.join(SKINS, "plain-light")).sort(), ["1.0.1", "1.0.2"]);
  assert.equal((await rows())[0].previous.version, "1.0.1");
});

test("dépôt personnel suivi par étiquette vX.Y.Z : la plus haute étiquette stable ; commit épinglé : jamais de mise à jour", async () => {
  const dir = path.join(db.dir, "src-skin");
  copySkin("plain-light", dir, { id: "perso", version: "1.0.0" });
  const files = Object.fromEntries(["skin.json", "tokens.json", "skin.css"].map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
  files["previews/home.webp"] = fs.readFileSync(path.join(dir, "previews/home.webp")).toString("latin1");
  const repo = makeRepo({ "skin.json": files["skin.json"], "tokens.json": files["tokens.json"], "skin.css": files["skin.css"] });
  // la fixture a un aperçu déclaré : on le pose en binaire
  fs.mkdirSync(path.join(repo.dir, "previews")); fs.copyFileSync(path.join(dir, "previews/home.webp"), path.join(repo.dir, "previews/home.webp"));
  repo.g("add", "-A"); repo.g("commit", "-qm", "aperçu"); repo.g("tag", "v1.0.0");
  const r = await S.install(`${repo.url}#v1.0.0`, { confirmPersonal: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await rows())[0].subdir, null, "skin à la racine du dépôt");
  assert.equal((await S.checkUpdate("perso")).available, false);
  const m = JSON.parse(files["skin.json"]); m.version = "1.2.0";
  fs.writeFileSync(path.join(repo.dir, "skin.json"), JSON.stringify(m)); repo.g("add", "-A"); repo.g("commit", "-qm", "1.2.0"); repo.g("tag", "v1.2.0");
  fs.writeFileSync(path.join(repo.dir, "skin.json"), JSON.stringify({ ...m, version: "1.3.0-rc" })); repo.g("add", "-A"); repo.g("commit", "-qm", "rc"); repo.g("tag", "v1.3.0-rc.1");
  const check = await S.checkUpdate("perso");
  assert.deepEqual({ available: check.available, target: check.target, level: check.level }, { available: true, target: "v1.2.0", level: "minor" }, "étiquette stable la plus haute, pas la pré-version");
  const up = await S.update("perso");
  assert.deepEqual([up.ok, up.version], [true, "1.2.0"]);
  assert.equal((await rows())[0].ref, "v1.2.0");
  // Épinglé sur un commit.
  await S.remove("perso");
  assert.equal((await S.install(`${repo.url}#${repo.g("rev-parse", "v1.0.0").toString().trim()}`, { confirmPersonal: true })).ok, true);
  assert.equal((await S.checkUpdate("perso")).available, false);
  const pinned = await S.update("perso");
  assert.deepEqual([pinned.ok, pinned.error], [false, "skins.error.pinned"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Retrait, repli sur basic

test("retrait : fichiers et ligne retirés ; le skin actif retombe sur basic, les retouches de la personne restent, les options du skin partent", async () => {
  await installed100();
  await cat.publish("autre-skin");
  await S.installFromCatalogue("autre-skin");
  await setSetting("skin.active", "plain-light");
  await setSetting("skin.options", { density: "airy" });
  await setSetting("theme.accent", "#ff00aa");
  await setSetting("header.layout", "centered");
  assert.equal(await S.activeSkinId(), "plain-light");
  // Retirer un skin qui n'est pas actif ne change rien à l'actif.
  assert.deepEqual(await S.remove("autre-skin", { actor: "owner@test" }), { ok: true, id: "autre-skin", wasActive: false });
  assert.equal(await getSetting("skin.active"), "plain-light");
  assert.ok(!fs.existsSync(path.join(SKINS, "autre-skin")));
  const r = await S.remove("plain-light", { actor: "owner@test" });
  assert.deepEqual(r, { ok: true, id: "plain-light", wasActive: true });
  assert.ok(!fs.existsSync(path.join(SKINS, "plain-light")));
  assert.deepEqual(await rows(), []);
  assert.equal(await getSetting("skin.active"), "basic");
  assert.equal(await getSetting("skin.options"), undefined);
  assert.equal(await getSetting("theme.accent"), "#ff00aa", "retouches intactes");
  assert.equal(await getSetting("header.layout"), "centered");
  assert.equal(await S.activeSkinId(), "basic");
  assert.deepEqual(await audits(), ["skin.install plain-light@1.0.0", "skin.install autre-skin@1.0.0", "skin.remove autre-skin", "skin.remove plain-light"]);
  assert.equal((await S.remove("plain-light")).error, "skins.error.notfound");
});

test("un skin dont les fichiers disparaissent : basic s'applique, l'état dit « missing » ; modifié ou abîmé : détecté", async () => {
  await installed100();
  await setSetting("skin.active", "plain-light");
  const dir = path.join(SKINS, "plain-light", "1.0.0");
  // fichier modifié après l'installation
  fs.appendFileSync(path.join(dir, "skin.css"), "/* trafiqué */\n");
  let [s] = await S.installed();
  assert.equal(s.status, "modified");
  assert.equal(s.problems[0].code, "skin-modified");
  assert.deepEqual((await S.loadInstalledSkin("plain-light")).ok, false, "un skin altéré n'est pas appliqué");
  // fichier ajouté en douce
  fs.writeFileSync(path.join(dir, "porte-derobee.js"), "alert(1)");
  [s] = await S.installed();
  assert.equal(s.status, "invalid");
  // fichiers disparus
  fs.rmSync(path.join(SKINS, "plain-light"), { recursive: true });
  [s] = await S.installed();
  assert.equal(s.status, "missing");
  assert.equal(s.problems[0].code, "skin-files-missing");
  assert.equal(await S.activeSkinId(), "basic", "repli sur basic, skin.active gardé tel quel");
  assert.equal(await getSetting("skin.active"), "plain-light");
  // réinstallation depuis le dépôt noté : il se réactive tout seul
  const back = await S.reinstall("plain-light");
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(await S.activeSkinId(), "plain-light");
  assert.equal((await S.installed())[0].status, "ok");
});

test("loadInstalledSkin : feuille et jetons ASSAINIS de nouveau, mis en cache", async () => {
  await installed100();
  const l = await S.loadInstalledSkin("plain-light");
  assert.equal(l.ok, true);
  assert.equal(l.assetBase, "/skins/plain-light/1.0.0/");
  assert.match(l.css, /:root\[data-skin="plain-light"\]/);
  assert.equal(l.tokens.light["--v-fg"], "#1b1b1f");
  assert.equal((await S.loadInstalledSkin("plain-light")), l, "même objet : cache");
  assert.equal((await S.loadInstalledSkin("inconnu")).ok, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue injoignable

test("catalogue injoignable : message simple FR/EN, les skins installés continuent ; la dernière copie reçue sert si elle existe", async () => {
  await installed100();
  await setSetting("skin.active", "plain-light");
  await S.listCatalogue();              // une copie est reçue
  await cat.down();
  let l = await S.listCatalogue();
  assert.equal(l.source, "cache");
  assert.equal(l.unreachable, false);
  assert.deepEqual(l.items.map((i) => i.id), ["plain-light"]);
  await cat.down({ wipe: true });       // plus aucune copie
  l = await S.listCatalogue();
  assert.deepEqual([l.ok, l.items.length, l.unreachable, l.source], [true, 0, true, "none"]);
  assert.match(l.message.fr, /injoignable pour le moment.*skins installés continuent/);
  assert.match(l.message.en, /cannot be reached right now.*installed skins keep working/);
  assert.equal((await S.installFromCatalogue("autre")).error, "skins.error.catalogue");
  assert.equal((await S.update("plain-light")).error, "skins.error.catalogue", "un skin du catalogue ne se met pas à jour dans le vide");
  assert.deepEqual((await S.installed()).map((s) => [s.id, s.status, s.active]), [["plain-light", "ok", true]], "les skins installés continuent");
  assert.equal(await S.activeSkinId(), "plain-light");
  const loaded = await S.loadInstalledSkin("plain-light");
  assert.equal(loaded.ok, true);
  await cat.up();
  assert.equal((await S.listCatalogue()).unreachable, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Aperçu sans installer

test("inspect : README, licences, aperçus et résumé du contrôle SANS rien installer ; README débarrassé de HTML et d'images distantes", async () => {
  const lic = { "LICENSES/ofl.txt": "Texte de la licence OFL." };
  await cat.publish("riche", {
    listed: false,
    patch: (m) => { m.assets = [asset("fonts/corps.woff2", "font", { family: "Corps" })]; m.options = [{ id: "density", label: { fr: "Densité", en: "Density" }, default: "a", values: [{ id: "a", label: { fr: "A", en: "A" }, tokens: {} }, { id: "b", label: { fr: "B", en: "B" }, tokens: { "--sk-space": "0.3125rem" } }] }]; },
    files: { ...lic, "fonts/corps.woff2": fakeFont(), LICENSE: "MIT License\nCopyright test", "README.md": "# Riche\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n![pixel](https://tracker.example.org/p.png)\n\n[lien](javascript:alert(1)) et [bon](https://example.org)\n" },
  });
  const r = await S.inspect(personal("riche"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.origin, "personal");
  assert.equal(r.installable, true);
  const s = r.summary;
  assert.deepEqual([s.id, s.version, s.license, s.modes], ["riche", "1.0.0", "MIT", ["light"]]);
  assert.deepEqual(s.assets, [{ file: "fonts/corps.woff2", kind: "font", license: "OFL-1.1", author: "Fonderie de test", source: "https://example.org/font", family: "Corps" }]);
  assert.equal(s.options[0].id, "density");
  assert.deepEqual(s.permissions, { executesCode: false, loadsFromOtherSites: false, changesContent: false, touchesAdmin: false });
  assert.match(s.licenseText, /^MIT License/);
  assert.ok(s.sizeBytes > 0 && s.files >= 6);
  assert.equal(s.previews.length, 1);
  assert.match(s.previews[0].dataUrl, /^data:image\/webp;base64,/, "aperçu local, jamais une adresse distante");
  assert.ok(!/<|onerror|tracker\.example|javascript:|http.*\.png/.test(s.readme), s.readme);
  assert.match(s.readme, /pixel/, "la description de l'image reste");
  assert.match(s.readme, /\[bon\]\(https:\/\/example\.org\)/, "un lien normal reste");
  // RIEN n'est installé ni écrit.
  assert.deepEqual(await rows(), []);
  assert.deepEqual(fs.readdirSync(SKINS), []);
  assert.deepEqual(await audits(), []);
});

test("inspect : un skin refusé est décrit avec ses problèmes (installable: false) ; un dépôt de plusieurs skins liste ses candidats ; un skin déjà installé est signalé", async () => {
  await cat.publish("faded-grey", { listed: false, from: "faded-grey" });
  const bad = await S.inspect(personal("faded-grey"));
  assert.equal(bad.ok, true);
  assert.equal(bad.installable, false);
  assert.ok(bad.issues.some((i) => i.code === "read-low-1"));
  assert.ok(bad.readability.length > 0);
  await cat.publish("plain-light");
  const multi = await S.inspect(`${cat.url}`);
  assert.equal(multi.ok, true);
  assert.deepEqual(multi.candidates.map((c) => c.subdir).sort(), ["skins/faded-grey", "skins/plain-light"]);
  await S.installFromCatalogue("plain-light");
  const again = await S.inspect(`${SKINS_HTTPS}#plain-light-v1.0.0:skins/plain-light`);
  assert.equal(again.origin, "official");
  assert.deepEqual(again.alreadyInstalled, { version: "1.0.0" });
  assert.equal((await S.inspect("https://evil.example.org/o/r")).error, "skins.error.host");
  assert.equal((await S.inspect(`${cat.url}#absent`)).error, "skins.error.clone");
});

test("l'aperçu de skins.json du dépôt par défaut : une seule constante nommée pour l'adresse officielle", async () => {
  const cfg = await import("@/core/config");
  assert.equal(cfg.DEFAULT_SKINS_REPO, "https://github.com/helldog136/curiosa-skins");
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|mjs)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("helldog136/curiosa-skins")) hits.push(path.relative(process.cwd(), p)); } };
  walk(path.resolve(import.meta.dirname, "../../src"));
  assert.deepEqual(hits, ["src/core/config.ts"]);
  const c = await import("@/core/skins/catalogue");
  const saved = process.env.CURIOSA_SKINS_REPO;
  delete process.env.CURIOSA_SKINS_REPO;
  try { assert.equal(c.resolveSkinsRepo(), cfg.DEFAULT_SKINS_REPO); } finally { process.env.CURIOSA_SKINS_REPO = saved; }
});
