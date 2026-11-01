import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const C = await import("@/core/modules/recognized");
const M = await import("@/core/modules/catalogue");
const { DATA_DIR } = await import("@/core/config");

const ENTRY = (id, extra = {}) => ({ id, name: id.toUpperCase(), description: `Module ${id}`, repo: `https://github.com/x/${id}`, ...extra });
const indexOf = (...mods) => ({ "catalogue/index.json": JSON.stringify({ version: 1, modules: mods }) });
const ENV = ["CURIOSA_CATALOGUE_REPO", "CURIOSA_CATALOGUE_REF", "MODULES_INDEX_URL", "CURIOSA_UPDATE_REMOTE"];
const NOWHERE = "file:///nonexistent/curiosa-extras";
const ids = (r) => r.items.map((i) => i.id);

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.CURIOSA_CATALOGUE_REPO = NOWHERE;   // jamais le vrai dépôt par défaut dans un test
  C.clearRecognizedCache();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
});
after(() => db.close());

test("entrées : tableau ou { modules }, invalides écartées, doublons et dépôts file:// refusés", () => {
  const good = ENTRY("bon");
  assert.deepEqual(C.sanitizeEntries([good]).map((e) => e.id), ["bon"]);
  assert.deepEqual(C.sanitizeEntries({ version: 1, modules: [good] }).map((e) => e.id), ["bon"]);
  for (const bad of [null, "x", 5, {}, { modules: "non" }, [null, "x", 3], [{ id: "A", repo: "https://github.com/x/a" }], [{ id: "ok", repo: "http://github.com/x/a" }], [{ id: "ok", repo: "https://evil.example/x/a" }], [{ id: "ok", repo: "file:///tmp/x" }]]) assert.deepEqual(C.sanitizeEntries(bad), [], JSON.stringify(bad));
  assert.deepEqual(C.sanitizeEntries([good, { ...good, repo: "https://github.com/x/autre" }]).length, 1);
  assert.equal(C.sanitizeEntries([ENTRY("a1", { ref: "v1.0.0" })])[0].ref, "v1.0.0");
  assert.equal(C.sanitizeEntries([ENTRY("a1", { ref: "a; rm -rf /" })])[0].ref, undefined, "référence dangereuse ignorée");
});

