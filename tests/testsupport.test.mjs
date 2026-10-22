// Tests du kit de conformité des modules (testsupport/) : un module fictif conforme les réussit toutes ; pour CHAQUE exigence, un module fautif prouve qu'elle détecte vraiment.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checkModule, registerConformanceTests, REQUIREMENTS, fakeCtx, fakeFetch, withFakeFetch, blockNetwork, startLocalServer, loadModuleDir, formatText } from "../testsupport/index.mjs";
import { renderDocs } from "../testsupport/docs.mjs";
import { KNOWN_BLOCKS } from "../testsupport/requirements/runtime.mjs";
import { makeModule, dispose, editManifest } from "./fixtures/testsupport/fullModule.mjs";

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")); // un test lancé depuis un test doit afficher son propre résultat
const made = [];
const mk = (edit) => { const d = makeModule(edit); made.push(d); return d; };
after(() => { for (const d of made) dispose(d); });
const status = (report, id) => report.results.find((r) => r.id === id);
const append = (f, file, text) => { f[file] += `\n${text}`; };

// ── Le module conforme réussit tout ─────────────────────────────────────────────────────────────────────────────────
test("un module conforme réussit toutes les exigences (aucune en échec, aucune non vérifiée sauf la liste de neutralité)", async () => {
  const dir = mk();
  const other = mk((f) => { editManifest(f, (m) => { m.id = "elsewhere"; m.mcp = [{ name: "elsewhere_list", readOnly: true, description: "List things that exist elsewhere." }]; delete m.provides; delete m.dataVersion; m.settings = []; }); f["index.mjs"] = 'export default { mcp: { elsewhere_list: () => [] } };'; });
  const report = await checkModule(dir, { siblings: [] });
  assert.equal(report.summary.ok, true);
  // « neutrality.clean » est sautée sans liste de neutralité, vérifiée (et réussie) avec : les deux sont corrects.
  const notPassed = report.results.filter((r) => r.status !== "pass" && r.id !== "neutrality.clean").map((r) => `${r.id}:${r.status}`);
  assert.deepEqual(notPassed.sort(), ["page.scripts:na", "routes.visitorIp:na", "srp.single:na"]);
  // avec un voisin sans rapport, « un propriétaire par donnée » est vérifié et réussit
  void other;
  assert.equal(status(await checkModule(dir, { siblings: [path.join(path.dirname(other), "full-mod")] }), "srp.single").status, "pass");
  assert.ok(REQUIREMENTS.length >= 40);
  for (const r of report.results) assert.ok(r.why && r.fix && r.doc.startsWith("docs/TESTSUPPORT.md#"), r.id);
});

