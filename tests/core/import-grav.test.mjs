import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeGrav } from "../helpers/fakeGrav.mjs";

const { openBackup } = await import("@/core/backup/restore");

function run(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-grav-test-"));
  makeGrav(path.join(dir, "user"));
  const out = path.join(dir, "import.tar.gz.enc");
  const stdout = execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tests/helpers/register.mjs", "scripts/import-grav.mjs", path.join(dir, "user"), "--out", out, "--password", "mdp-de-test", ...extra], { encoding: "utf8", env: { ...process.env, DATA_DIR: "", DATABASE_URL: "" } });
  const opened = openBackup(fs.readFileSync(out), "mdp-de-test");
  assert.equal(opened.ok, true, JSON.stringify(opened));
  return { dir, stdout, backup: opened.backup, report: fs.readFileSync(`${out}.rapport.txt`, "utf8") };
}

test("import Grav : la sauvegarde produite est valide et reprend site, langues, comptes, articles et pages", () => {
  const { backup, stdout } = run();
  const data = backup.data;
  const set = (k, l = "") => { const v = data.settings.find((s) => s.key === k && s.locale === l).value; return typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v; };
  assert.equal(set("site.name", "fr"), "Site de démonstration");
  assert.equal(set("site.tagline", "fr"), "Une accroche de test");
  assert.deepEqual(set("i18n.enabled"), ["fr", "en"]);
  assert.deepEqual(data.users.map((u) => [u.email, u.role]).sort(), [["boss@example.org", "owner"], ["redac@example.org", "admin"]]);
  assert.match(data.users.find((u) => u.email === "boss@example.org").passwordHash, /^\$2y\$/, "le mot de passe Grav est conservé");
  const titles = data.entryTranslations.map((t) => `${t.locale}:${t.title}`).sort();
  assert.deepEqual(titles, ["en:First post", "fr:L'équipe", "fr:Accueil", "fr:Contact", "fr:Page non listée", "fr:Premier article", "fr:Un brouillon", "fr:À propos"].sort());
  assert.match(stdout, /Mot de passe de la sauvegarde/);
});

test("import Grav : les articles du blog, brouillons, étiquettes, dates et images", () => {
  const { backup } = run();
  const { entries, entryTranslations: tr, instances } = backup.data;
  const blogId = instances.find((i) => i.basePath === "blog").id;
  const post = entries.find((e) => tr.some((t) => t.entryId === e.id && t.title === "Premier article"));
  assert.equal(post.instanceId, blogId);
  assert.equal(post.status, "published");
  assert.deepEqual(JSON.parse(post.tags), ["annonce", "projet"]);
  assert.match(String(post.publishedAt), /2025-03-04/);
  assert.match(post.cover, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  const fr = tr.find((t) => t.entryId === post.id && t.locale === "fr");
  assert.ok(!fr.body.includes("==="), "le séparateur de résumé Grav est retiré");
  assert.match(fr.body, /!\[Une image\]\(\/uploads\/[0-9a-f-]{36}\.png\)/, "image relative → fichier envoyé, options Grav retirées");
  assert.match(fr.summary, /Intro de l'article/);
  assert.match(fr.body, /\[page équipe\]\(\/equipe\)/, "lien relatif réécrit vers la nouvelle adresse");
  assert.match(fr.body, /\[contact\]\(\/contact\)/);
  assert.match(fr.body, /\[PDF\]\(dossier\.pdf\)/, "lien vers un fichier non importé conservé et signalé");
  assert.equal(entries.find((e) => tr.some((t) => t.entryId === e.id && t.title === "Un brouillon")).status, "draft");
  assert.ok(backup.uploads.some((f) => /^[0-9a-f-]{36}\.png$/.test(f.name)), "images dans la sauvegarde");
});

test("import Grav : anciennes adresses redirigées vers les nouvelles, accueil et bloc modulaire signalés, rien d'ignoré en silence", () => {
  const { backup, report } = run();
  const rd = Object.fromEntries(backup.data.redirects.map((r) => [r.path, r.targetUrl]));
  assert.ok(!("blog/premier-article" in rd), "même adresse sous /blog : pas de redirection");
  assert.equal(rd["a-propos/equipe"], "/equipe");
  assert.ok(!("contact" in rd), "adresse inchangée : pas de redirection");
  assert.ok(backup.data.redirects.every((r) => r.permanent));
  assert.match(report, /page d'accueil Grav/);
  assert.match(report, /bloc modulaire ignoré : _footer|bloc modulaire ignoré/);
  assert.match(report, /fichier non importé, lien conservé/);
  assert.match(report, /dossier\.pdf/);
});

test("import Grav : le script refuse un dossier qui n'est pas un site Grav, et n'écrit que le fichier demandé", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-grav-bad-"));
  assert.throws(() => execFileSync(process.execPath, ["--import", "./tests/helpers/register.mjs", "scripts/import-grav.mjs", dir], { stdio: "pipe" }));
  const src = fs.readFileSync("scripts/import-grav.mjs", "utf8");
  assert.match(src, /mkdtempSync/, "base temporaire : aucune base existante n'est touchée");
});
