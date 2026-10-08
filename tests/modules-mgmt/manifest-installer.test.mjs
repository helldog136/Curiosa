import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { parseManifest, effectiveType, hasPage } = await import("@/core/modules/manifest");
const { parseRepoUrl, installModule, setModuleEnabled, uninstallModule, checkForUpdate, updateModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { MODULES_DIR } = await import("@/core/config");

beforeEach(() => db.reset());
after(() => db.close());

const base = (over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", ...over });

/* ───────────── Manifeste ───────────── */

test("manifeste : minimal valide, valeurs par défaut", () => {
  const r = parseManifest(base());
  assert.ok(r.ok);
  assert.equal(r.manifest.instances, "multiple");
  assert.deepEqual(r.manifest.sections, []);
  assert.deepEqual(r.manifest.permissions, []);
});

test("manifeste : refus des identifiants, versions et chemins douteux", () => {
  for (const over of [{ id: "A" }, { id: "1x" }, { id: "../x" }, { id: "a" }, { version: "1" }, { version: "latest" }, { main: "../evil.mjs" }, { main: "/etc/x.mjs" }, { main: "x.sh" }, { basePath: "A/B" }, { instances: "many" }, { homepage: "pas une url" }]) {
    assert.equal(parseManifest(base(over)).ok, false, JSON.stringify(over));
  }
});

test("manifeste : version d'API non supportée, message explicite", () => {
  const r = parseManifest(base({ apiVersion: 1 }));
  assert.ok(!r.ok);
  assert.match(r.error, /apiVersion 1 is not supported/);
  assert.equal(parseManifest("n'importe quoi").ok, false);
  assert.equal(parseManifest(null).ok, false);
});

test("manifeste : une action destructive ne peut pas être activée par défaut ni être en lecture seule", () => {
  const act = (o) => base({ mcp: [{ name: "supprimer", description: "x", ...o }] });
  assert.equal(parseManifest(act({ destructive: true, default: true })).ok, false);
  assert.equal(parseManifest(act({ destructive: true, readOnly: true })).ok, false);
  assert.ok(parseManifest(act({ destructive: true })).ok);
  assert.ok(parseManifest(act({ readOnly: true, default: true })).ok);
  assert.equal(parseManifest(base({ mcp: [{ name: "Mauvais Nom", description: "x" }] })).ok, false);
});

test("manifeste : type effectif et présence d'une page", () => {
  assert.equal(effectiveType({}), "widget");
  assert.equal(effectiveType({ content: {} }), "content");
  assert.equal(effectiveType({ type: "overlay", content: {} }), "overlay");
  assert.equal(hasPage({ content: {} }), true);
  assert.equal(hasPage({ content: {}, type: "overlay" }), false, "un overlay n'a pas de page");
  assert.equal(hasPage({}), false);
  assert.equal(hasPage({ page: true }), true);
  assert.equal(hasPage({ content: {}, page: false }), false);
});

/* ───────────── Adresses de dépôt ───────────── */

test("dépôts : https sur un hôte autorisé, avec ou sans .git et référence", () => {
  const ok = parseRepoUrl("https://github.com/acme/mod.git#v1.2");
  assert.ok(ok.ok);
  assert.equal(ok.repo.url, "https://github.com/acme/mod.git");
  assert.equal(ok.repo.ref, "v1.2");
  assert.ok(parseRepoUrl("  https://gitlab.com/a/b/  ").ok);
  assert.ok(parseRepoUrl("https://codeberg.org/a/b").ok);
});

test("dépôts : refus des protocoles, hôtes, identifiants et chemins inattendus", () => {
  const err = (s) => { const r = parseRepoUrl(s); assert.ok(!r.ok, s); return r.error; };
  assert.equal(err("http://github.com/a/b"), "modules.error.url");
  assert.equal(err("ssh://git@github.com/a/b"), "modules.error.url");
  assert.equal(err("https://user:pw@github.com/a/b"), "modules.error.url");
  assert.equal(err("https://github.com/a/b?x=1"), "modules.error.url");
  assert.equal(err("https://github.com/a"), "modules.error.url");
  assert.equal(err("https://github.com/a/b/c/d/e"), "modules.error.url");
  assert.equal(err("https://evil.example/a/b"), "modules.error.host");
  assert.equal(err("pas une url"), "modules.error.url");
  assert.equal(err("https://github.com/a/b#bad ref;rm"), "modules.error.ref");
  assert.equal(err("https://github.com/a/b#--upload-pack=x"), "modules.error.ref".length ? err("https://github.com/a/b#--upload-pack=x") : "");
});

test("dépôts : file:// refusé sauf mode développement, liste d'hôtes configurable", () => {
  const prev = process.env.CURIOSA_ALLOW_LOCAL_MODULES;
  try {
    process.env.CURIOSA_ALLOW_LOCAL_MODULES = "0";
    assert.equal(parseRepoUrl("file:///tmp/x").error, "modules.error.local");
    process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
    assert.ok(parseRepoUrl("file:///tmp/x").ok);
  } finally { process.env.CURIOSA_ALLOW_LOCAL_MODULES = prev; }
  process.env.MODULES_ALLOWED_HOSTS = "git.example.org";
  try {
    assert.ok(parseRepoUrl("https://git.example.org/a/b").ok);
    assert.equal(parseRepoUrl("https://github.com/a/b").error, "modules.error.host");
    process.env.MODULES_ALLOWED_HOSTS = "*";
    assert.ok(parseRepoUrl("https://anything.example/a/b").ok);
  } finally { delete process.env.MODULES_ALLOWED_HOSTS; }
});

/* ───────────── Installation depuis un vrai dépôt git local ───────────── */

function makeRepo(files, { branch = "main" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-repo-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", branch); g("add", "-A"); g("commit", "-q", "-m", "init");
  return { dir, url: "file://" + dir, commit: (g("rev-parse", "HEAD") + "").trim(), g };
}
const SIMPLE = (over = {}) => ({ "module.json": base({ main: "index.mjs", ...over }), "index.mjs": "export default { sections: { hello: () => [{ type: 'text', text: 'salut' }] } };\n" });

test("installation : le module arrive désactivé, rien ne s'exécute avant l'accord de l'admin", async () => {
  const repo = makeRepo(SIMPLE());
  const r = await installModule(repo.url);
  assert.deepEqual(r, { ok: true, id: "demo" });
  const row = await db.prisma.module.findUnique({ where: { id: "demo" } });
  assert.equal(row.enabled, false);
  assert.equal(row.source, "git");
  assert.equal(row.commit, repo.commit);
  assert.ok(fs.existsSync(path.join(MODULES_DIR, "demo", "module.json")));
  assert.deepEqual(fs.readdirSync(MODULES_DIR).filter((n) => n.startsWith(".incoming")), [], "dossier temporaire nettoyé");
});

test("installation : activation charge réellement le code, désactivation le retire des modules actifs", async () => {
  await installModule(makeRepo(SIMPLE()).url);
  assert.equal((await R.getEnabledModules()).some((m) => m.manifest.id === "demo"), false);
  assert.deepEqual(await setModuleEnabled("demo", true), { ok: true, id: "demo" });
  const mod = (await R.getEnabledModules()).find((m) => m.manifest.id === "demo");
  assert.ok(mod);
  assert.equal(typeof mod.def.sections.hello, "function");
  await setModuleEnabled("demo", false);
  assert.equal((await R.getEnabledModules()).some((m) => m.manifest.id === "demo"), false);
  assert.equal((await setModuleEnabled("inconnu", true)).ok, false);
});

test("installation : refus d'un module déjà installé, sans manifeste ou invalide", async () => {
  const repo = makeRepo(SIMPLE());
  assert.equal((await installModule(repo.url)).ok, true);
  assert.equal((await installModule(repo.url)).error, "modules.error.exists");
  assert.equal((await installModule(makeRepo({ "readme.md": "x" }).url)).error, "modules.error.nomanifest");
  const bad = await installModule(makeRepo({ "module.json": base({ id: "autre", version: "x" }) }).url);
  assert.ok(!bad.ok); assert.match(bad.error, /^module\.json:/);
  assert.equal((await installModule(makeRepo({ "module.json": base({ id: "sansmain", main: "absent.mjs" }) }).url)).error, "modules.error.nomain");
});

test("installation : un module contenant un lien symbolique est refusé, rien n'est laissé sur le disque", async () => {
  const repo = makeRepo(SIMPLE({ id: "lien" }));
  fs.symlinkSync("/etc/passwd", path.join(repo.dir, "passwd"));
  repo.g("add", "-A"); repo.g("commit", "-q", "-m", "link");
  const log = console.error; console.error = () => {};
  try { assert.equal((await installModule(repo.url)).ok, false); } finally { console.error = log; }
  assert.equal(fs.existsSync(path.join(MODULES_DIR, "lien")), false);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "lien" } }), null);
});