test("dépôt cloné en SSH : interrogé en https", () => {
  assert.equal(C.toHttpsRemote("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(C.toHttpsRemote("ssh://git@gitlab.com/owner/repo.git"), "https://gitlab.com/owner/repo");
  assert.equal(C.toHttpsRemote("https://github.com/owner/repo.git"), "https://github.com/owner/repo.git");
});

test("LU À L'EXÉCUTION : une entrée ajoutée au dépôt apparaît sans nouvelle version du framework", async () => {
  const repo = makeRepo(indexOf(ENTRY("premier")));
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  let r = await C.getRecognizedDetailed({});
  assert.deepEqual([r.source, ids(r), r.origin], ["repository", ["premier"], repo.url]);
  assert.ok(r.fetchedAt > 0);
  // le mainteneur fusionne une entrée : aucune release du framework
  fs.writeFileSync(path.join(repo.dir, "catalogue/index.json"), JSON.stringify({ version: 1, modules: [ENTRY("premier"), ENTRY("second")] }));
  repo.g("commit", "-qam", "ajoute second");
  assert.deepEqual(ids(await C.getRecognizedDetailed({})), ["premier"], "pendant 15 minutes : servi par la mémoire (pas de requête à chaque page)");
  C.clearRecognizedCache();
  assert.deepEqual(ids(await C.getRecognizedDetailed({})), ["premier", "second"]);
});

test("mémoire : pas de seconde requête au dépôt tant que les 15 minutes ne sont pas écoulées", async () => {
  const repo = makeRepo(indexOf(ENTRY("m1")));
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  let fetches = 0;
  const git = async (args, cwd) => { if (args.includes("fetch")) fetches++; return (await import("node:child_process")).execFileSync("git", ["-c", "protocol.file.allow=always", ...args], { cwd }).toString(); };
  let t = 1_000_000;
  const o = { git, now: () => t };
  await C.getRecognizedDetailed(o); await C.getRecognizedDetailed(o);
  assert.equal(fetches, 1);
  t += 16 * 60_000;
  await C.getRecognizedDetailed(o);
  assert.equal(fetches, 2);
});

test("branche ou étiquette choisie : CURIOSA_CATALOGUE_REF", async () => {
  const repo = makeRepo(indexOf(ENTRY("sur-main")));
  repo.g("checkout", "-q", "-b", "stable");
  fs.writeFileSync(path.join(repo.dir, "catalogue/index.json"), JSON.stringify({ version: 1, modules: [ENTRY("sur-stable")] }));
  repo.g("commit", "-qam", "stable"); repo.g("checkout", "-q", "main");
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  assert.deepEqual(ids(await C.getRecognizedDetailed({})), ["sur-main"]);
  C.clearRecognizedCache(); process.env.CURIOSA_CATALOGUE_REF = "stable";
  assert.deepEqual(ids(await C.getRecognizedDetailed({})), ["sur-stable"]);
  C.clearRecognizedCache(); process.env.CURIOSA_CATALOGUE_REF = "--upload-pack=x";
  assert.notEqual((await C.getRecognizedDetailed({})).source, "repository", "référence dangereuse refusée");
});

test("hors ligne : dépôt injoignable → dernière copie reçue ; sinon liste VIDE (source « none »), jamais une copie locale", async () => {
  const repo = makeRepo(indexOf(ENTRY("en-ligne")));
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  assert.deepEqual(ids(await C.getRecognizedDetailed({})), ["en-ligne"]);
  // le dépôt disparaît
  fs.rmSync(repo.dir, { recursive: true, force: true });
  C.clearRecognizedCache();
  let r = await C.getRecognizedDetailed({});
  assert.deepEqual([r.source, ids(r)], ["cache", ["en-ligne"]], "dernière copie reçue");
  assert.ok(r.fetchedAt > 0);
  // ni dépôt ni copie reçue
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true }); C.clearRecognizedCache();
  r = await C.getRecognizedDetailed({});
  assert.deepEqual([r.source, ids(r), r.fetchedAt, r.suggested], ["none", [], null, []]);
  assert.equal(await M.catalogueUnreachable(), true);
});

test("catalogue injoignable : retenu quelques secondes seulement (« réessayez » doit pouvoir réussir tout de suite)", async () => {
  const repo = makeRepo(indexOf(ENTRY("revenu")));
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  let up = false;
  const git = async (args, cwd) => { if (!up) throw new Error("réseau"); return (await import("node:child_process")).execFileSync("git", ["-c", "protocol.file.allow=always", ...args], { cwd }).toString(); };
  let t = 5_000_000;
  const o = { git, now: () => t };
  assert.equal((await C.getRecognizedDetailed(o)).source, "none");
  up = true;
  t += 5_000;
  assert.equal((await C.getRecognizedDetailed(o)).source, "none", "dans les secondes qui suivent : mémoire (pas une requête par page)");
  t += 30_000;
  assert.deepEqual(ids(await C.getRecognizedDetailed(o)), ["revenu"], "peu après : on réessaie, sans attendre un quart d'heure");
});

test("fichier absent ou illisible dans le dépôt → dernière copie reçue ou liste vide, jamais d'exception", async () => {
  for (const files of [{ "autre.txt": "x" }, { "catalogue/index.json": "{pas du json" }]) {
    process.env.CURIOSA_CATALOGUE_REPO = makeRepo(files).url; C.clearRecognizedCache();
    fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
    const r = await C.getRecognizedDetailed({});
    assert.deepEqual([r.source, r.items.length], ["none", 0]);
  }
});

