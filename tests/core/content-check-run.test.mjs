// Contrôle du contenu — le déroulement : par paquets, à la demande seulement, un seul passage à la fois, reprise, historique, remarques masquées.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { clock, linksText, makeNet, publicDns } from "../helpers/content-check-kit.mjs";

const db = await useTestDb();
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { setSetting } = await import("@/core/settings");
const R = await import("@/core/maintenance/content/run");
const S = await import("@/core/maintenance/content/store");
const { runOperation, readOperation, resetOperations } = await import("@/core/operations/tracker");
const { resetSharedContentNet } = await import("@/core/maintenance/content/net");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(async () => {
  await db.reset();
  resetOperations();
  resetSharedContentNet();
  R.setContentCheckDeps(null);
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr"]);
  // Un site « en ordre » : accroche, contact et menu renseignés, pour que seules les remarques testées apparaissent.
  await setSetting("site.tagline", "Une accroche", "fr");
  await setSetting("site.contactEmail", "emma@example.org");
  await setSetting("nav.custom", [{ label: { fr: "Accueil" }, href: "/" }]);
});
after(() => db.close());

let root;
async function pageWith(body, title = "Liens") {
  await db.fixture("pages");
  root ??= FIXTURE_MODULES.find((m) => m.manifest.id === "pages").manifest;
  const p = (await db.prisma.moduleInstance.findFirst({ where: { moduleId: "pages" } })) ?? (await createInstance(db.prisma, { manifest: root, basePath: "", names: { fr: "Pages" } }));
  const e = await createEntry(db.prisma, { instanceId: p.id, locale: "fr", status: "published", title, summary: "Un résumé", body });
  await db.prisma.entry.update({ where: { id: e.id }, data: { publishedAt: new Date(Date.now() - 1000) } });
  return e;
}
/** Dépendances d'une vérification de test : faux site distant, horloge simulée, aucun vrai réseau ni attente. */
function kit(routes = { "*": { status: 200 } }, extra = {}) {
  const c = clock();
  const net = makeNet(routes);
  return { c, net, deps: { now: c.now, sleep: c.sleep, net: { client: net.client, pins: net.pins }, resolve: publicDns, ...extra } };
}
const value = (out) => { assert.equal(out.busy, false); return out.value; };

test("un seul clic : le site est lu et les liens visités ; tout va bien → rapport complet, historique, plus rien à reprendre", async () => {
  await pageWith(linksText(5));
  const { deps } = kit();
  const out = value(await R.startCheck(deps));
  assert.deepEqual([out.finished, out.done, out.total], [true, 5, 5]);
  assert.equal(await S.readRun(), null, "la vérification en cours est effacée");
  const report = await S.readReport();
  assert.equal(report.finished, true);
  assert.deepEqual(report.groups, [], "rien à signaler");
  assert.equal((await S.readHistory()).length, 1);
  assert.equal((await S.readHistory())[0].ok, true);
  const sum = await S.readSummary();
  assert.deepEqual([sum.finished, sum.counts, sum.progress], [true, { important: 0, advised: 0, info: 0 }, null]);
  assert.equal((await R.continueCheck(deps)).value.none, true, "plus rien à continuer");
});

test("pas de rafale : une visite à la fois, 250 ms au moins entre deux, 1 s entre deux visites du même site", async () => {
  await pageWith(linksText(4));
  const c = clock();
  const stamps = [];
  const net = makeNet({ "*": () => { stamps.push(c.at()); return { status: 200 }; } });
  await R.startCheck({ now: c.now, sleep: c.sleep, net: { client: net.client, pins: net.pins }, resolve: publicDns });
  assert.equal(stamps.length, 4);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= R.SAME_HOST_MS, `même site : ${stamps[i] - stamps[i - 1]} ms`);
  await db.prisma.entry.deleteMany({});
  resetSharedContentNet();
  await pageWith(linksText(4, "*"));
  const c2 = clock(); const stamps2 = [];
  const net2 = makeNet({ "*": () => { stamps2.push(c2.at()); return { status: 200 }; } });
  await R.startCheck({ now: c2.now, sleep: c2.sleep, net: { client: net2.client, pins: net2.pins }, resolve: publicDns });
  for (let i = 1; i < stamps2.length; i++) assert.ok(stamps2[i] - stamps2[i - 1] >= R.GAP_MS, `sites différents : ${stamps2[i] - stamps2[i - 1]} ms`);
  assert.ok(stamps2[3] - stamps2[0] < 3000, "sites différents : pas de pause d'une seconde");
});