// ── Un module fautif par exigence ───────────────────────────────────────────────────────────────────────────────────
const REPLACE = (f, from, to) => { assert.ok(f["index.mjs"].includes(from), `fixture : « ${from} » introuvable`); f["index.mjs"] = f["index.mjs"].replace(from, to); };
const FAULTS = {
  "manifest.file": (f) => { f["module.json"] = null; },
  "manifest.valid": (f) => editManifest(f, (m) => { m.instances = "bogus"; }),
  "manifest.version": (f) => editManifest(f, (m) => { m.version = "1.0"; }),
  "manifest.id": (f) => editManifest(f, (m) => { m.id = "other-mod"; }),
  "manifest.catalogue": (f) => editManifest(f, (m) => { delete m.description; delete m.license; }),
  "compat.apiVersion": (f) => editManifest(f, (m) => { m.apiVersion = 99; }),
  "compat.minCore": (f) => editManifest(f, (m) => { delete m.minCore; }),
  "compat.minCoreKnown": (f) => editManifest(f, (m) => { m.minCore = "9.9.9"; }),
  "def.loads": (f) => append(f, "index.mjs", "export const broken = ;"),
  "def.matches": (f) => editManifest(f, (m) => { m.sections.push({ id: "ghost", label: { en: "Ghost", fr: "Fantôme" } }); }),
  "perm.declared": (f) => editManifest(f, (m) => { m.permissions = m.permissions.filter((p) => p !== "storage"); }),
  "perm.minimal": (f) => editManifest(f, (m) => { m.permissions.push("filters"); }),
  "code.imports": (f) => { f["index.mjs"] = `import pad from "left-pad";\n${f["index.mjs"]}`; },
  "code.noDanger": (f) => append(f, "index.mjs", "export const run = (s) => eval(s);"),
  "load.noNetwork": (f) => { f["index.mjs"] = `fetch("https://example.org/boot").catch(() => {});\n${f["index.mjs"]}`; },
  "i18n.manifest": (f) => editManifest(f, (m) => { m.name = { en: "Full module" }; }),
  "i18n.parity": (f) => { const fr = JSON.parse(f["locales/fr.json"]); delete fr.thanks; f["locales/fr.json"] = JSON.stringify(fr); },
  "i18n.keys": (f) => REPLACE(f, 'ctx.t("thanks")', 'ctx.t("nowhere")'),
  "i18n.unused": (f) => { for (const l of ["en", "fr"]) { const d = JSON.parse(f[`locales/${l}.json`]); d.leftover = "unused"; f[`locales/${l}.json`] = JSON.stringify(d); } },
  "settings.sane": (f) => editManifest(f, (m) => { m.settings.push({ ...m.settings[0] }); }),
  "settings.optional": (f) => editManifest(f, (m) => { m.settings.push({ key: "extra", type: "text", label: { en: "Extra (optional)", fr: "Extra (facultatif)" } }); }),
  "settings.refersToChoice": (f) => editManifest(f, (m) => { m.settings.push({ key: "cat", type: "text", optional: true, refersTo: "category", label: { en: "Category", fr: "Catégorie" } }); }),
  "settings.textNamesExisting": (f) => editManifest(f, (m) => { m.settings.push({ key: "chan", type: "text", optional: true, label: { en: "Channel", fr: "Chaîne" }, help: { en: "Type the channel name.", fr: "Saisissez le nom de la chaîne." } }); }),
  "settings.advanced": (f) => editManifest(f, (m) => { m.settings.push({ key: "delay", type: "number", advanced: true, label: { en: "Delay", fr: "Délai" } }); }),
  "secrets.hidden": (f) => REPLACE(f, 'async latest(ctx) {', 'async latest(ctx) {\n      if (ctx.setting("apiKey")) return [{ type: "markdown", text: "key: " + ctx.setting("apiKey") }];'),
  "wording.simple": (f) => editManifest(f, (m) => { m.description.en = "Stores messages as JSON for visitors."; }),
  "wording.locales": (f) => { const d = JSON.parse(f["locales/en.json"]); d.empty = "No API message yet."; f["locales/en.json"] = JSON.stringify(d); },
  "readme.exists": (f) => { f["README.md"] = null; },
  "readme.plain": (f) => { f["README.md"] += "\nUtilise un endpoint JSON pour récupérer les messages affichés à la demande du visiteur.\n"; },
  "neutrality.clean": (f) => append(f, "index.mjs", "// written for forbiddenword.example"),
  "html.escaped": (f) => REPLACE(f, '"<p><strong>" + esc(last.name) + "</strong> " + esc(last.text) + "</p>"', '"<p><strong>" + last.name + "</strong> " + last.text + "</p>"'),
  "links.safe": (f) => REPLACE(f, 'const safeUrl = (v) => (/^https:\\/\\//.test(String(v ?? "")) ? String(v) : null);', 'const safeUrl = (v) => String(v ?? "") || null;'),
  "blocks.valid": (f) => REPLACE(f, '[{ type: "markdown", text: ctx.t("empty") }]', '[{ type: "bogus" }]'),
  "run.noCrash": (f) => REPLACE(f, "const [last] = await rows(ctx);", 'const [last] = await rows(ctx); if (ctx.setting("title") === "Messages" && last === undefined) throw new Error("boom");'),
  "routes.methods": (f) => REPLACE(f, 'if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });', 'if (request.method === "GET") { await ctx.api.store.add("messages", { name: "x", text: "y" }); return Response.json({ ok: true }); }'),
  "routes.size": (f) => REPLACE(f, 'clean(form.get("text"), 500)', 'String(form.get("text") ?? "")'),
  "routes.redirect": (f) => REPLACE(f, "return Response.json({ ok: true });", 'return new Response(null, { status: 302, headers: { Location: String(form.get("next") ?? request.url) } });'),
  "routes.errors": (f) => REPLACE(f, 'try { form = await request.formData(); } catch {', 'try { form = await request.formData(); } catch (e) { return new Response("Error at /home/app/node_modules/x.mjs:12:3\\n    at run (/home/app/index.mjs:1:1)", { status: 500 }); } if (false) {'),
  "routes.protected": (f) => REPLACE(f, "if (recent.length > Number(ctx.setting(\"perHour\") ?? 5)) return Response.json({ ok: false }, { status: 429 });", ""),
  "mcp.name": (f) => editManifest(f, (m) => { m.mcp[0].name = "full_list_every_message_with_all_details"; }),
  "mcp.safety": (f) => editManifest(f, (m) => { m.mcp.push({ name: "full_add", description: "Add a message to the page.", default: true, input: { type: "object" } }); }),
  "mcp.readOnly": (f) => REPLACE(f, "async full_list(ctx, args) {", 'async full_list(ctx, args) { await ctx.api.store.add("messages", { name: "x", text: "y" });'),
  "mcp.described": (f) => editManifest(f, (m) => { m.mcp[0].description = "List."; }),
  "tasks.valid": (f) => REPLACE(f, "everyMinutes: 5", "everyMinutes: 0"),
  "tasks.idempotent": (f) => REPLACE(f, 'if (known) await ctx.api.store.update(known.id, { at: 1 });\n        else await ctx.api.store.add("state", { at: 1 });', 'await ctx.api.store.add("state", { at: Date.now() });'),
  "tasks.failure": (f) => REPLACE(f, "if (!feed.ok) { /* service indisponible : on réessaiera */ }", 'if (!feed.ok) throw new Error("feed down");'),
  "net.bounded": (f) => append(f, "index.mjs", 'export const ping = () => fetch("https://example.org/ping");'),
  "tabs.reasonable": (f) => editManifest(f, (m) => { m.tabs = [{ id: "use", label: "Utiliser la page tout entière" }, ...["a1", "a2", "a3", "a4"].map((id) => ({ id, label: { fr: id, en: id } }))]; }),
  "forms.fieldErrors": (f) => REPLACE(f, "export default {\n  sections: {", 'export default {\n  adminActions: { save: async (ctx, values) => { if (!values.site) return { error: "Adresse invalide." }; return { ok: "ok" }; } },\n  sections: {'),
  "net.noIdleTimer": (f) => append(f, "index.mjs", "export const loop = () => setInterval(() => {}, 60000);"),
  "net.429": (f) => REPLACE(f, 'const feed = await ctx.api.net.request({ url: "https://example.org/feed" });', 'const feed = await fetch("https://example.org/feed", { signal: AbortSignal.timeout(2000) }).catch(() => ({ ok: false }));'),
  "net.fallback": (f) => REPLACE(f, "const [last] = await rows(ctx);", 'await fetch("https://example.org/live", { signal: AbortSignal.timeout(10000) }).catch(() => null);\n      const [last] = await rows(ctx);'),
  "downloads.bounded": (f) => REPLACE(f, 'yield "name,text\\n";', 'for (let i = 0; i < 1e9; i++) yield "x".repeat(1000);'),
  "data.version": (f) => REPLACE(f, "migrations: { 2: async () => {} }", "migrations: { 2: async () => {}, 7: async () => {} }"),
  "data.migrations": (f) => REPLACE(f, "migrations: { 2: async () => {} }", "migrations: { 2: async (ctx) => { await ctx.api.store.list(\"nothing\").then((r) => r[0].data); } }"),
  "privacy.declared": (f) => editManifest(f, (m) => { delete m.privacy; }),
  "privacy.thirdParty": (f) => { f["index.mjs"] = f["index.mjs"]; editManifest(f, (m) => { delete m.privacy; }); },
  "page.scripts": (f) => REPLACE(f, "title: ctx.setting(\"title\") || ctx.t(\"title\"),", "title: ctx.setting(\"title\") || ctx.t(\"title\"), scripts: [\"missing.js\", \"Bad Name.js\"],"),
  "routes.visitorIp": null, // vérifié à part : demande un cœur 0.2.6 (voir plus bas)
  "srp.single": null, // voir plus bas : demande un voisin
  "srp.coupling": (f) => append(f, "index.mjs", 'export const peek = (ctx) => ctx.api.instances.list({ module: "contacts" });'),
};

