import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// PRINCIPE : le cœur est installé SEUL. Aucun module n'est embarqué avec lui (ni archive de release, ni dossier extras/, ni instantané, ni copie hors ligne).
// Le cœur va chercher les modules dans le catalogue (par défaut le dépôt curiosa-extras) ; sans réseau, le catalogue est vide, jamais une copie locale.
const root = process.cwd();
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Cat = await import("@/core/modules/catalogue");
const Rec = await import("@/core/modules/recognized");
const S = await import("@/core/modules/starter");
const X = await import("@/core/modules/reinstall");
const Upd = await import("@/core/modules/updateStatus");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSetting } = await import("@/core/settings");

beforeEach(async () => { process.chdir(root); await db.reset(); await cat.clear(); });
after(() => { process.chdir(root); cat.close(); return db.close(); });

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

/** Un dossier « ancienne installation » : extras/, examples/ et catalogue/ locaux, tels que les anciennes versions du cœur les embarquaient. Le cœur ne doit PAS les lire. */
function decoyExtras() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-decoy-"));
  for (const [kind, id] of [["modules", "leurre"], ["examples", "leurre-exemple"]]) {
    fs.mkdirSync(path.join(dir, "extras", kind, id), { recursive: true });
    fs.writeFileSync(path.join(dir, "extras", kind, id, "module.json"), JSON.stringify({ apiVersion: 2, id, name: id, version: "1.0.0" }));
  }
  fs.mkdirSync(path.join(dir, "extras", "catalogue"), { recursive: true });
  fs.writeFileSync(path.join(dir, "extras", "catalogue", "index.json"), JSON.stringify({ version: 1, modules: [{ id: "leurre", name: "L", description: "", repo: "https://github.com/x/leurre" }] }));
  fs.writeFileSync(path.join(dir, "extras", "catalogue", "suggested.json"), JSON.stringify(["leurre"]));
  fs.mkdirSync(path.join(dir, "catalogue"), { recursive: true });
  fs.copyFileSync(path.join(dir, "extras", "catalogue", "index.json"), path.join(dir, "catalogue", "index.json"));
  return dir;
}

/* ───────────── Archive de release ───────────── */

test("archive : le gabarit de packaging ne contient aucun module, et l'archive réellement fabriquée non plus (extras/, examples/, modules/, catalogue/, SOURCE.json)", () => {
  const pack = read("scripts/release-pack.mjs");
  const paths = JSON.parse(/const PATHS = (\[[\s\S]*?\])\.filter/.exec(pack)[1].replace(/,\s*\]/, "]"));
  for (const bad of ["extras", "examples", "modules", "catalogue"]) assert.ok(!paths.includes(bad), `${bad} ne doit pas être empaqueté`);
  assert.ok(!/extras|fetch-extras|SOURCE\.json/.test(stripComments(pack)), "plus aucune étape qui récupère des modules");
  assert.ok(!fs.existsSync(path.join(root, "scripts/fetch-extras.mjs")), "le script qui récupérait les modules n'existe plus");
  assert.ok(!/fetch-extras|extras:fetch/.test(read(".github/workflows/release.yml") + read("package.json")), "ni la CI ni package.json ne le lancent");

  // Fabrication réelle, dans un arbre factice qui contient un extras/ « piège » : il ne doit jamais atterrir dans l'archive.
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-pack-"));
  const out = path.join(tree, "dist");
  const put = (f, c = "x") => { fs.mkdirSync(path.dirname(path.join(tree, f)), { recursive: true }); fs.writeFileSync(path.join(tree, f), c); };
  put("package.json", JSON.stringify({ name: "curiosa", version: "9.9.9" })); put("package-lock.json", "{}"); put("next.config.mjs"); put("upgrade.json", JSON.stringify({ minFrom: "0.0.0" }));
  put("prisma/schema.prisma"); put("prisma/migrations/a/migration.sql"); put(".env.example"); put("LICENSE"); put("THIRD-PARTY-NOTICES.md");
  put(".next/BUILD_ID"); put("node_modules/next/package.json"); put("scripts/update.mjs");
  for (const e of ["debian-openssl-1.1.x", "debian-openssl-3.0.x"]) put(`node_modules/.prisma/client/libquery_engine-${e}.so.node`);
  put("scripts/install.sh"); put("extras/modules/blog/module.json"); put("extras/catalogue/index.json"); put("extras/SOURCE.json"); put("examples/guestbook/module.json"); put("catalogue/index.json"); put("modules/blog/module.json");
  execFileSync(process.execPath, [path.join(root, "scripts/release-pack.mjs"), "9.9.9", out], { cwd: tree, env: { ...process.env, GITHUB_REPOSITORY: "o/curiosa" }, stdio: "pipe" });
  const archive = fs.readdirSync(out).find((f) => f.endsWith(".tar.gz"));
  const listing = execFileSync("tar", ["-tzf", path.join(out, archive)], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(listing.includes("release.json") && listing.some((f) => f.startsWith(".next/")), "l'archive contient bien le site");
  assert.deepEqual(listing.filter((f) => /^(extras|examples|modules|catalogue)(\/|$)|SOURCE\.json/.test(f)), [], "aucun module, aucune copie du catalogue");
  const manifest = JSON.parse(fs.readFileSync(path.join(tree, "release.json"), "utf8"));
  assert.ok(!manifest.paths.some((p) => /^(extras|examples|modules|catalogue)(\/|$)/.test(p)), "release.json ne déclare aucun module à remplacer");
  fs.rmSync(tree, { recursive: true, force: true });
});

