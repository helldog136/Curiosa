// Téléchargements d'administration (adminDownloads) et champ fichier (kind: "file") : contrat 8 de docs/V2-CONTRACTS.md.
// Le vrai code des routes (adminTransferHandlers.ts) tourne avec de fausses dépendances (session, module, journal d'audit) : aucune base, aucun réseau.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

const T = await import("@/core/modules/adminTransfer");
const H = await import("@/core/modules/adminTransferHandlers");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const user = (o = {}) => ({ id: "u1", email: "u1@example.org", name: "U", level: "admin", roles: ["admin"], rights: new Set(["monsite:open", "monsite:export", "monsite:import"]), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false, ...o });
const ORIGIN = { origin: "https://site.example", host: "site.example" };
const post = (path, { body, headers = {}, same = true } = {}) => new Request(`https://site.example${path}`, { method: "POST", body, headers: { ...(same ? ORIGIN : { origin: "https://evil.example", host: "site.example" }), ...headers } });
const decode = async (res) => new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));

/** Un faux site : la personne connectée, un module « monsite », le journal. */
function rig({ me = user(), downloads, actions, limits } = {}) {
  const log = { audit: [], denied: [], calls: [] };
  const def = { adminDownloads: downloads, adminActions: actions };
  const deps = {
    user: async () => me,
    resolve: async (id) => (id === "i1" ? { key: "fiches", moduleId: "monsite", def, ctx: async () => ({ moduleId: "monsite" }) } : undefined),
    audit: async (actor, action, target = "") => { log.audit.push([actor, action, target]); },
    auditDenied: async (_u, what) => { log.denied.push(what); },
    t: async () => makeTranslator("fr"),
    limits, actionMs: 500,
  };
  return { deps, log };
}
const csv = (generate, extra = {}) => ({ export: { right: "export", filename: () => "fiches", contentType: "text/csv", generate, ...extra } });
const dl = (r, name = "export", init) => H.downloadHandler(post(`/api/admin/modules/i1/download/${name}`, init), { instance: "i1", name }, r.deps);

// ── Nom de fichier ────────────────────────────────────────────────────────────────────────────────────────────────────

test("nom de fichier hostile : chemin, guillemets, retours à la ligne, inversion du sens, nom réservé, extension trompeuse", () => {
  const S = T.sanitizeFilename;
  assert.equal(S("../../etc/passwd", "text/csv"), "etc_passwd.csv");
  assert.equal(S("C:\\Windows\\system32\\x", "text/csv"), "C_Windows_system32_x.csv");
  assert.equal(S('a"; filename="evil.exe', "text/csv"), "a_ filename_evil.exe.csv");
  assert.equal(S("x\r\nSet-Cookie: a=b", "text/csv").includes("\n"), false);
  assert.ok(!/[\r\n"]/.test(S("x\r\ny\"z", "text/plain")));
  assert.equal(S("rapport\u202Etxt.exe", "text/csv"), "rapporttxt.exe.csv", "inversion du sens d'écriture retirée");
  assert.equal(S("nul", "text/csv"), "_nul.csv");
  assert.equal(S("CON.csv", "text/csv"), "_CON.csv");
  assert.equal(S("évé.json", "application/json"), "évé.json");
  assert.equal(S("liste.html", "text/csv"), "liste.html.csv", "l'extension du type est toujours ajoutée");
  assert.equal(S("liste.CSV", "text/csv"), "liste.csv");
  assert.equal(S("...", "text/csv"), "export.csv");
  assert.equal(S("", "text/plain"), "export.txt");
  assert.equal(S(undefined, "text/plain"), "export.txt");
  assert.equal(S(".htaccess", "text/plain"), "htaccess.txt");
  assert.ok(S("a".repeat(500), "text/csv").length <= 104);
  assert.ok(!S("a".repeat(500), "text/csv").includes("/"));
});

test("Content-Disposition : toujours attachment, jamais d'injection d'en-tête", () => {
  const h = T.contentDisposition(T.sanitizeFilename('é"\r\nX-Evil: 1', "text/csv"));
  assert.match(h, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._-]*$/);
  assert.ok(!/[\r\n]/.test(h));
  assert.ok(!h.includes('"X-Evil'));
  assert.match(T.contentDisposition("é'(a).csv"), /filename\*=UTF-8''%C3%A9%27%28a%29\.csv$/);
});