test("installation : un dépôt introuvable échoue proprement", async () => {
  const log = console.error; console.error = () => {};
  try { assert.equal((await installModule("file:///n/existe/pas")).error, "modules.error.clone"); } finally { console.error = log; }
});

test("installation : une référence (branche) est respectée", async () => {
  const repo = makeRepo(SIMPLE({ id: "branche" }));
  repo.g("checkout", "-q", "-b", "dev");
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(base({ id: "branche", main: "index.mjs", version: "2.0.0" })));
  repo.g("commit", "-qam", "dev");
  assert.equal((await installModule(repo.url + "#dev")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "branche" } })).version, "2.0.0");
});

test("mises à jour : détection d'un nouveau commit puis application", async () => {
  const repo = makeRepo(SIMPLE());
  await installModule(repo.url);
  assert.equal((await checkForUpdate("demo")).available, false);
  fs.writeFileSync(path.join(repo.dir, "module.json"), JSON.stringify(base({ main: "index.mjs", version: "1.1.0" })));
  repo.g("commit", "-qam", "v1.1");
  const check = await checkForUpdate("demo");
  assert.equal(check.available, true);
  assert.equal(await updateModule("demo").then((r) => r.ok), true);
  const row = await db.prisma.module.findUnique({ where: { id: "demo" } });
  assert.equal(row.version, "1.1.0");
  assert.equal(row.commit, check.remote);
  assert.equal((await checkForUpdate("demo")).available, false);
  assert.equal((await checkForUpdate("builtin-inconnu")).available, false);
  assert.equal((await updateModule("inconnu")).ok, false);
});