test("test de fumée de l'archive : il vérifie l'ABSENCE de modules, et que l'assistant n'en propose aucun sans catalogue", () => {
  const smoke = read("scripts/smoke-release.mjs");
  for (const gone of ["extras", "examples", "modules", "catalogue"]) assert.ok(smoke.includes(`"${gone}"`), `le test de fumée vérifie l'absence de ${gone}`);
  assert.ok(!/extras\/modules|SOURCE\.json|index du Catalogue présent/.test(smoke), "il n'attend plus de modules dans l'archive");
  assert.match(smoke, /CURIOSA_CATALOGUE_REPO/);
});

/* ───────────── Catalogue : réseau seulement ───────────── */

test("catalogue injoignable : liste vide et message clair — jamais une copie locale (même si extras/, examples/ et catalogue/ locaux existent)", async () => {
  const decoy = decoyExtras();
  process.chdir(decoy);
  process.env.CURIOSA_EXTRAS_DIR = path.join(decoy, "extras");
  try {
    await cat.down({ forget: true });
    assert.deepEqual(await Cat.getCatalogue(), []);
    assert.equal((await Cat.getCatalogueSource()).source, "none");
    assert.equal(await Cat.catalogueUnreachable(), true);
    const offer = await S.setupModules();
    assert.deepEqual([offer.modules.length, offer.unreachable], [0, true], "le leurre local n'est pas suggéré");
    assert.equal(await S.provisionModule("leurre"), false);
    assert.equal(await db.prisma.module.count(), 0);
    assert.equal((await I.installFromCatalogue("leurre")).ok, false);
    const fr = JSON.parse(read("src/locales/fr.json"));
    assert.equal(fr["catalogue.unreachable"], "Le catalogue n'est pas joignable, réessayez.");
    const page = read("src/app/admin/(panel)/extensions/add/page.tsx");
    assert.match(page, /catalogue\.unreachable/);
    assert.match(page, /data-testid="catalogue-unreachable"/);
  } finally { delete process.env.CURIOSA_EXTRAS_DIR; process.chdir(root); fs.rmSync(decoy, { recursive: true, force: true }); }
});

test("catalogue : panne passagère → la dernière copie reçue tient (cache disque) ; elle vient du réseau, jamais du cœur", async () => {
  await cat.add("blog"); await cat.suggest(["blog"]);
  assert.deepEqual((await Cat.getCatalogue()).map((e) => [e.id, e.suggested]), [["blog", true]]);
  await cat.down();   // la copie reçue reste dans data/cache
  const src = await Cat.getCatalogueSource();
  assert.equal(src.source, "cache");
  assert.deepEqual((await Cat.getCatalogue()).map((e) => e.id), ["blog"]);
  assert.deepEqual((await S.setupModules()).modules.map((m) => m.id), ["blog"], "les suggestions aussi sont gardées avec la copie reçue");
  assert.equal((await S.setupModules()).unreachable, false);
});