// ── Droit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("décision : <module>:open ET le droit déclaré ; le droit d'un autre module est refusé ; sans droit déclaré, administrateurs seulement", () => {
  const spec = (right) => ({ x: { right, filename: () => "f", contentType: "text/csv", generate: async function* () {} } });
  const D = T.decideDownload;
  assert.ok("spec" in D(user(), "monsite", spec("export"), "x"));
  assert.ok("spec" in D(user(), "monsite", spec("monsite:export"), "x"), "forme préfixée par CE module");
  assert.ok("denied" in D(user({ rights: new Set(["monsite:export"]) }), "monsite", spec("export"), "x"), "sans monsite:open");
  assert.ok("denied" in D(user({ rights: new Set(["monsite:open"]) }), "monsite", spec("export"), "x"), "sans le droit");
  assert.ok("denied" in D(user({ rights: new Set(["autresite:export", "monsite:open"]) }), "monsite", spec("autresite:export"), "x"), "droit d'un autre module");
  assert.ok("denied" in D(user({ rights: new Set(["monsite:open", "monsite:a:b"]) }), "monsite", spec("a:b"), "x"), "identifiant invalide");
  assert.ok("spec" in D(user({ level: "owner", rights: new Set() }), "monsite", spec("export"), "x"), "le propriétaire a tout");
  assert.ok("spec" in D(user(), "monsite", spec(undefined), "x"), "sans droit déclaré : un administrateur");
  assert.ok("denied" in D(user({ level: "none", roles: ["r-x"] }), "monsite", spec(undefined), "x"), "sans droit déclaré : pas un rôle personnalisé");
  assert.equal(D(user(), "monsite", spec("export"), "autre"), null);
  assert.equal(D(user(), "monsite", spec("export"), "__proto__"), null);
  assert.equal(D(user(), "monsite", undefined, "x"), null);
  assert.ok("denied" in D(user(), "monsite", { x: { right: "export", filename: () => "f", contentType: "text/html", generate: async function* () {} } }, "x"), "type non prévu");
  assert.ok("denied" in D(user({ mustChangePassword: true }), "monsite", spec("export"), "x"), "mot de passe temporaire");
});

// ── Gardes de la route de téléchargement ──────────────────────────────────────────────────────────────────────────────

test("téléchargement : autre origine → 403, non connecté → 401, droit refusé → 403 + audit du refus, et le générateur n'est JAMAIS lancé", async () => {
  let started = 0;
  const gen = async function* () { started++; yield "a\n"; };
  const r = rig({ downloads: csv(gen) });
  assert.equal((await dl(r, "export", { same: false })).status, 403);
  assert.equal((await dl(rig({ me: null, downloads: csv(gen) }))).status, 401);
  const noRight = rig({ me: user({ rights: new Set(["monsite:open"]) }), downloads: csv(gen) });
  const res = await dl(noRight);
  assert.equal(res.status, 403);
  assert.deepEqual(noRight.log.denied, ["monsite:export"]);
  assert.equal((await dl(rig({ me: user({ mustChangePassword: true }), downloads: csv(gen) }))).status, 403);
  assert.equal((await dl(rig({ me: user({ needsTwoFactor: true }), downloads: csv(gen) }))).status, 403, "double vérification exigée");
  assert.equal((await dl(r, "inconnu")).status, 404);
  assert.equal((await dl(r, "../x")).status, 404);
  assert.equal((await H.downloadHandler(post("/x"), { instance: "autre", name: "export" }, r.deps)).status, 404);
  assert.equal(started, 0);
  assert.equal(T.downloadSlotsInUse(), 0);
  // Un navigateur qui soumet le formulaire reçoit une petite page lisible, pas du JSON brut.
  const page = await dl(noRight, "export", { headers: { accept: "text/html" } });
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await decode(page), /pas le droit/);
});