for (const r of REQUIREMENTS) {
  test(`${r.id} : détecte un module fautif`, async () => {
    if (r.id === "srp.single") {
      const dir = mk();
      const rival = mk((f) => editManifest(f, (m) => { m.id = "rival"; delete m.provides; delete m.dataVersion; m.mcp[1].name = "rival_remove"; }));
      // même nom d'outil MCP dans les deux modules
      const rivalDir = path.join(path.dirname(rival), "full-mod");
      const man = JSON.parse(fs.readFileSync(path.join(rivalDir, "module.json"), "utf8"));
      man.mcp[0].name = "full_list";
      fs.writeFileSync(path.join(rivalDir, "module.json"), JSON.stringify(man));
      const rep = await checkModule(dir, { siblings: [rivalDir] });
      assert.equal(status(rep, "srp.single").status, "fail", JSON.stringify(status(rep, "srp.single")));
      return;
    }
    if (r.id === "routes.visitorIp") {
      const m = { definition: { routes: { sign() {} } }, core: { version: "0.2.6" }, code: 'export default { routes: { sign: (request) => request.headers.get("x-forwarded-for").split(",")[0] } };' };
      const res = await r.run(m);
      assert.equal(res.length, 1);
      assert.match(res[0], /x-forwarded-for/i);
      return;
    }
    const edit = FAULTS[r.id];
    assert.ok(edit, `aucun module fautif défini pour ${r.id}`);
    if (r.id === "neutrality.clean") process.env.NEUTRALITY_TERMS = "forbiddenword";
    let rep;
    try {
      rep = await checkModule(mk(edit), { siblings: [] });
    } finally { if (r.id === "neutrality.clean") delete process.env.NEUTRALITY_TERMS; }
    const res = status(rep, r.id);
    assert.equal(res.status, "fail", `${r.id} aurait dû échouer : ${JSON.stringify(res)}`);
    assert.ok(res.problems.length > 0 && res.problems.every((p) => typeof p === "string" && p.length > 5));
    if (r.level === "mandatory") assert.equal(rep.summary.ok, false, "une exigence obligatoire en échec fait échouer le rapport");
  });
}