test("jamais deux visites de suite sur le même site tant qu'un autre attend (ordre réel des demandes)", async () => {
  const body = ["a", "a", "b", "b", "c", "c"].map((h, i) => `[x](https://${h}.example.net/${i})`).join(" ");
  await pageWith(body);
  const { deps, net } = kit();
  await R.startCheck(deps);
  assert.deepEqual(net.calls.map((x) => new URL(x.url).hostname), ["a.example.net", "b.example.net", "c.example.net", "a.example.net", "b.example.net", "c.example.net"]);
});

test("par paquets : un paquet s'arrête à 100 liens, l'avancement est gardé, « continuer » reprend où l'on s'était arrêté", async () => {
  await pageWith(linksText(150, "*"));
  const { deps, net } = kit();
  const first = value(await R.startCheck(deps));
  assert.equal(first.finished, false);
  assert.ok(first.done > 0 && first.done <= R.BATCH_MAX, `paquet : ${first.done}`);
  const mid = await S.readReport();
  assert.deepEqual([mid.finished, mid.progress.done, mid.progress.total], [false, first.done, 150]);
  assert.ok(await S.readRun(), "reprenable");
  assert.equal((await S.readSummary()).finished, false);
  const before = net.calls.length;
  let next = value(await R.continueCheck(deps));
  assert.ok(net.calls.length > before);
  while (!next.finished) next = value(await R.continueCheck(deps));
  assert.equal(next.done, 150);
  assert.equal(new Set(net.calls.map((x) => x.url)).size, 150, "chaque lien visité UNE fois");
  assert.equal(await S.readRun(), null);
  assert.equal((await S.readHistory()).length, 1);
});

test("un paquet ne dépasse pas sa durée, même quand chaque site met du temps à répondre", async () => {
  await pageWith(linksText(60, "*"));
  const c = clock();
  const net = makeNet({ "*": () => { c.advance(3000); return { status: 200 }; } });
  const t0 = c.at();
  const out = value(await R.startCheck({ now: c.now, sleep: c.sleep, net: { client: net.client, pins: net.pins }, resolve: publicDns, batchMs: 20_000 }));
  assert.ok(c.at() - t0 <= 20_000 + 4000, `durée simulée ${c.at() - t0} ms`);
  assert.equal(out.finished, false);
  assert.ok(out.done < 60);
});

test("« trop de demandes » : le site n'est plus contacté du tout pendant la vérification ; ses autres liens sont notés « pas vérifiés »", async () => {
  const body = ["limite", "limite", "limite", "ailleurs"].map((h, i) => `[x](https://${h}.example.net/${i})`).join(" ");
  await pageWith(body);
  const { deps, net } = kit({ "*": (url) => (url.includes("limite") ? { status: 429, headers: { "retry-after": "300" } } : { status: 200 }) });
  const out = value(await R.startCheck(deps));
  assert.equal(out.finished, true);
  assert.equal(net.calls.filter((x) => x.url.includes("limite")).length, 1, "une seule demande au site qui a dit « trop de demandes »");
  const g = (await S.readReport()).groups.find((x) => x.id === "link_unverified");
  assert.equal(g.count, 3);
  assert.deepEqual(g.sev, "info");
  assert.equal(g.items[0].d[2], "rate");
});

test("trou noir : une visite qui ne revient jamais est abandonnée, la vérification se termine", async () => {
  await pageWith(linksText(3, "*"));
  const { deps } = kit();
  let calls = 0;
  const t0 = Date.now();
  const out = value(await R.startCheck({ ...deps, probe: () => { calls++; return new Promise(() => {}); }, linkHardMs: 50 }));
  assert.equal(out.finished, true);
  assert.equal(calls, 3);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal((await S.readReport()).groups.find((g) => g.id === "link_down").count, 3);
});

