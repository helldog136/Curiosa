import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { useTestDb as openTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

const run = promisify(execFile);
const db = await openTestDb();
// Le cœur n'embarque aucun module : « liens » et les réseaux viennent d'un faux dépôt curiosa-extras local, hérité par le processus enfant (environnement).
const cat = createCatalogue();
await cat.fixtures(["links"]);
const SOCIAL = { instagram: "profile", "twitch-channel": "channel", mastodon: "profile", tiktok: "profile", kofi: "profile", "youtube-channel": "channelId", bluesky: "profile", discord: "profile" };
for (const [id, setting] of Object.entries(SOCIAL)) {
  await cat.add(id, { manifest: { type: "social", platform: id, instances: "multiple", page: false, version: "1.0.0", provides: [{ topic: "social.link", label: { en: id, fr: id } }], permissions: [], settings: [{ key: setting, type: "text", label: { en: setting, fr: setting } }] } });
}
const Rs = await import("@/core/backup/restore");
const { UPLOADS_DIR } = await import("@/core/config");
after(() => { cat.close(); return db.close(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("avatar-de-test-fictif")]);
const PW = "mdp-de-test-ok";
const FIX = path.resolve("tests/fixtures/links");

/** Lance le script (processus enfant, base temporaire à lui) sur une fixture dont l'avatar est servi par un serveur local. */
async function importFixture(name, url, extra = []) {
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "image/png"); res.end(PNG); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-links-test-"));
  try {
    const page = path.join(dir, `${name}.html`);
    fs.writeFileSync(page, fs.readFileSync(path.join(FIX, `${name}.html`), "utf8").replace(/https:\/\/images\.example\.org\/(avatar-demo|mael|noa|pia)[\w-]*\.(png|jpg)/g, `http://127.0.0.1:${srv.address().port}/avatar.png`));
    const out = path.join(dir, "import.tar.gz.enc");
    const { stdout } = await run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-links.mjs", page, "--url", url, "--out", out, "--password", PW, "--owner-email", "lune@example.org", "--owner-name", "Lune Démo", "--json", ...extra], { encoding: "utf8", env: { ...process.env, DATA_DIR: "", DATABASE_URL: "", CURIOSA_ALLOW_LOCAL_IMPORT: "1" } });
    const opened = Rs.openBackup(fs.readFileSync(out), PW);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    return { dir, out, json: JSON.parse(stdout), backup: opened.backup, files: Object.fromEntries(["rapport.txt", "rapport.json", "fiche.json"].map((x) => [x, fs.readFileSync(`${out}.${x}`, "utf8")])) };
  } finally { srv.close(); }
}
let shared;
const linktree = () => (shared ??= importFixture("linktree", "https://linktr.ee/lune_demo"));

test("import Linktree : la sauvegarde produite est valide pour le vrai code de restauration, et ne contient que le nécessaire", async () => {
  const { backup, json } = await linktree();
  assert.equal(backup.manifest.format, "curiosa-backup");
  assert.deepEqual(backup.data.modules.map((m) => m.id).sort(), ["instagram", "kofi", "links", "mastodon", "tiktok", "twitch-channel"], "les modules du catalogue, rien d'autre (ni blog, ni pages, ni hero)");
  assert.ok(backup.data.modules.every((m) => m.enabled && m.repoUrl && m.ref), "chaque module est réinstallable depuis le catalogue");
  assert.deepEqual(backup.data.users.map((u) => [u.email, u.role]), [["lune@example.org", "owner"]]);
  assert.match(backup.data.users[0].passwordHash, /^\$2[aby]\$/);
  assert.equal(json.secrets.ownerPassword.length >= 15, true);
  assert.equal(json.ok, true); assert.deepEqual(json.backup.modules.map((m) => m.id), ["links", "instagram", "twitch-channel", "mastodon", "tiktok", "kofi"]);
});

test("import Linktree : réglages du site, avatar téléchargé, liens (ordre, rubriques en étiquettes, icônes), un module par réseau avec son réglage", async () => {
  const { backup } = await linktree();
  const { settings, entries, entryTranslations: tr, instances } = backup.data;
  const val = (k, l = "") => { const s = settings.find((x) => x.key === k && x.locale === l); return s ? (typeof s.value === "string" ? (() => { try { return JSON.parse(s.value); } catch { return s.value; } })() : s.value) : undefined; };
  assert.equal(val("site.name", "fr"), "Lune Démo");
  assert.equal(val("site.tagline", "fr"), "Créatrice fictive de contenus de démonstration.");
  assert.match(val("site.about", "fr"), /^Créatrice fictive.*week-end\.$/);
  assert.match(val("site.logo"), /^\/uploads\/[0-9a-f-]{36}\.png$/, "avatar téléchargé, devenu le logo");
  assert.ok(backup.uploads.some((u) => `/uploads/${u.name}` === val("site.logo") && u.content.equals(PNG)));
  assert.deepEqual(val("i18n.enabled"), ["fr"]);
  const links = instances.find((i) => i.moduleId === "links");
  const mine = entries.filter((e) => e.instanceId === links.id).sort((a, b) => a.position - b.position);
  const title = (e) => tr.find((t) => t.entryId === e.id).title;
  assert.deepEqual(mine.map(title), ["Ma chaîne YouTube", "Ma boutique", "Le jeu de la jam", "Le dépôt du jeu", "Contenu réservé", "Mon site", "LinkedIn", "E-mail"]);
  assert.deepEqual(mine.map((e) => JSON.parse(e.tags)), [["Mes chaînes"], ["Boutique et soutien"], ["Projets"], ["Projets"], ["Boutique et soutien"], ["Boutique et soutien"], [], []]);
  assert.equal(mine[0].icon, "youtube"); assert.equal(mine[0].url, "https://www.youtube.com/@demo_fictif");
  assert.ok(mine.every((e) => e.status === "published" && /^(https?:|mailto:)/.test(e.url)));
  assert.equal(entries.length, mine.length, "pas d'autre entrée : ni blog ni page d'exemple");
  const set = (moduleId) => instances.filter((i) => i.moduleId === moduleId).map((i) => val(`instance.${i.id}.${SOCIAL[moduleId]}`));
  assert.deepEqual(set("twitch-channel"), ["demo_fictif"]); assert.deepEqual(set("instagram"), ["demo_fictif"]); assert.deepEqual(set("tiktok"), ["demo_fictif"]); assert.deepEqual(set("kofi"), ["demo_fictif"]);
  assert.deepEqual(set("mastodon"), ["https://social.example.org/@demo_fictif"]);
  assert.equal(instances.length, 6);
  const home = val("home.sections");
  assert.deepEqual(home.map((h) => [h.id, h.instance]), [["links", links.key]]);
});

test("import Linktree : restaurée par le vrai code du cœur (installation des modules depuis le catalogue), le site retrouve ses données", async () => {
  const { backup } = await linktree();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  const plans = await Rs.planModules(backup.data.modules);
  assert.ok(plans.every((p) => p.status === "catalogue" && !p.needsConfirmation), JSON.stringify(plans.map((p) => [p.id, p.status])));
  const report = await Rs.applyRestore(backup, { confirmCustom: [], actor: "lune@example.org" });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.ok(report.modules.every((m) => m.outcome === "installed"), JSON.stringify(report.modules));
  assert.equal(await db.prisma.moduleInstance.count(), 6);
  assert.equal(await db.prisma.entry.count(), 8);
  assert.equal((await db.prisma.user.findFirst()).email, "lune@example.org");
  assert.equal((await db.prisma.module.count()), 6);
  assert.equal(fs.readdirSync(UPLOADS_DIR).length, 1, "l'avatar est restauré");
  const twitch = await db.prisma.moduleInstance.findFirst({ where: { moduleId: "twitch-channel" } });
  assert.equal(JSON.parse((await db.prisma.setting.findUnique({ where: { key_locale: { key: `instance.${twitch.id}.channel`, locale: "" } } })).value), "demo_fictif");
});

test("import Linktree : le rapport (texte, JSON) et la fiche sont écrits à côté, sans aucun mot de passe", async () => {
  const { files, json } = await linktree();
  assert.match(files["rapport.txt"], /Repris : 8 liens en 3 sections/); assert.match(files["rapport.txt"], /2 éléments non repris/); assert.match(files["rapport.txt"], /Avatar : téléchargé et repris/);
  const rj = JSON.parse(files["rapport.json"]);
  assert.equal(rj.counts.links, 8); assert.equal(rj.counts.socials, 5); assert.equal(rj.site.avatarImported, "downloaded"); assert.equal(rj.backup.owner.email, "lune@example.org");
  for (const content of Object.values(files)) { assert.ok(!content.includes(json.secrets.ownerPassword) && !content.includes(json.secrets.backupPassword), "aucun secret dans les fichiers écrits"); }
  assert.equal(JSON.parse(files["fiche.json"]).kind, "curiosa-links-profile");
  assert.ok(rj.toCheck.some((t) => /provisoire/.test(t)));
});

test("import depuis une fiche corrigée à la main : même chemin, même garantie (restaurable), deux comptes d'un même réseau = deux instances", async () => {
  const first = await linktree();
  const fiche = JSON.parse(first.files["fiche.json"]);
  fiche.site.avatar = "https://images.example.org/avatar-demo.png";
  fiche.links.push({ title: "Ajout à la main", url: "https://ajout.example.org/", section: "Mes ajouts", icon: null });
  fiche.socials.push({ platform: "twitch", module: "twitch-channel", setting: "channel", value: "seconde_chaine", label: "Twitch", handle: "seconde_chaine", url: "https://www.twitch.tv/seconde_chaine" });
  const file = path.join(first.dir, "fiche-corrigee.json");
  fs.writeFileSync(file, JSON.stringify(fiche));
  const out = path.join(first.dir, "second.tar.gz.enc");
  await run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-links.mjs", file, "--out", out, "--password", PW, "--owner-email", "lune@example.org", "--no-download"], { encoding: "utf8", env: { ...process.env, DATA_DIR: "", DATABASE_URL: "" } });
  const opened = Rs.openBackup(fs.readFileSync(out), PW);
  assert.equal(opened.ok, true);
  const { instances, entryTranslations: tr } = opened.backup.data;
  assert.equal(instances.filter((i) => i.moduleId === "twitch-channel").length, 2, "une instance par compte");
  assert.ok(tr.some((t) => t.title === "Ajout à la main"));
  assert.ok(fs.readFileSync(`${out}.rapport.txt`, "utf8").includes("Avatar : gardé comme lien"), "--no-download : l'avatar reste un lien, dit dans le rapport");
});

test("import sans catalogue : arrêt net et clair, aucune sauvegarde à moitié produite, aucune copie locale de module", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-links-down-"));
  const out = path.join(dir, "x.enc");
  let failed;
  try { execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-links.mjs", path.join(FIX, "carrd.html"), "--url", "https://pia.carrd.co/", "--out", out, "--password", PW, "--json"], { encoding: "utf8", stdio: "pipe", env: { ...process.env, CURIOSA_CATALOGUE_REPO: "file:///nonexistent/curiosa-extras" } }); } catch (e) { failed = e; }
  assert.ok(failed, "doit échouer");
  assert.match(JSON.parse(failed.stdout).error.message, /le catalogue n'est pas joignable/);
  assert.ok(!fs.existsSync(out));
  let short;
  try { execFileSync(process.execPath, ["scripts/import-links.mjs", path.join(FIX, "carrd.html"), "--out", out, "--password", "court", "--json"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { short = e; }
  assert.equal(JSON.parse(short.stdout).error.code, "password-too-short");
});