test("liste « suggérés » : lue dans le dépôt du catalogue comme l'index (suggested.json), identifiants invalides écartés, gardée avec la dernière copie reçue", async () => {
  const repo = makeRepo({ ...indexOf(ENTRY("blog"), ENTRY("autre")), "catalogue/suggested.json": JSON.stringify(["blog", "pas un id !", 42]) });
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  const r = await C.getRecognizedDetailed({});
  assert.deepEqual(r.suggested, ["blog"]);
  assert.deepEqual((await M.getCatalogue()).map((e) => [e.id, e.suggested]), [["blog", true], ["autre", false]]);
  fs.rmSync(repo.dir, { recursive: true, force: true }); C.clearRecognizedCache();
  const kept = await C.getRecognizedDetailed({});
  assert.deepEqual([kept.source, kept.suggested], ["cache", ["blog"]]);
  process.env.CURIOSA_CATALOGUE_REPO = makeRepo(indexOf(ENTRY("seul"))).url; C.clearRecognizedCache();
  assert.deepEqual((await C.getRecognizedDetailed({})).suggested, [], "pas de suggested.json : rien n'est suggéré");
});

test("index supplémentaire (MODULES_INDEX_URL) : il AJOUTE des modules, il ne remplace jamais ceux du dépôt", async () => {
  process.env.CURIOSA_CATALOGUE_REPO = makeRepo(indexOf(ENTRY("officiel", { repo: "https://github.com/x/officiel" }))).url;
  process.env.MODULES_INDEX_URL = "https://index.example/extra.json";
  const fetchImpl = async () => Response.json([ENTRY("officiel", { repo: "https://github.com/pirate/officiel" }), ENTRY("extra")]);
  const r = await C.getRecognizedDetailed({ fetchImpl });
  assert.deepEqual(ids(r), ["officiel", "extra"]);
  assert.equal(r.items[0].repo, "https://github.com/x/officiel", "le dépôt du framework fait foi");
  C.clearRecognizedCache();
  const down = await C.getRecognizedDetailed({ fetchImpl: async () => { throw new Error("réseau"); } });
  assert.deepEqual(ids(down), ["officiel"], "un index supplémentaire en panne n'efface rien");
});

test("dépôt de l'index : par défaut curiosa-extras (constante nommée, seul dépôt connu du cœur), ou celui choisi ; valeurs dangereuses refusées", () => {
  assert.equal(C.DEFAULT_CATALOGUE_REPO, "https://github.com/helldog136/curiosa-extras");
  delete process.env.CURIOSA_CATALOGUE_REPO;
  assert.equal(C.resolveIndexRepo(), C.DEFAULT_CATALOGUE_REPO, "aucun réglage : le dépôt par défaut, quel que soit le dépôt d'où le cœur a été installé");
  process.env.CURIOSA_CATALOGUE_REPO = "git@gitlab.com:communaute/index.git";
  assert.equal(C.resolveIndexRepo(), "https://gitlab.com/communaute/index", "un dépôt en SSH est interrogé en https");
  process.env.CURIOSA_CATALOGUE_REPO = "https://gitlab.com/communaute/index";
  assert.equal(C.resolveIndexRepo(), "https://gitlab.com/communaute/index");
  for (const bad of ["http://github.com/x/y", "https://evil.example/x/y", "https://u:p@github.com/x/y", "ext::sh -c id"]) { process.env.CURIOSA_CATALOGUE_REPO = bad; assert.equal(C.resolveIndexRepo(), null, bad); }
});

test("le Catalogue indique d'où vient sa liste, et les dépôts reconnus de l'index y figurent", async () => {
  process.env.CURIOSA_CATALOGUE_REPO = makeRepo(indexOf(ENTRY("tiers", { version: "2.0.0" }))).url;
  const list = await M.getCatalogue();
  assert.deepEqual(list.map((e) => [e.id, e.kind, e.version]), [["tiers", "recognized", "2.0.0"]], "le dépôt du catalogue, et rien d'autre : aucun module ne vient du cœur");
  const src = await M.getCatalogueSource();
  assert.equal(src.source, "repository");
});