test("plus de 200 liens : 200 par vérification, la suivante reprend là où la précédente s'est arrêtée, 25 au plus par site", async () => {
  await pageWith(linksText(250, "*"));
  const { deps, net } = kit();
  let out = value(await R.startCheck(deps));
  while (!out.finished) out = value(await R.continueCheck(deps));
  assert.equal(net.calls.length, 200, "200 visites, pas une de plus");
  assert.deepEqual(await S.readState(), { cursor: 200 });
  const seenFirst = new Set(net.calls.map((x) => x.url));
  const rep = await S.readReport();
  assert.deepEqual(rep.linkTotals, { found: 250, from: 0, count: 200, window: true });
  // Deuxième vérification : démarre au lien 201.
  const second = kit();
  let o2 = value(await R.startCheck(second.deps));
  while (!o2.finished) o2 = value(await R.continueCheck(second.deps));
  const seenSecond = new Set(second.net.calls.map((x) => x.url));
  assert.equal(seenSecond.size, 200);
  assert.equal(new Set([...seenFirst, ...seenSecond]).size, 250, "ensemble, les deux vérifications couvrent les 250 liens");
  assert.deepEqual(await S.readState(), { cursor: 150 });
  assert.equal((await S.readHistory()).length, 2);
});

test("un seul passage à la fois : un second lancement pendant une vérification est refusé ; une vérification abandonnée se libère toute seule", async () => {
  await pageWith(linksText(3, "*"));
  let release;
  const gate = new Promise((r) => { release = r; });
  const { deps } = kit();
  const first = R.startCheck({ ...deps, probe: async () => { await gate; return { st: "ok" }; } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await R.startCheck(deps)).busy, true);
  assert.equal((await R.continueCheck(deps)).busy, true);
  assert.equal(await R.checkIsRunning(), true);
  release();
  assert.equal(value(await first).finished, true);
  assert.equal(await R.checkIsRunning(), false);
  // Vérification abandonnée (processus tombé) : la date de fin gardée en base est dépassée, on peut relancer.
  await S.writeRun({ cid: "x", at: new Date().toISOString(), links: [], paused: {}, busyUntil: Date.now() + 100_000 });
  assert.equal((await R.startCheck(deps)).busy, true, "tant que la date n'est pas passée");
  await S.writeRun({ cid: "x", at: new Date().toISOString(), links: [], paused: {}, busyUntil: Date.now() - 1 });
  assert.equal((await R.startCheck(deps)).busy, false);
});

test("suivi d'avancement : « lien n sur m » avance lien par lien dans l'opération suivie du cœur (barre de progression)", async () => {
  await pageWith(linksText(5, "*"));
  const { deps } = kit();
  const seen = [];
  const viewer = { email: "emma@example.org", owner: false };
  let opId;
  const probe = async (url) => {
    const snap = readOperation(opId, viewer);
    seen.push({ unit: snap.unit && { ...snap.unit }, step: snap.step, fraction: snap.fraction });
    return { st: "ok" };
  };
  opId = "a".repeat(20);
  await runOperation({ kind: "content-check", key: "content-check", owner: viewer.email, opId }, () => R.startCheck({ ...deps, probe }));
  assert.deepEqual(seen.map((s) => s.unit.index), [1, 2, 3, 4, 5]);
  assert.ok(seen.every((s) => s.unit.total === 5 && s.step === "links"));
  assert.ok(seen.every((s, i) => s.fraction === null || (s.fraction >= 0 && s.fraction < 1 && (i === 0 || s.fraction >= seen[i - 1].fraction))), "jamais un pourcentage inventé : croissant et < 1");
  assert.ok(seen[4].fraction > seen[0].fraction);
});

test("remarques masquées : « Ignorer » les retire du résumé, « Tout réafficher » les rend ; au plus 200 ; une remarque inconnue est refusée", async () => {
  await pageWith("![](https://img.example.org/a.png)");
  const { deps } = kit();
  await R.startCheck(deps);
  const report = await S.readReport();
  const alt = report.groups.find((g) => g.id === "alt");
  assert.ok(alt);
  const before = (await S.readSummary()).counts;
  assert.ok(before.important >= 1);
  assert.deepEqual(await R.ignoreItem(alt.items[0].k), { ok: true });
  const after = await S.readSummary();
  assert.equal(after.counts.important, before.important - 1);
  assert.ok(!after.groups.some((g) => g.id === "alt"));
  assert.ok(!R.visibleGroups(await S.readReport(), await S.readIgnored()).some((g) => g.id === "alt"));
  assert.deepEqual(await R.ignoreItem("n'importe-quoi"), { gone: true });
  assert.equal(await R.unignoreAll(), 1);
  assert.equal((await S.readSummary()).counts.important, before.important);
  // Plafond de 200 remarques masquées.
  await S.writeIgnored(Array.from({ length: 200 }, (_, i) => `k${i}`));
  assert.deepEqual(await R.ignoreItem(alt.items[0].k), { full: true });
});