test("chaque exigence a son module fautif (aucune exigence sans test d'échec)", () => {
  assert.deepEqual(REQUIREMENTS.map((r) => r.id).filter((id) => !(id in FAULTS)), []);
  assert.deepEqual(Object.keys(FAULTS).filter((id) => !REQUIREMENTS.some((r) => r.id === id)), []);
});

test("une exigence obligatoire en échec donne un rapport en échec, un conseil seul non ; le texte explique quoi faire", async () => {
  const mandatory = await checkModule(mk(FAULTS["manifest.version"]), { siblings: [] });
  assert.equal(mandatory.summary.ok, false);
  const text = formatText(mandatory);
  assert.match(text, /❌ échec \(obligatoire\)/);
  assert.match(text, /Ce qui ne va pas/);
  assert.match(text, /Pourquoi c'est demandé/);
  assert.match(text, /Comment corriger/);
  assert.match(text, /docs\/TESTSUPPORT\.md#manifestversion/);
  const advice = await checkModule(mk(FAULTS["manifest.id"]), { siblings: [] });
  assert.equal(advice.summary.ok, true);
  assert.equal(status(advice, "manifest.id").status, "fail");
  assert.match(formatText(advice), /⚠️/);
});

test("un dossier inexistant ou vide ne fait pas lever la suite : tout est dans le rapport", async () => {
  const none = await checkModule(path.join(os.tmpdir(), "ts-nothing-here"), { siblings: [] });
  assert.equal(none.summary.ok, false);
  assert.equal(status(none, "manifest.file").status, "fail");
});

// ── Ligne de commande ───────────────────────────────────────────────────────────────────────────────────────────────
test("la commande : code 0 et JSON lisible pour un module conforme, code 1 pour un module fautif, code 2 sans dossier", () => {
  const run = (...args) => spawnSync(process.execPath, ["testsupport/check.mjs", ...args], { encoding: "utf8" });
  const good = run(mk(), "--json", "--voisins", os.tmpdir() + "/ts-none");
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const json = JSON.parse(good.stdout);
  assert.equal(json.summary.ok, true);
  assert.ok(json.results.every((r) => ["pass", "fail", "na", "skip"].includes(r.status) && "problems" in r && "fix" in r));
  const bad = run(mk(FAULTS["settings.optional"]));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /❌ échec \(obligatoire\) : Un réglage « facultatif » le déclare/);
  assert.equal(run().status, 2);
  assert.equal(run("/tmp/ts-absent-dir").status, 2);
  assert.match(run("--liste").stdout, /manifest\.valid/);
});

// ── Importé depuis un autre dépôt, par le chemin du cœur ─────────────────────────────────────────────────────────────
test("le kit s'importe depuis un dossier hors du cœur par son chemin absolu, sans dépendre de la position relative (et avec le chargeur du cœur)", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ts-outside-"));
  made.push(path.join(outside, "x")); // nettoyé par `after`
  const dir = mk();
  const kit = pathToFileURL(path.resolve("testsupport/index.mjs")).href;
  fs.writeFileSync(path.join(outside, "other-repo.test.mjs"), `
    import test from "node:test";
    import assert from "node:assert/strict";
    const { registerConformanceTests, checkModule } = await import(${JSON.stringify(kit)});
    registerConformanceTests(${JSON.stringify(dir)}, { test });
    test("rapport", async () => assert.equal((await checkModule(${JSON.stringify(dir)}, { siblings: [] })).summary.ok, true));
  `);
  for (const loader of [[], ["--import", pathToFileURL(path.resolve("tests/helpers/register.mjs")).href]]) {
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...loader, "--test", path.join(outside, "other-repo.test.mjs")], { cwd: outside, encoding: "utf8", env: cleanEnv });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /# fail 0/);
    assert.match(r.stdout, /manifest\.valid \(obligatoire\)/);
  }
});