test("téléchargement : en-têtes sûrs, contenu, nom assaini, audit au début et à la fin avec le nombre d'octets", async () => {
  const r = rig({ downloads: csv(async function* (ctx, p) { yield "nom,note\n"; yield `${p.q ?? ""},é\n`; }, { filename: (ctx, p) => `fiches ${p.q}/../x"` }) });
  const res = await dl(r, "export", { body: "q=a%0D%0Ab&$secret=1&__proto__=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="fiches ab_.._x_.csv"; filename\*=UTF-8''/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
  assert.equal(await decode(res), "nom,note\na\r\nb,é\n");
  await new Promise((s) => setTimeout(s, 20));
  assert.deepEqual(r.log.audit[0], ["u1@example.org", "module.fiches.download.export", ""]);
  assert.deepEqual(r.log.audit[1], ["u1@example.org", "module.fiches.download.export.end", `${new TextEncoder().encode("nom,note\na\r\nb,é\n").length} bytes, done`]);
  assert.equal(T.downloadSlotsInUse(), 0);
});

test("téléchargement : jamais de GET, route sous /api/admin (authentifiée), pas dans les routes publiques /m/", () => {
  const route = fs.readFileSync("src/app/api/admin/modules/[instance]/download/[name]/route.ts", "utf8");
  assert.ok(/export async function POST/.test(route) && !/export (async )?function GET/.test(route));
  const action = fs.readFileSync("src/app/api/admin/modules/[instance]/action/[action]/route.ts", "utf8");
  assert.ok(/export async function POST/.test(action) && !/export (async )?function GET/.test(action));
  const h = fs.readFileSync("src/core/modules/adminTransferHandlers.ts", "utf8");
  // La garde passe AVANT toute lecture du corps.
  assert.ok(h.indexOf("await enter(") < h.indexOf("readBodyBounded(request"));
  assert.ok(!fs.readFileSync("next.config.mjs", "utf8").includes("bodySizeLimit"), "la limite des actions serveur n'est pas relevée");
});

// ── Flux ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("flux de 100 000 lignes : produit à la demande, jamais d'avance (mémoire bornée), contenu complet", async () => {
  let produced = 0;
  async function* lines() { for (let i = 0; i < 100_000; i++) { produced++; yield `${i},ligne numéro ${i} ${"x".repeat(60)}\n`; } }
  const res = await dl(rig({ downloads: csv(lines) }));
  const reader = res.body.getReader();
  let bytes = 0, consumedLines = 0, maxAhead = 0, chunks = 0, maxChunk = 0;
  gc();
  const heap0 = process.memoryUsage().heapUsed;
  let heapMax = heap0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++; bytes += value.length; maxChunk = Math.max(maxChunk, value.length);
    consumedLines += value.reduce((n, b) => n + (b === 10 ? 1 : 0), 0);
    maxAhead = Math.max(maxAhead, produced - consumedLines);
    if (chunks % 20 === 0) { gc(); heapMax = Math.max(heapMax, process.memoryUsage().heapUsed); } // après ramasse-miettes : ce qui reste est ce que le flux RETIENT
  }
  assert.equal(consumedLines, 100_000);
  assert.ok(maxChunk <= 1024 * 1024, `morceau de ${maxChunk} octets`);
  assert.ok(bytes > 8_000_000);
  assert.ok(maxAhead < 2_000, `${maxAhead} lignes produites d'avance : le flux doit être tiré par le client`);
  assert.ok(heapMax - heap0 < 20 * 1024 * 1024, `le tas a grossi de ${((heapMax - heap0) / 1048576).toFixed(0)} Mo`);
});

test("un très gros morceau unique est découpé en morceaux de 1 Mo au plus", async () => {
  const stream = T.streamGenerator((async function* () { yield "a".repeat(3 * 1024 * 1024 + 5); })());
  const sizes = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; sizes.push(value.length); }
  assert.ok(sizes.every((s) => s <= 1024 * 1024));
  assert.equal(sizes.reduce((a, b) => a + b, 0), 3 * 1024 * 1024 + 5);
});

test("le client coupe : le générateur est fermé, la place libérée, la fin est notée « client »", async () => {
  let closed = false;
  async function* endless() { try { for (let i = 0; ; i++) yield `${i}\n`.repeat(1000); } finally { closed = true; } }
  const r = rig({ downloads: csv(endless) });
  const res = await dl(r);
  const reader = res.body.getReader();
  await reader.read();
  assert.equal(T.downloadSlotsInUse(), 1);
  await reader.cancel();
  await new Promise((s) => setTimeout(s, 30));
  assert.equal(closed, true);
  assert.equal(T.downloadSlotsInUse(), 0);
  assert.match(r.log.audit.at(-1)[2], /, client$/);
});