test("historique : les 5 dernières vérifications seulement", async () => {
  await pageWith("Rien à signaler ici.");
  for (let i = 0; i < 7; i++) value(await R.startCheck(kit().deps));
  const h = await S.readHistory();
  assert.equal(h.length, 5);
  assert.ok(h.every((e) => e.at && e.counts && typeof e.ok === "boolean"));
});

test("le résultat de chaque lien devient une remarque : mort (important), ne répond pas (conseillé), refuse les robots / a changé d'adresse / http / pas vérifié (pour info)", async () => {
  const urls = ["gone", "down", "blocked", "moved", "plain", "ok", "photo"].map((n) => `https://${n}.example.net/page`);
  const body = urls.slice(0, 6).map((u) => `[x](${u})`).join(" ").replace("https://plain", "http://plain") + " ![i](https://photo.example.net/page)";
  await pageWith(body);
  const { deps } = kit({
    "https://gone.example.net/page": { status: 404 }, "https://down.example.net/page": { status: 503 }, "https://blocked.example.net/page": { status: 403 },
    "https://moved.example.net/page": { status: 301, headers: { location: "https://nouveau.example.net/page" } }, "https://nouveau.example.net/page": { status: 200 },
    "https://plain.example.net/page": { status: 200 }, "https://ok.example.net/page": { status: 200 }, "https://photo.example.net/page": { status: 410 },
  });
  value(await R.startCheck(deps));
  const g = Object.fromEntries((await S.readReport()).groups.map((x) => [x.id, x]));
  assert.deepEqual([g.link_gone.sev, g.link_gone.count], ["important", 1]);
  assert.deepEqual([g.img_gone.sev, g.img_gone.count], ["important", 1]);
  assert.equal(g.link_down.sev, "advised");
  assert.equal(g.link_blocked.sev, "info");
  assert.equal(g.link_moved.sev, "info");
  assert.equal(g.link_moved.items[0].d[3], "https://nouveau.example.net/page");
  assert.equal(g.link_insecure.sev, "info");
  assert.ok(!g.link_unverified);
  assert.deepEqual(Object.keys(g).filter((id) => id.startsWith("link_") || id === "img_gone").sort(), ["img_gone", "link_blocked", "link_down", "link_gone", "link_insecure", "link_moved"]);
});

test("le rapport ne garde jamais de paramètres d'adresse ni d'identifiants (un lien privé peut porter un jeton), et la vérification en cours disparaît à la fin", async () => {
  await pageWith("[privé](https://docs.example.net/d/abc?token=SECRET123&k=1#frag)");
  const { deps } = kit({ "*": { status: 404 } });
  value(await R.startCheck(deps));
  const raw = JSON.stringify(await S.readReport()) + JSON.stringify(await S.readSummary()) + JSON.stringify(await S.readHistory());
  assert.ok(!/SECRET123|token=|frag/.test(raw), raw);
  assert.match(raw, /docs\.example\.net\/d\/abc/);
  assert.equal(await S.readRun(), null);
});

test("réglage « ne pas visiter les liens vers d'autres sites » : aucune visite, le rapport le dit ; sites à laisser tranquille respectés", async () => {
  await pageWith(linksText(3, "*"));
  await S.writeSettings({ checkLinks: false, skipHosts: "" });
  const { deps, net } = kit();
  value(await R.startCheck(deps));
  assert.equal(net.calls.length, 0);
  assert.equal((await S.readReport()).linksOff, true);
  await S.writeSettings({ checkLinks: true, skipHosts: "site0.example.net\nhttps://www.site1.example.net/page" });
  const second = kit();
  value(await R.startCheck(second.deps));
  assert.equal(second.net.calls.length, 1, "seul site2 est visité");
  assert.equal((await S.readReport()).notes.skipped.ignored, 2);
});

test("jamais d'arrière-plan : lire les résultats, le résumé ou le rapport ne contacte aucun site et ne lance rien", async () => {
  await pageWith(linksText(3));
  const { deps, net } = kit();
  value(await R.startCheck(deps));
  const calls = net.calls.length;
  const service = await import("@/core/maintenance/content/service");
  await service.contentCheckView(); await service.contentSummary(); await service.contentBadge(); await S.readReport(); await S.readHistory();
  assert.equal(net.calls.length, calls);
  assert.equal(await R.checkIsRunning(), false);
});