test("le dépôt par défaut du catalogue est curiosa-extras, constante nommée surchargeable ; le cœur n'a aucune autre adresse de dépôt de modules", () => {
  assert.equal(Rec.DEFAULT_CATALOGUE_REPO, "https://github.com/helldog136/curiosa-extras");
  const code = walk("src").filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, stripComments(read(f))]);
  const holders = code.filter(([, t]) => /helldog136\/curiosa-extras/.test(t)).map(([f]) => f);
  assert.deepEqual(holders, ["src/core/modules/recognized.ts"], "une seule constante");
});

test("aucune lecture locale de modules dans le cœur : plus de listBundled, BUNDLED, appRoot, installBundled, copyBundled, provisionBundled, instantané, extras/", () => {
  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
  const banned = /\b(listBundled|BUNDLED|appRoot|installBundled|copyBundled|provisionBundled|provisionModule\b.*offline|readBundledManifest|bundledManifests|suggestedModuleIds|readSnapshot|CURIOSA_EXTRAS_DIR|CURIOSA_CATALOGUE_RUNTIME|extras\/(modules|examples|catalogue)|"snapshot")\b|"examples"|"extras"/;
  for (const f of files) assert.ok(!banned.test(stripComments(read(f))), `${f} lit encore un dossier de modules local`);
  // `bundled` ne subsiste que comme lignes d'anciens sites, chaque fichier le disant (« à retirer en phase 3 d'entretien »).
  for (const f of files) {
    if (!/["`]bundled["`]|source: "bundled"|kind: "bundled"/.test(stripComments(read(f)))) continue;
    assert.match(read(f), /phase 3/i, `${f} : « bundled » doit être marqué « compatibilité sites anciens, à retirer en phase 3 d'entretien »`);
  }
  assert.match(read("src/core/modules/bundledUpdate.ts"), /COMPATIBILIT[ÉE] SITES ANCIENS, À RETIRER EN PHASE 3/);
});

test("neutralité : le cœur ne connaît aucun identifiant de module (ni suggéré, ni installé d'office)", () => {
  const ids = ["contacts", "contact-form", "planning", "partnerships", "sponsors", "sponsor-ticker", "game-suggestions", "live-status", "twitch-channel", "youtube-channel", "discord-announcer", "alerts-overlay", "maze-overlay", "press-kit", "guestbook", "announcement-banner"];
  const re = new RegExp(`["'\`](${ids.join("|")})["'\`]|(\\bid|moduleId|\\.id)\\s*(===?|!==?)\\s*["'](blog|links|pages|hero|collection|codes)["']`);
  for (const f of walk("src/core/modules").concat(walk("src/app/admin/(auth)/setup"), walk("src/app/admin/(panel)/catalogue")).filter((x) => /\.(ts|tsx)$/.test(x) && !/modules\/(manifest|types)\.ts$/.test(x))) {   // manifest.ts et types.ts décrivent le vocabulaire des manifestes (permissions « pages »…), pas des modules
    assert.ok(!re.test(stripComments(read(f))), `${f} cite un identifiant de module`);
  }
});

/* ───────────── Interface : plus aucun ancien mot ───────────── */

test("locales fr/en : aucune mention de module « livré / embarqué / copie hors ligne / instantané / copie locale »", () => {
  const old = /livr[ée]s? avec|embarqu|hors[- ]ligne|instantan|copie (locale|de repli)|bundled|snapshot|offline|shipped with|embedded modules?|local copy|built-in module/i;
  for (const lang of ["fr", "en"]) {
    const dict = JSON.parse(read(`src/locales/${lang}.json`));
    assert.deepEqual(Object.entries(dict).filter(([, v]) => typeof v === "string" && old.test(v)).map(([k]) => k), [], lang);
  }
});

test("documentation : README, INSTALL, MODULES et catalogue/README disent que Curiosa s'installe seul et que ses modules viennent du catalogue", () => {
  const old = /embarqués?\b|copie (de repli )?hors ligne|instantané|extras:fetch|CURIOSA_EXTRAS_DIR|CURIOSA_CATALOGUE_RUNTIME|modules livrés|livré avec le (framework|cœur)|embedded modules?|extras\/ /i;
  for (const f of ["README.md", "docs/INSTALL.md", "docs/MODULES.md", "docs/PLATFORM.md", "docs/ARCHITECTURE.md", "catalogue/README.md", ".env.example"]) assert.ok(!old.test(read(f)), `${f} parle encore de modules embarqués`);
  assert.match(read("README.md"), /Curiosa s'installe seul/);
  assert.match(read("docs/INSTALL.md"), /Curiosa s'installe seul/);
  assert.match(read("docs/INSTALL.md") + read("README.md"), /curiosa-extras/);
});

/* ───────────── Sites existants : ligne `bundled` ───────────── */

test("ancien site (ligne `bundled`) : fonctionne sans catalogue (son dossier est sur le disque), se met à jour depuis le catalogue sans rien perdre, erreur claire hors ligne", async () => {
  const dir = R.moduleDir("carnet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ apiVersion: 2, id: "carnet", name: "Carnet", version: "1.0.0", main: "index.mjs" }));
  fs.writeFileSync(path.join(dir, "index.mjs"), "export default { marker: 'ancien' };\n");
  await db.prisma.module.create({ data: { id: "carnet", source: "bundled", version: "1.0.0", enabled: true } });
  await cat.down({ forget: true });

  // 1. hors ligne : il marche, il est activable, une instance se crée, le rapport de mises à jour ne casse pas
  assert.equal((await R.getModule("carnet")).def.marker, "ancien");
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule("carnet")).manifest, nickname: "Carnet", names: { fr: "Carnet" } });
  await setSetting(`instance.${inst.id}.titre`, "Mon carnet");
  await db.prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "items", data: JSON.stringify({ t: "x" }) } });
  const report = await Upd.getModulesReport(true);
  assert.deepEqual(report.outdated, []);
  assert.deepEqual(report.unchecked, ["carnet"], "non vérifiable hors ligne : dit, pas « à jour »");
  const offline = await I.updateModule("carnet");
  assert.deepEqual([offline.ok, offline.error], [false, "modules.error.catalogue"]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "carnet" } })).source, "bundled");

  // 2. le catalogue revient avec une version plus récente : « Mises à jour » la propose, la mise à jour conserve tout
  await cat.up();
  await cat.add("carnet", { manifest: { name: "Carnet", version: "1.1.0" }, marker: "nouveau" });
  const rep2 = await Upd.getModulesReport(true);
  assert.deepEqual(rep2.outdated.map((o) => [o.id, o.current, o.target]), [["carnet", "1.0.0", "1.1.0"]]);
  const r = await I.updateModule("carnet");
  assert.equal(r.ok, true);
  const row = await db.prisma.module.findUnique({ where: { id: "carnet" } });
  assert.deepEqual([row.source, row.version, row.enabled, row.repoUrl], ["git", "1.1.0", true, cat.https]);
  assert.equal((await R.getModule("carnet")).def.marker, "nouveau");
  assert.equal(await getSetting(`instance.${inst.id}.titre`), "Mon carnet");
  assert.equal(await db.prisma.moduleRecord.count({ where: { instanceId: inst.id } }), 1);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "carnet" } }), 1);

  // 3. un autre ancien module que le catalogue ne liste plus : il reste installé, « source inconnue »
  fs.mkdirSync(R.moduleDir("orphelin"), { recursive: true });
  fs.writeFileSync(path.join(R.moduleDir("orphelin"), "module.json"), JSON.stringify({ apiVersion: 2, id: "orphelin", name: "O", version: "1.0.0" }));
  await db.prisma.module.create({ data: { id: "orphelin", source: "bundled", version: "1.0.0", enabled: true } });
  assert.equal((await I.updateModule("orphelin")).error, "modules.error.unknownSource");
  assert.equal((await X.diagnoseModule("orphelin")).catalogue, undefined);
  assert.ok(await db.prisma.module.findUnique({ where: { id: "orphelin" } }), "il reste installé");
  const fr = JSON.parse(read("src/locales/fr.json"));
  assert.match(fr["maintenance.source.unknown"], /source inconnue/);
});