test("le client coupe par le signal de la requête : même effet", async () => {
  let closed = false;
  async function* endless() { try { for (;;) yield "x".repeat(1000); } finally { closed = true; } }
  const ac = new AbortController();
  const ends = [];
  const stream = T.streamGenerator(endless(), { signal: ac.signal, onEnd: (e) => ends.push(e) });
  const reader = stream.getReader();
  await reader.read();
  ac.abort();
  await assert.rejects(() => reader.read());
  await new Promise((s) => setTimeout(s, 20));
  assert.equal(closed, true);
  assert.deepEqual(ends.map((e) => e.reason), ["client"]);
});

test("trou noir : un générateur qui ne produit plus rien est coupé (silence), sans retenir la réponse ni la place", async () => {
  let neverReturns = 0;
  const hole = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => { neverReturns++; return new Promise(() => {}); } }; } };
  const r = rig({ downloads: csv(() => hole), limits: { idleMs: 60 } });
  const res = await dl(r);
  assert.equal(res.status, 200);
  const t0 = Date.now();
  await assert.rejects(() => decode(res));
  assert.ok(Date.now() - t0 < 1500);
  await new Promise((s) => setTimeout(s, 30));
  assert.equal(T.downloadSlotsInUse(), 0);
  assert.equal(neverReturns, 1, "le générateur a été prié de se fermer");
  assert.match(r.log.audit.at(-1)[2], /, idle$/);
});

test("trou noir après quelques lignes : les premières lignes arrivent, puis le flux est coupé en erreur (pas un fichier tronqué qui a l'air complet)", async () => {
  const hole = (async function* () { yield "a\n"; await new Promise(() => {}); })();
  const stream = T.streamGenerator(hole, { limits: { idleMs: 50 } });
  const reader = stream.getReader();
  const first = await reader.read().catch((e) => e);
  // Le morceau peut être livré avant ou avec l'erreur : dans tous les cas la lecture finit par échouer.
  if (first instanceof Error) return;
  await assert.rejects(async () => { for (;;) { const { done } = await reader.read(); if (done) return; } });
});

test("durée totale dépassée : coupé", async () => {
  async function* slow() { for (;;) { await new Promise((s) => setTimeout(s, 15)); yield "x"; } }
  const ends = [];
  const stream = T.streamGenerator(slow(), { limits: { maxMs: 120, idleMs: 1000 }, onEnd: (e) => ends.push(e) });
  await assert.rejects(() => decode(new Response(stream)));
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, "time");
});

test("taille totale dépassée : coupé en erreur, une seule fin notée", async () => {
  async function* big() { for (;;) yield "x".repeat(400); }
  const ends = [];
  const stream = T.streamGenerator(big(), { limits: { maxBytes: 10_000 }, onEnd: (e) => ends.push(e) });
  const reader = stream.getReader();
  let got = 0;
  await assert.rejects(async () => { for (;;) { const { done, value } = await reader.read(); if (done) return; got += value.length; } });
  assert.ok(got <= 10_000);
  assert.deepEqual(ends.map((e) => e.reason), ["bytes"]);
});

test("le module lève une erreur ou rend autre chose que du texte : coupé, jamais de fuite du message à l'utilisateur", async () => {
  const origErr = console.error; console.error = () => {};
  try {
    for (const gen of [async function* () { yield "ok\n"; throw new Error("secret interne /srv/x"); }, async function* () { yield 42; }]) {
      const r = rig({ downloads: csv(gen) });
      const res = await dl(r);
      await assert.rejects(() => decode(res));
      await new Promise((s) => setTimeout(s, 20));
      assert.equal(T.downloadSlotsInUse(), 0);
      assert.match(r.log.audit.at(-1)[2], /, error$/);
    }
    // generate() qui n'est pas un générateur → 500 lisible
    const bad = rig({ downloads: csv(() => ["pas", "asynchrone"]) });
    const res = await dl(bad);
    assert.equal(res.status, 500);
    assert.ok(!(await decode(res)).includes("asynchrone"));
    assert.equal(T.downloadSlotsInUse(), 0);
    // filename() qui plante → 500
    const bad2 = rig({ downloads: csv(async function* () {}, { filename: () => { throw new Error("boom"); } }) });
    assert.equal((await dl(bad2)).status, 500);
    assert.equal(T.downloadSlotsInUse(), 0);
  } finally { console.error = origErr; }
});