test("l'adaptateur node:test : un test par exigence ; obligatoire en échec = le test échoue avec le message complet ; conseil = remarque seulement", async () => {
  const registered = [];
  const fake = (name, fn) => registered.push({ name, fn });
  registerConformanceTests(mk((f) => { FAULTS["manifest.version"](f); FAULTS["manifest.id"](f); }), { test: fake, siblings: [] });
  assert.equal(registered.length, REQUIREMENTS.length);
  const t = { notes: [], skipped: [], skip(m) { this.skipped.push(m); }, diagnostic(m) { this.notes.push(m); } };
  const find = (id) => registered.find((x) => x.name.includes(` ${id} `));
  await assert.rejects(() => find("manifest.version").fn(t), (e) => /Comment corriger/.test(e.message) && /1\.0/.test(e.message));
  await find("manifest.id").fn(t);
  assert.equal(t.notes.length, 1);
  await assert.rejects(() => find("manifest.valid").fn(t), /module\.json/); // « 1.0 » est aussi refusée par la validation du cœur
  await find("tasks.valid").fn(t);
  assert.equal(t.skipped.length >= 0, true);
});

test("`known` : un défaut connu n'arrête pas la suite, et l'exception périmée fait échouer", async () => {
  const registered = [];
  const fake = (name, fn) => registered.push({ name, fn });
  registerConformanceTests(mk(FAULTS["manifest.version"]), { test: fake, siblings: [], known: { "manifest.version": "à corriger bientôt", "manifest.file": "exception périmée" } });
  const t = { todo: [], todoCalls: 0, diagnostic() {}, skip() {}, };
  t.todo = () => { t.todoCalls++; };
  const find = (id) => registered.find((x) => x.name.includes(` ${id} `));
  await find("manifest.version").fn(t);
  assert.equal(t.todoCalls, 1);
  await assert.rejects(() => find("manifest.file").fn(t), /retirez l'exception/);
});

// ── Aides publiques ─────────────────────────────────────────────────────────────────────────────────────────────────
test("fakeCtx avec `permissions` refuse ce qui n'est pas déclaré et le note ; sans l'option, tout est permis", async () => {
  const ctx = fakeCtx({ permissions: ["sections"] });
  assert.throws(() => ctx.api.store, /storage/);
  assert.throws(() => ctx.api.mail, /mail/);
  assert.throws(() => ctx.api.topics, /topics/);
  assert.deepEqual(ctx.calls.denied, ["storage", "mail", "topics"]);
  assert.deepEqual(await ctx.api.rawg.cover("x"), { status: "no-key", url: null });
  const open = fakeCtx({ rows: { notes: [{ a: 1 }] } });
  assert.equal(await open.api.store.count("notes"), 1);
  await open.api.store.add("notes", { a: 2 });
  assert.deepEqual(open.calls.writes, [{ op: "add", collection: "notes" }]);
  assert.equal(open.dumpStore().length, 2);
  assert.equal(open.visit.lastVisit.getTime(), 0);
});

test("fakeFetch, withFakeFetch, blockNetwork et le serveur local fonctionnent sans réseau", async () => {
  const f = fakeFetch({ "https://api.example.org/stats": { json: { n: 3 } }, "https://api.example.org/down": { status: 503 } });
  assert.deepEqual(await (await f("https://api.example.org/stats")).json(), { n: 3 });
  assert.equal((await f("https://api.example.org/down")).status, 503);
  await assert.rejects(() => f("https://unknown.example.org/"), /fetch failed/);
  assert.equal(f.calls.length, 3);
  const before = globalThis.fetch;
  await withFakeFetch({ "https://a.example.org/": { text: "hi" } }, async () => assert.equal(await (await fetch("https://a.example.org/")).text(), "hi"));
  assert.equal(globalThis.fetch, before);
  const { calls } = await blockNetwork(async () => { await fetch("https://b.example.org/").catch(() => {}); });
  assert.equal(calls.length, 1);
  const server = await startLocalServer(({ method, body }) => ({ json: { method, body } }));
  try {
    const r = await (await fetch(`${server.url}/x`, { method: "POST", body: "ping" })).json();
    assert.deepEqual(r, { method: "POST", body: "ping" });
    assert.equal(server.requests[0].url, "/x");
  } finally { await server.close(); }
});

test("loadModuleDir note le réseau tenté au chargement sans jamais lever", async () => {
  const m = await loadModuleDir(mk(FAULTS["load.noNetwork"]));
  assert.ok(m.network.length >= 1 && /example\.org/.test(m.network[0]));
  const broken = await loadModuleDir(mk(FAULTS["def.loads"]));
  assert.ok(broken.loadErrors.some((e) => e.kind === "import"));
});

// ── Cohérence avec le cœur ──────────────────────────────────────────────────────────────────────────────────────────
test("les blocs connus du kit sont ceux du cœur (src/core/blocks.ts)", () => {
  const src = fs.readFileSync("src/core/blocks.ts", "utf8");
  const union = src.slice(src.indexOf("export type Block ="), src.indexOf("export type Slot"));
  const types = new Set([...union.matchAll(/(?:\{ type: |^\s+type: )"(\w+)"/gm)].map((x) => x[1]));
  for (const t of ["markdown", "html", "form", "table"]) assert.ok(types.has(t));
  for (const t of types) assert.ok(KNOWN_BLOCKS.includes(t) || ["head"].includes(t), `le bloc « ${t} » du cœur manque au kit`);
  for (const t of KNOWN_BLOCKS) assert.ok(types.has(t) || t === "head" || src.includes(`"${t}"`), `le kit connaît un bloc « ${t} » qui n'existe plus`);
});

test("docs/TESTSUPPORT.md est à jour avec les exigences (regénérez : node testsupport/docs.mjs --write)", () => {
  assert.equal(fs.readFileSync("docs/TESTSUPPORT.md", "utf8"), renderDocs());
});

test("le modèle d'auteur (testsupport/template) réussit toutes les exigences obligatoires et son test passe", async () => {
  const rep = await checkModule("testsupport/template", { siblings: [] });
  assert.equal(rep.summary.ok, true, JSON.stringify(rep.results.filter((r) => r.status === "fail")));
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", "testsupport/template/my-module.test.mjs"], { encoding: "utf8", env: cleanEnv });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("downloads.bounded : un droit non déclaré dans module.json, un type inconnu et un générateur qui lève une erreur sont signalés", async () => {
  const rep = await checkModule(mk((f) => {
    REPLACE(f, 'right: "export",', 'right: "nowhere",');
    REPLACE(f, 'contentType: "text/csv",', 'contentType: "text/html",');
    REPLACE(f, 'yield "name,text\\n";', 'throw new Error("boom");');
  }), { siblings: [] });
  const res = status(rep, "downloads.bounded");
  assert.equal(res.status, "fail");
  assert.match(res.problems.join("\n"), /nowhere/);
  assert.match(res.problems.join("\n"), /text\/html/);
  assert.match(res.problems.join("\n"), /échoue/);
});

test("adminActions à droit ({ right, run }, cœur 0.2.0) : le kit les accepte (def.loads) ET les exécute dans la sonde (redirection vers l'extérieur signalée)", async () => {
  const withRight = (run) => mk((f) => { f["index.mjs"] = f["index.mjs"].replace("export default {", `export default {\n  adminActions: { exporter: { right: "export", run: ${run} } },`); });
  const accepted = withRight("async () => ({ redirect: '/admin' })");
  const r1 = await checkModule(accepted, { siblings: [] });
  assert.equal(status(r1, "def.loads").status, "pass", "la forme { right, run } n'est plus refusée");
  assert.notEqual(status(r1, "routes.redirect").status, "fail");
  const evil = withRight("async () => ({ redirect: 'https://evil.example/phish' })");
  const r2 = await checkModule(evil, { siblings: [] });
  assert.equal(status(r2, "def.loads").status, "pass");
  assert.equal(status(r2, "routes.redirect").status, "fail", "la sonde exécute l'action à droit et voit sa redirection");
  assert.match(JSON.stringify(status(r2, "routes.redirect")), /exporter/);
  // Une valeur qui n'est ni une fonction ni { run } reste refusée.
  const bad = mk((f) => { f["index.mjs"] = f["index.mjs"].replace("export default {", "export default {\n  adminActions: { cassee: { right: 'export' } },"); });
  assert.equal(status(await checkModule(bad, { siblings: [] }), "def.loads").status, "fail");
});

test("def.matches : un formulaire d'administration vers une action { right, run } est reconnu (comme vers une fonction) ; vers une action absente, refusé", async () => {
  const panel = (action, actions) => mk((f) => {
    f["index.mjs"] = f["index.mjs"].replace("export default {", `export default {\n  async adminPanel() { return [{ type: "adminForm", action: ${JSON.stringify(action)}, submitLabel: "Ok", fields: [{ name: "note", label: "Note" }] }]; },\n  adminActions: ${actions},`);
  });
  const problems = (r) => (status(r, "def.matches").problems ?? []).filter((p) => /administration/.test(p));
  assert.deepEqual(problems(await checkModule(panel("save", "{ save: { right: 'export', run: async () => ({ ok: 'ok' }) } }"), { siblings: [] })), [], "forme { right, run }");
  assert.deepEqual(problems(await checkModule(panel("save", "{ save: async () => ({ ok: 'ok' }) }"), { siblings: [] })), [], "forme fonction");
  assert.equal(problems(await checkModule(panel("ghost", "{ save: { right: 'export', run: async () => ({ ok: 'ok' }) } }"), { siblings: [] })).length, 1, "action absente");
  assert.equal(problems(await checkModule(panel("save", "{ save: { right: 'export' } }"), { siblings: [] })).length, 1, "sans run");
});

test("page.scripts : un script présent dans scripts/ réussit ; il faut minCore 0.2.6 (compat.minCore) et la fonction est reconnue", async () => {
  const dir = mk((f) => {
    REPLACE(f, "title: ctx.setting(\"title\") || ctx.t(\"title\"),", "title: ctx.setting(\"title\") || ctx.t(\"title\"), scripts: [\"ui.js\"],");
    f["scripts/ui.js"] = "document.documentElement.dataset.ui = '1';\n";
  });
  const rep = await checkModule(dir, { siblings: [] });
  assert.equal(status(rep, "page.scripts").status, "pass", JSON.stringify(status(rep, "page.scripts")));
  const feat = status(rep, "compat.minCore");
  assert.equal(feat.status, "fail", "scripts de page : cœur 0.2.6 requis");
  assert.match(feat.problems.join("\n"), /0\.2\.6/);
});

test("permission « privacy » (cœur 0.2.6) : l'utiliser sans la déclarer est signalé ; le faux contexte la refuse sans permission et rend la liste réglable avec", async () => {
  const use = (permissions) => mk((f) => {
    REPLACE(f, "const [last] = await rows(ctx);", "const [last] = await rows(ctx); await ctx.api.privacy.declarations();");
    editManifest(f, (m) => { m.permissions = [...new Set([...m.permissions, ...permissions])]; });
  });
  const without = await checkModule(use([]), { siblings: [] });
  assert.match((status(without, "perm.declared").problems ?? []).join("\n"), /privacy/);
  assert.match((status(without, "compat.minCore").problems ?? []).join("\n"), /0\.2\.6/);
  const withIt = await checkModule(use(["privacy"]), { siblings: [] });
  assert.equal(status(withIt, "perm.declared").status, "pass");
  const denied = fakeCtx({ permissions: ["storage"], privacyDeclarations: { modules: [{ module: "a" }], truncated: false } });
  assert.deepEqual(await denied.api.privacy.declarations(), { modules: [], truncated: false });
  const allowed = fakeCtx({ permissions: ["privacy"], privacyDeclarations: { modules: [{ module: "a" }], truncated: false } });
  assert.equal((await allowed.api.privacy.declarations()).modules.length, 1);
});

test("routes.visitorIp : sans lecture d'en-tête d'adresse rien à signaler ; cœur plus ancien que 0.2.6 : non applicable ; la fonction est reconnue (minCore)", async () => {
  const r = REQUIREMENTS.find((x) => x.id === "routes.visitorIp");
  const ok = { definition: { routes: { sign() {} } }, core: { version: "0.2.6" }, code: "export default { routes: { sign: (request, ctx) => ctx.api.visitor.fingerprint(request, 'sign') } };" };
  assert.deepEqual(await r.run(ok), []);
  assert.ok((await r.run({ ...ok, core: { version: "0.2.5" } })).na, "cœur trop ancien");
  assert.equal((await r.run({ ...ok, code: "const h = req.headers.get('X-Real-IP');" })).length, 1);
  const dir = mk((f) => { REPLACE(f, 'const ip = request.headers.get("x-forwarded-for") || "local";', 'const ip = ctx.api.visitor.fingerprint(request, "sign");'); });
  assert.match((status(await checkModule(dir, { siblings: [] }), "compat.minCore").problems ?? []).join("\n"), /0\.2\.6/);
  const ctx = fakeCtx({ moduleId: "monsite" });
  const req = (xff) => new Request("https://example.test/", { headers: { "x-forwarded-for": xff } });
  assert.equal(ctx.api.visitor.fingerprint(req("1.1.1.1, 9.9.9.9"), "a"), ctx.api.visitor.fingerprint(req("2.2.2.2, 9.9.9.9"), "a"));
  assert.notEqual(ctx.api.visitor.fingerprint(req("9.9.9.9"), "a"), ctx.api.visitor.fingerprint(req("9.9.9.9"), "b"));
});