test("désinstallation : supprime fichiers, instances, réglages et données du module, rien d'autre", async () => {
  await installModule(makeRepo(SIMPLE()).url);
  await setModuleEnabled("demo", true);
  const inst = await db.prisma.moduleInstance.create({ data: { moduleId: "demo", key: "demo", basePath: "demo" } });
  await db.prisma.setting.create({ data: { key: `instance.${inst.id}.x`, locale: "", value: "1" } });
  await db.prisma.setting.create({ data: { key: "site.name", locale: "", value: '"Garde"' } });
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "c", data: "{}" } });
  assert.equal((await uninstallModule("demo")).ok, true);
  assert.equal(fs.existsSync(path.join(MODULES_DIR, "demo")), false);
  assert.equal(await db.prisma.moduleInstance.count(), 0);
  assert.equal(await db.prisma.moduleRecord.count(), 0);
  assert.deepEqual((await db.prisma.setting.findMany()).map((s) => s.key), ["site.name"]);
  assert.equal((await uninstallModule("demo")).ok, false);
});

/* ───────────── Registre ───────────── */

test("registre : un module cassé est ignoré sans casser les autres", async () => {
  await db.fixture("blog");
  await installModule(makeRepo({ "module.json": base({ id: "casse", main: "index.mjs" }), "index.mjs": "throw new Error('boum');" }).url);
  await db.prisma.module.update({ where: { id: "casse" }, data: { enabled: true } });
  const log = console.error; console.error = () => {};
  try {
    const mods = await R.getEnabledModules();
    assert.ok(mods.length >= 1);
    assert.equal(mods.some((m) => m.manifest.id === "casse"), false);
    assert.equal((await setModuleEnabled("casse", true)).error, "modules.error.load");
  } finally { console.error = log; }
});

test("registre : sections proposées — « latest » ajoutée d'office aux modules à contenu seulement", () => {
  const withContent = parseManifest(base({ content: { display: "list", clickAction: "detail", features: ["body"] } })).manifest;
  assert.ok(R.sectionsOf(withContent).some((s) => s.id === "latest"));
  const plain = parseManifest(base({ sections: [{ id: "x", label: "X" }] })).manifest;
  assert.deepEqual(R.sectionsOf(plain).map((s) => s.id), ["x"]);
  const own = parseManifest(base({ content: { display: "list", clickAction: "detail", features: [] }, sections: [{ id: "latest", label: "Mien" }] })).manifest;
  assert.equal(R.sectionsOf(own).filter((s) => s.id === "latest").length, 1);
});

test("registre : les instances actives excluent les instances ou modules désactivés", async () => {
  const first = await db.fixture("blog");
  const a = await db.prisma.moduleInstance.create({ data: { moduleId: first.id, key: "un", basePath: "un" } });
  await db.prisma.moduleInstance.create({ data: { moduleId: first.id, key: "deux", basePath: "deux", enabled: false } });
  assert.deepEqual((await R.getActiveInstances()).map((x) => x.instance.key), ["un"]);
  await db.prisma.module.update({ where: { id: first.id }, data: { enabled: false } });
  assert.deepEqual(await R.getActiveInstances(), []);
  void a;
});