test("deux téléchargements simultanés sont permis et chacun est borné ; le troisième attend (429) ; la place revient à la fin", async () => {
  async function* endless() { for (;;) yield "x".repeat(300); }
  const r = rig({ downloads: csv(endless), limits: { maxBytes: 5_000 } });
  const a = await dl(r), b = await dl(r);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const c = await dl(r);
  assert.equal(c.status, 429);
  assert.equal(c.headers.get("retry-after"), "30");
  assert.match((await c.json()).error, /2 téléchargements/);
  // chacun est borné séparément
  const sizes = await Promise.all([a, b].map(async (res) => { let n = 0; try { for await (const ch of res.body) n += ch.length; } catch { /* coupé à la limite */ } return n; }));
  assert.ok(sizes.every((n) => n > 0 && n <= 5_000), JSON.stringify(sizes));
  await new Promise((s) => setTimeout(s, 20));
  assert.equal(T.downloadSlotsInUse(), 0);
  const d = await dl(r);
  assert.equal(d.status, 200);
  await d.body.cancel();
  // une autre personne n'est pas gênée par la première (jusqu'à la limite globale)
  const other = rig({ me: user({ id: "u2", email: "u2@example.org" }), downloads: csv(endless), limits: { maxBytes: 5_000 } });
  const e1 = await dl(other);
  assert.equal(e1.status, 200);
  await e1.body.cancel();
});

test("limite globale : au plus 4 téléchargements en même temps sur le site", () => {
  const slots = ["a", "b", "c", "d"].map((id) => T.claimDownloadSlot(id));
  assert.ok(slots.every(Boolean));
  assert.equal(T.claimDownloadSlot("e"), null);
  slots[0]();
  slots[0](); // libérer deux fois ne libère pas deux places
  const e0 = T.claimDownloadSlot("e");
  assert.ok(e0);
  assert.equal(T.claimDownloadSlot("f"), null);
  e0();
  for (const s of slots) s();
  assert.equal(T.downloadSlotsInUse(), 0);
});

// ── Champ fichier ─────────────────────────────────────────────────────────────────────────────────────────────────────

const upload = (r, fields, { same = true, path = "/api/admin/modules/i1/action/import", headers } = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return H.actionHandler(post(path, { body: form, same, headers }), { instance: "i1", action: "import" }, r.deps);
};
const fileOf = (content, name = "contacts.csv", type = "text/csv") => new File([content], name, { type });
const importer = () => {
  const seen = { values: null, calls: 0 };
  return { seen, actions: { import: { right: "import", run: async (ctx, values) => { seen.calls++; seen.values = values; return { ok: `reçu ${values.list?.length ?? 0}`, redirect: "?done=1" }; } } } };
};

test("fichier : un CSV UTF-8 arrive au module en texte (BOM retiré), avec les autres champs ; audit avec la taille ; redirection limitée à l'admin", async () => {
  const m = importer();
  const r = rig({ actions: m.actions });
  const res = await upload(r, { list: fileOf("\uFEFFnom,mail\nÉlise,e@x.org\n"), note: "bonjour", "$max_list": "1000", "$accept_list": ".csv" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: "reçu 23", redirect: "/admin/instances/i1?done=1" });
  assert.equal(m.seen.values.list, "nom,mail\nÉlise,e@x.org\n");
  assert.equal(m.seen.values.note, "bonjour");
  assert.equal("$max_list" in m.seen.values, false, "les indications de l'interface ne sont pas des valeurs");
  assert.deepEqual(r.log.audit[0].slice(0, 2), ["u1@example.org", "module.fiches.import"]);
  assert.match(r.log.audit[0][2], /^\d+ bytes$/);
  // un module ne redirige pas hors de l'admin
  const evil = rig({ actions: { import: { right: "import", run: async () => ({ ok: "x", redirect: "https://evil.example" }) } } });
  assert.equal((await (await upload(evil, { list: fileOf("a") })).json()).redirect, undefined);
});

test("fichier : droit refusé, non connecté, autre origine, action inconnue, mauvais format de requête", async () => {
  const m = importer();
  assert.equal((await upload(rig({ actions: m.actions, me: user({ rights: new Set(["monsite:open"]) }) }), { list: fileOf("a") })).status, 403);
  assert.equal((await upload(rig({ actions: m.actions, me: user({ level: "editor", roles: ["editor"], rights: new Set(["core:entries.edit"]) }) }), { list: fileOf("a") })).status, 403);
  assert.equal((await upload(rig({ actions: m.actions, me: null }), { list: fileOf("a") })).status, 401);
  assert.equal((await upload(rig({ actions: m.actions }), { list: fileOf("a") }, { same: false })).status, 403);
  const fn = rig({ actions: { import: async () => ({ ok: "x" }) }, me: user({ level: "editor", roles: ["editor"], rights: new Set(["monsite:open"]) }) });
  assert.equal((await upload(fn, { list: fileOf("a") })).status, 403, "forme fonction : administrateurs seulement, comme avant");
  const r = rig({ actions: m.actions });
  assert.equal((await H.actionHandler(post("/x", { body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } }), { instance: "i1", action: "import" }, r.deps)).status, 415);
  assert.equal((await H.actionHandler(post("/x", { body: new FormData() }), { instance: "i1", action: "nope" }, r.deps)).status, 404);
  assert.equal(m.seen.calls, 0, "le module n'est jamais appelé quand l'accès est refusé");
});

test("gros fichier : 5 Mo + 1 octet refusé avec un message actionnable ; 5 Mo exacts acceptés", async () => {
  const m = importer();
  const r = rig({ actions: m.actions });
  const limit = 5 * 1024 * 1024;
  const big = await upload(r, { list: fileOf("a".repeat(limit + 1)) });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error, "Fichier trop gros (5 Mo au plus). Découpez-le en plusieurs fichiers plus petits.");
  assert.equal(m.seen.calls, 0);
  const ok = await upload(r, { list: fileOf("a".repeat(limit)) });
  assert.equal(ok.status, 200);
  assert.equal(m.seen.values.list.length, limit);
  // la limite du formulaire peut seulement ÊTRE ABAISSÉE
  assert.equal((await upload(r, { list: fileOf("a".repeat(2000)), "$max_list": "1000" })).status, 413);
  assert.equal((await upload(r, { list: fileOf("a".repeat(2000)), "$max_list": "999999999" })).status, 200);
  const en = rig({ actions: m.actions }); en.deps.t = async () => makeTranslator("en");
  assert.equal((await (await upload(en, { list: fileOf("a".repeat(limit + 1)) })).json()).error, "File too big (5 MB at most). Split it into several smaller files.");
});

test("corps énorme : la lecture est coupée au plafond sans tout lire (flux sans taille annoncée, ou taille annoncée mensongère)", async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled += 1024 * 1024; if (pulled > 100 * 1024 * 1024) return c.close(); c.enqueue(new Uint8Array(1024 * 1024)); } });
  const req = new Request("https://site.example/x", { method: "POST", body, duplex: "half", headers: { ...ORIGIN, "content-type": "multipart/form-data; boundary=zz" } });
  await assert.rejects(() => T.readBodyBounded(req, 5 * 1024 * 1024), T.BodyTooLarge);
  assert.ok(pulled <= 8 * 1024 * 1024, `${pulled} octets lus avant l'arrêt`);
  const r = rig({ actions: importer().actions });
  const res = await H.actionHandler(new Request("https://site.example/x", { method: "POST", body: new Uint8Array(12 * 1024 * 1024), headers: { ...ORIGIN, "content-type": "multipart/form-data; boundary=zz", "content-length": String(12 * 1024 * 1024) } }), { instance: "i1", action: "import" }, r.deps);
  assert.equal(res.status, 413);
});

test("envoi qui ne finit jamais : abandonné (trou noir côté client)", async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); } /* puis plus rien */ });
  const req = new Request("https://site.example/x", { method: "POST", body, duplex: "half", headers: { ...ORIGIN, "content-type": "multipart/form-data; boundary=zz" } });
  await assert.rejects(() => T.readBodyBounded(req, 1000, { idleMs: 40, totalMs: 500 }), /slow/);
});

test("UTF-8 invalide, binaire, mauvais type, fichier vide, nom hostile : refusés avec un message qui dit quoi faire", async () => {
  const m = importer();
  const r = rig({ actions: m.actions });
  const msg = async (file, extra = {}) => { const res = await upload(r, { list: file, ...extra }); return [res.status, (await res.json()).error]; };
  const latin1 = new File([new Uint8Array([0x6e, 0x6f, 0x6d, 0x0a, 0xe9, 0x0a])], "a.csv", { type: "text/csv" });
  assert.deepEqual(await msg(latin1), [400, "Ce fichier n'est pas en UTF-8. Dans votre tableur, enregistrez-le en « CSV UTF-8 », puis choisissez-le de nouveau."]);
  assert.equal((await msg(new File([new Uint8Array([0xff, 0xfe, 0x41, 0x00])], "a.csv", { type: "text/csv" })))[0], 400, "UTF-16 refusé");
  assert.match((await msg(new File([new Uint8Array([0x50, 0x4b, 0, 3, 4])], "a.csv", { type: "text/csv" })))[1], /pas du texte/);
  assert.match((await msg(fileOf("a,b", "programme.exe", "text/csv")))[1], /type de fichier/);
  assert.match((await msg(fileOf("a,b", "page.html", "text/html")))[1], /type de fichier/);
  assert.match((await msg(fileOf("a,b", "image.png", "image/png")))[1], /type de fichier/);
  assert.match((await msg(fileOf("a,b", "a.csv", "text/csv"), { "$accept_list": ".json" }))[1], /type de fichier/, "accept restreint");
  assert.match((await msg(fileOf("", "vide.csv")))[1], /vide/);
  assert.equal((await msg(fileOf("a;b", "../../x\u0000.csv")))[0], 200, "le nom du fichier envoyé ne sert à rien d'autre qu'au contrôle du type");
  assert.equal(m.seen.calls, 1);
  // aucun fichier choisi : le module reçoit une chaîne vide et décide
  const none = await upload(r, { list: new File([], "") });
  assert.equal(none.status, 200);
  assert.equal(m.seen.values.list, "");
});

test("trop de fichiers dans un même envoi", async () => {
  const r = rig({ actions: importer().actions });
  const form = new FormData();
  for (const n of ["a", "b", "c"]) form.set(n, fileOf("x", `${n}.csv`));
  const res = await H.actionHandler(post("/x", { body: form }), { instance: "i1", action: "import" }, r.deps);
  assert.equal(res.status, 400);
});

test("une action de module qui ne finit jamais est abandonnée (délai borné)", async () => {
  const r = rig({ actions: { import: { right: "import", run: () => new Promise(() => {}) } } });
  const origErr = console.error; console.error = () => {};
  try {
    const res = await upload(r, { list: fileOf("a") });
    assert.equal(res.status, 500);
  } finally { console.error = origErr; }
});

// ── Types, blocs, interface ───────────────────────────────────────────────────────────────────────────────────────────

test("types et blocs : ajouts additifs (kind file, accept, maxBytes, bloc download, adminDownloads), sans toucher à l'existant", () => {
  const blocks = fs.readFileSync("src/core/blocks.ts", "utf8");
  assert.match(blocks, /"checkbox"[\s\S]{0,400}"file"/);
  assert.match(blocks, /accept\?: string;/);
  assert.match(blocks, /maxBytes\?: number;/);
  assert.match(blocks, /type: "download"; name: string; label: string; params\?: Record<string, string>/);
  const types = fs.readFileSync("src/core/modules/types.ts", "utf8");
  assert.match(types, /adminDownloads\?: Record<string, AdminDownloadSpec>/);
  assert.match(types, /generate\(ctx: ModuleContext, params: Record<string, string>\): AsyncIterable<string>/);
  const ui = fs.readFileSync("src/components/admin/AdminBlocks.tsx", "utf8");
  assert.ok(ui.includes('f.kind === "file"') && ui.includes("/api/admin/modules/"), "le formulaire à fichier est envoyé à la route dédiée");
  const site = fs.readFileSync("src/components/site/Blocks.tsx", "utf8");
  assert.ok(/case "download":[\s\S]{0,300}panelInstanceId/.test(site), "le bloc download n'existe que dans le panneau d'admin");
  assert.ok(site.includes('method="post"'));
});
