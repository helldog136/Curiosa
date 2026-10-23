// Jaquettes RAWG, lot « corrections » : détection d'un titre douteux, correction mémorisée (avant le cache), liste « à vérifier », candidats, droits, MCP, sauvegarde.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const R = await import("@/core/services/rawg");
const F = await import("@/core/services/rawgFixes");
const A = await import("@/core/rawgAdmin");
const { rawgToolProvider } = await import("@/core/rawgMcp");
const { canUse } = await import("@/core/services/mcp/access");
const { makeApi } = await import("@/core/modules/api");
const { setSetting } = await import("@/core/settings");
const { RedirectError } = await import("next/navigation");
const Roles = await import("@/core/auth/roles");

const KEY = "cle-factice-0123456789abcdef";
const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const img = (id, slug = "jeu") => `https://media.rawg.io/media/games/${String(id).padStart(3, "0")}/${slug}-${id}.jpg`;
const game = (id, name, over = {}) => ({ id, name, released: "2020-05-01", platforms: [{ platform: { name: "PC" } }, { platform: { name: "PlayStation 5" } }, { platform: { name: "Xbox" } }, { platform: { name: "Switch" } }], background_image: img(id), ...over });
/** Réponses de RAWG par recherche (en minuscules) ; une recherche inconnue ne trouve rien. */
let table;
let calls;
beforeEach(async () => {
  await db.reset();
  R.clearRawgCache();
  A.resetRawgRate();
  calls = [];
  table = {};
  globalThis.curiosaTestSession = null;
  R.setRawgFetch(async (url) => {
    calls.push(url);
    const u = new URL(url);
    return reply(200, { results: table[u.searchParams.get("search").toLowerCase()] ?? [] });
  });
  await R.saveRawgKey(KEY);
});
after(() => { R.setRawgFetch(); return db.close(); });

/** Le journal s'écrit sans qu'on l'attende : on attend qu'il contienne ce titre. */
async function journal(n = 1) { let list = []; for (let i = 0; i < 200; i++) { list = await F.readToCheck(); if (list.length >= n) break; await new Promise((r) => setTimeout(r, 5)); } return list; }

// ── Détection ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("demande à RAWG une page bornée de résultats (8), jamais plus ; la clé n'est que dans la requête", async () => {
  table.hades = [game(1, "Hades")];
  await R.rawgCover("Hades");
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("page_size"), "8");
  assert.equal(u.hostname, "api.rawg.io");
  // RAWG répond 40 résultats malgré la demande : seuls 8 sont lus.
  table.beaucoup = Array.from({ length: 40 }, (_, i) => game(500 + i, `Beaucoup ${i}`));
  const c = await R.rawgCandidates("beaucoup");
  assert.ok(c.candidates.length <= 6);
});

test("« Playrooms » : RAWG met d'abord un autre jeu — le vrai est choisi par ressemblance, sans ambiguïté", async () => {
  table.playrooms = [game(11, "Astro's Playroom"), game(12, "Playroom Mania"), game(13, "Playrooms"), game(14, "The Playroom")];
  const r = await R.rawgCover("Playrooms");
  assert.deepEqual(r, { status: "found", url: img(13), name: "Playrooms", id: 13, ambiguous: false });
  assert.deepEqual(await F.readToCheck(), [], "rien à vérifier");
});

test("« Playrooms » absent de la réponse : le jeu le plus proche est donné, marqué ambigu, et noté « à vérifier »", async () => {
  table.playrooms = [game(11, "Astro's Playroom"), game(12, "Playroom Mania"), game(14, "The Playroom")];
  const r = await R.rawgCover("Playrooms");
  assert.equal(r.status, "found");
  assert.equal(r.ambiguous, true);
  assert.ok(r.name && r.id && r.url);
  const list = await journal();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].title, list[0].name, list[0].candidates], ["Playrooms", r.name, 3]);
  assert.equal(`https://media.rawg.io${list[0].img}`, r.url);
  assert.ok(Date.parse(list[0].at) > 0);
});

test("deux jeux aussi ressemblants l'un que l'autre (autres images) : ambigu ; la même image deux fois ne l'est pas", async () => {
  table.doom = [game(21, "DOOM"), game(22, "Doom")];
  assert.equal((await R.rawgCover("Doom")).ambiguous, true);
  table.dune = [game(31, "Dune", { background_image: img(31) }), game(32, "Dune", { background_image: img(31) })];
  assert.equal((await R.rawgCover("Dune")).ambiguous, false);
  table.hades = [game(41, "Hades"), game(42, "Hades II")];
  assert.equal((await R.rawgCover("Hades")).ambiguous, false, "un exact et une suite : sûr");
  table["hollow knight"] = [game(51, "Hollow Knight: Silksong"), game(52, "Hollow Knight")];
  const r = await R.rawgCover("Hollow Knight");
  assert.deepEqual([r.id, r.ambiguous], [52, false]);
});

test("titres à chiffres, sous-titres et accents : le bon jeu est pris même derrière un autre", async () => {
  table["final fantasy vii"] = [game(61, "Final Fantasy VIII"), game(62, "Final Fantasy 7")];
  assert.equal((await R.rawgCover("Final Fantasy VII")).id, 62);
  table["pokemon rouge"] = [game(71, "Pokémon Bleu"), game(72, "Pokémon Rouge")];
  assert.equal((await R.rawgCover("Pokemon Rouge")).id, 72);
  table["zelda botw"] = [game(81, "Zelda: Tears of the Kingdom")];
  assert.equal((await R.rawgCover("Zelda botw")).ambiguous, true);
});

test("le journal garde 100 titres au plus (le plus récent d'abord), un titre n'y est qu'une fois, et se purge à la lecture", async () => {
  for (let i = 0; i < 105; i++) { table[`titre ${i}`] = [game(1000 + i, `Autre chose ${i}`)]; await F.noteDoubtful({ title: `Titre ${i}`, name: `Autre ${i}`, rawgId: 1000 + i, url: img(1000 + i), candidates: 3 }); }
  await F.noteDoubtful({ title: "titre 3", name: "Autre 3 bis", url: img(1003), candidates: 5 });
  const list = await F.readToCheck();
  assert.equal(list.length, 100);
  assert.equal(list[0].title, "titre 3", "mis à jour et remonté, pas doublé");
  assert.equal(list.filter((d) => d.key === list[0].key).length, 1);
  // vieux titres : purgés à la lecture, sans minuteur
  const later = Date.now() + 61 * 86_400_000;
  assert.deepEqual(await F.readToCheck(later), []);
  assert.deepEqual(JSON.parse((await prisma.setting.findFirst({ where: { key: F.TO_CHECK_SETTING } })).value), [], "la purge est écrite");
  // une adresse d'image hors RAWG n'entre jamais dans le journal
  await F.noteDoubtful({ title: "Mauvais", name: "X", url: "https://evil.example/media/x.jpg", candidates: 1 });
  assert.deepEqual(await F.readToCheck(), []);
});

test("la liste ne grossit pas à chaque lecture du cache : une seule requête, une seule inscription", async () => {
  table.playrooms = [game(11, "Astro's Playroom")];
  for (let i = 0; i < 5; i++) await R.rawgCover("Playrooms");
  assert.equal(calls.length, 1);
  assert.equal((await journal()).length, 1);
});

// ── Corrections mémorisées ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("une correction est appliquée AVANT le cache et avant RAWG ; l'oublier ou la changer vide le cache", async () => {
  table.playrooms = [game(11, "Astro's Playroom"), game(12, "Playroom Mania")];
  const before = await R.rawgCover("Playrooms");
  assert.equal(calls.length, 1);
  table.playrooms = [game(13, "Playrooms")];
  R.clearRawgCache();
  const chosen = await A.chooseGame("u1", "Playrooms", 13, "playrooms");
  assert.equal(chosen.ok, true, JSON.stringify(chosen));
  const callsBefore = calls.length;
  const after = await R.rawgCover("  PLAYROOMS! ");
  assert.deepEqual(after, { status: "found", url: img(13), name: "Playrooms", id: 13, ambiguous: false });
  assert.notEqual(after.url, before.url);
  assert.equal(calls.length, callsBefore, "aucune requête : la correction passe avant le cache");
  // « aucune jaquette »
  assert.equal((await A.chooseNone("u1", "Playrooms")).ok, true);
  assert.deepEqual(await R.rawgCover("Playrooms"), { status: "none", url: null });
  // oubli : le choix automatique revient (cache vidé : nouvelle requête)
  assert.equal(await A.forget("u1", "playrooms"), true);
  const back = await R.rawgCover("Playrooms");
  assert.equal(back.id, 13, "RAWG redonne maintenant le bon jeu");
  assert.ok(calls.length > callsBefore, "le cache a été vidé");
});

test("une correction ne change rien sans clé RAWG, et jamais pour un autre titre", async () => {
  await A.chooseNone("u1", "Hades");
  assert.deepEqual(await R.rawgCover("Hades"), { status: "none", url: null });
  table["hades ii"] = [game(2, "Hades II")];
  assert.equal((await R.rawgCover("Hades II")).id, 2);
  await R.clearRawgKey();
  assert.deepEqual(await R.rawgCover("Hades"), { status: "no-key", url: null });
});

test("« Ce choix est bon » : garde le jeu trouvé tel quel et retire le titre de la liste", async () => {
  table.playrooms = [game(11, "Astro's Playroom")];
  await R.rawgCover("Playrooms");
  assert.equal((await journal()).length, 1);
  const ok = await A.confirmCurrent("u1", "Playrooms");
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual([ok.fix.kind, ok.fix.rawgId, ok.fix.name], ["game", 11, "Astro's Playroom"]);
  assert.deepEqual(await F.readToCheck(), []);
  table.playrooms = [game(99, "Playrooms")];
  R.clearRawgCache();
  assert.equal((await R.rawgCover("Playrooms")).id, 11, "le choix validé ne bouge plus, même si RAWG change d'avis");
  // sans entrée dans la liste : on garde ce que RAWG donne maintenant
  table.hades = [game(1, "Hades")];
  assert.equal((await A.confirmCurrent("u1", "Hades")).fix.rawgId, 1);
  assert.deepEqual((await A.confirmCurrent("u1", "Introuvable")), { ok: false, error: "nothing" });
});

test("le jeu choisi doit faire partie des propositions de RAWG ; l'image vient de RAWG, jamais d'une adresse envoyée", async () => {
  table.playrooms = [game(11, "Astro's Playroom")];
  assert.deepEqual(await A.chooseGame("u1", "Playrooms", 777), { ok: false, error: "candidate" });
  assert.deepEqual(await A.chooseGame("u1", "Playrooms", -4), { ok: false, error: "candidate" });
  assert.deepEqual(await A.chooseGame("u1", "Playrooms", 1.5), { ok: false, error: "candidate" });
  // RAWG (ou quelqu'un qui s'en fait passer pour lui) donne une image d'un autre hôte : refusée à l'enregistrement
  table["piège"] = [game(31, "Piège", { background_image: "https://evil.example/media/games/x.jpg" })];
  assert.deepEqual((await R.rawgCandidates("Piège")).candidates, [], "une image hors RAWG n'est même pas proposée");
  assert.deepEqual(await A.chooseGame("u1", "Piège", 31), { ok: false, error: "candidate" });
  assert.equal(await F.fixFor("Piège"), null);
  assert.equal(calls.every((u) => new URL(u).hostname === "api.rawg.io"), true, "seules des requêtes vers l'API RAWG");
});

test("image choisie à la main : seulement https://media.rawg.io/media/…, jamais une autre adresse", async () => {
  const good = "https://media.rawg.io/media/games/abc/jeu.jpg";
  assert.equal(F.rawgImagePath(good), "/media/games/abc/jeu.jpg");
  assert.equal(F.rawgImagePath("https://media.rawg.io/media/crop/600/400/games/abc/jeu.webp"), "/media/crop/600/400/games/abc/jeu.webp");
  for (const bad of [
    "http://media.rawg.io/media/games/abc/jeu.jpg", "https://evil.example/media/games/abc/jeu.jpg", "https://media.rawg.io.evil.example/media/games/a.jpg", "https://media.rawg.io@evil.example/media/games/a.jpg",
    "https://user:pw@media.rawg.io/media/games/a.jpg", "https://media.rawg.io:8443/media/games/a.jpg", "https://media.rawg.io/media/games/a.jpg?x=1", "https://media.rawg.io/media/games/a.jpg#f",
    "https://media.rawg.io/media/../secret.jpg", "https://media.rawg.io/media//x.jpg", "https://media.rawg.io/media/games/%2e%2e/a.jpg", "https://media.rawg.io/media/games/a.svg", "https://media.rawg.io/media/games/a.html",
    "https://media.rawg.io/other/a.jpg", "https://api.rawg.io/media/games/a.jpg", "https://cdn.media.rawg.io/media/games/a.jpg", "//media.rawg.io/media/games/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA",
    "https://media.rawg.io/media/games/a b.jpg", "https://media.rawg.io/media/games/a\\b.jpg", "https://media.rawg.io/media/" + "a".repeat(300) + ".jpg", "", null, undefined, 42, {},
  ]) assert.equal(F.rawgImagePath(bad), null, String(bad));
  assert.equal((await A.chooseImage("u1", "Hades", good)).ok, true);
  assert.equal((await R.rawgCover("Hades")).url, good);
  assert.deepEqual(await A.chooseImage("u1", "Hades", "https://evil.example/media/games/a.jpg"), { ok: false, error: "image" });
  assert.equal((await R.rawgCover("Hades")).url, good, "l'ancienne correction est intacte");
});

test("une correction abîmée dans la base (sauvegarde piégée) est ignorée : jamais d'adresse hors RAWG, jamais d'exception", async () => {
  await setSetting(F.FIXES_SETTING, {
    hades: { title: "Hades", kind: "game", rawgId: 1, name: "Hades", img: "/media/games/abc/h.jpg", at: new Date().toISOString() },
    evil: { title: "Evil", kind: "image", img: "//evil.example/x.jpg", at: new Date().toISOString() },
    evil2: { title: "Evil2", kind: "image", img: "/media/../../x.jpg", at: new Date().toISOString() },
    wrongkey: { title: "Autre", kind: "none", at: new Date().toISOString() },
    junk: 7,
  });
  assert.equal((await F.fixFor("Hades"))?.rawgId, 1);
  assert.equal(await F.fixFor("Evil"), null);
  assert.equal(await F.fixFor("Evil2"), null);
  assert.equal(await F.fixFor("Autre"), null, "la clé doit être celle du titre");
  assert.deepEqual(Object.keys(await F.readFixes()), ["hades"]);
  await setSetting(F.FIXES_SETTING, "n'importe quoi");
  assert.equal(await F.fixFor("Hades"), null);
  await prisma.setting.update({ where: { key_locale: { key: F.FIXES_SETTING, locale: "" } }, data: { value: "{pas du json" } });
  assert.equal(await F.fixFor("Hades"), null);
  assert.equal((await R.rawgCover("Hades")).status, "none", "RAWG est interrogé comme avant (réponse vide du faux RAWG)");
});

test("bornes : 1000 corrections au plus, titres de 120 caractères au plus, titre sans lettre refusé, une correction existante reste modifiable", async () => {
  const fixes = {};
  for (let i = 0; i < F.MAX_FIXES; i++) fixes[`jeu ${i}`] = { title: `Jeu ${i}`, kind: "none", at: new Date().toISOString() };
  await setSetting(F.FIXES_SETTING, fixes);
  assert.equal(Object.keys(await F.readFixes()).length, 1000);
  assert.deepEqual(await A.chooseNone("u1", "Un mille et unième"), { ok: false, error: "full" });
  assert.equal((await A.chooseNone("u1", "Jeu 7")).ok, true, "remplacer une correction existante est permis");
  assert.equal(await F.forgetFix("jeu 7"), true);
  assert.equal((await A.chooseNone("u1", "Un mille et unième")).ok, true);
  assert.deepEqual(await A.chooseNone("u1", "x".repeat(121)), { ok: false, error: "title" });
  assert.equal(await F.forgetFix("jeu 8"), true);
  assert.equal((await A.chooseNone("u1", "y".repeat(120))).ok, true);
  assert.deepEqual(await A.chooseNone("u1", "!!!"), { ok: false, error: "title" });
  assert.deepEqual(await A.chooseNone("u1", ""), { ok: false, error: "title" });
  assert.deepEqual(await A.chooseNone("u1", 42), { ok: false, error: "title" });
  assert.deepEqual(await A.chooseNone("u1", "z".repeat(5000)), { ok: false, error: "title" });
  const page = await F.listFixes(2, 25);
  assert.deepEqual([page.page, page.pages, page.items.length], [2, 40, 25]);
  assert.equal((await F.listFixes(9999)).page, 40, "page hors limites ramenée à la dernière");
});

test("oublier une correction en un clic, tout oublier ; écritures simultanées sans perte", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => A.chooseNone("u1", `Jeu simultané ${i}`)));
  assert.equal(Object.keys(await F.readFixes()).length, 20);
  assert.equal(await A.forget("u1", "jeu simultane 3"), true);
  assert.equal(await A.forget("u1", "jeu simultane 3"), false);
  assert.equal(Object.keys(await F.readFixes()).length, 19);
  assert.equal(await A.forgetAll("u1"), 19);
  assert.deepEqual(await F.readFixes(), {});
  assert.equal(await prisma.setting.count({ where: { key: F.FIXES_SETTING } }), 0);
});

test("cadence limitée : au-delà de 60 écritures (ou 30 lectures) par minute et par personne, « trop vite »", async () => {
  for (let i = 0; i < 60; i++) assert.equal((await A.chooseNone("u9", `Cadence ${i}`)).ok, true);
  assert.deepEqual(await A.chooseNone("u9", "Une de trop"), { ok: false, error: "rate" });
  assert.equal((await A.chooseNone("u10", "Autre personne")).ok, true, "la limite est par personne");
  for (let i = 0; i < 30; i++) assert.notEqual((await A.candidatesFor("u9", "Hades")).status, "rate");
  assert.equal((await A.candidatesFor("u9", "Hades")).status, "rate");
  assert.equal(A.takeRate("u9", "read", Date.now() + 61_000), true, "la minute suivante, ça repart");
});

// ── Candidats ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("candidates : 6 au plus, jaquette obligatoire, sans doublon, année et 3 plateformes au plus ; mêmes statuts que cover", async () => {
  table.jeu = [game(1, "Jeu"), game(2, "Jeu 2", { background_image: null }), game(3, "Jeu 3", { released: null }), game(1, "Jeu"), game(4, "Jeu 4", { background_image: "http://media.rawg.io/x.jpg" }),
    game(5, "Jeu 5"), game(6, "Jeu 6"), game(7, "Jeu 7"), game(8, "Jeu 8"), { name: "Sans numéro", background_image: img(9) }];
  const c = await R.rawgCandidates("Jeu");
  assert.equal(c.status, "found");
  assert.ok(c.candidates.length <= 6 && c.candidates.length >= 5);
  assert.deepEqual(c.candidates.map((x) => x.id).sort((a, b) => a - b).filter((x, i, a) => a.indexOf(x) === i), c.candidates.map((x) => x.id).sort((a, b) => a - b));
  assert.deepEqual(Object.keys(c.candidates[0]).sort(), ["id", "name", "platforms", "url", "year"]);
  assert.equal(c.candidates[0].year, 2020);
  assert.deepEqual(c.candidates[0].platforms, ["PC", "PlayStation 5", "Xbox"]);
  assert.equal(c.candidates.find((x) => x.name === "Jeu 3").year, null);
  assert.ok(!c.candidates.some((x) => x.name === "Jeu 2" || x.name === "Jeu 4" || x.name === "Sans numéro"));
  table.rien = [];
  assert.deepEqual(await R.rawgCandidates("Rien"), { status: "none", candidates: [] });
  assert.deepEqual(await R.rawgCandidates("   "), { status: "none", candidates: [] });
  R.setRawgFetch(async () => reply(401));
  assert.deepEqual(await R.rawgCandidates("Refus"), { status: "refused", candidates: [] });
  R.setRawgFetch(async () => { throw new Error("réseau " + KEY); });
  assert.deepEqual(await R.rawgCandidates("Panne"), { status: "unreachable", candidates: [] });
  await R.clearRawgKey();
  assert.deepEqual(await R.rawgCandidates("Hades"), { status: "no-key", candidates: [] });
});

test("candidates : une autre recherche (« search ») n'est qu'un mot envoyé à l'API RAWG, borné et nettoyé", async () => {
  table["astro's playroom"] = [game(11, "Astro's Playroom")];
  const c = await R.rawgCandidates("Playrooms", "Astro's Playroom");
  assert.deepEqual(c.candidates.map((x) => x.id), [11]);
  const u = new URL(calls.at(-1));
  assert.equal(u.hostname, "api.rawg.io");
  assert.equal(u.searchParams.get("search"), "Astro's Playroom");
  await R.rawgCandidates("x", "https://evil.example/\u0000" + "a".repeat(500));
  assert.ok(new URL(calls.at(-1)).searchParams.get("search").length <= 100);
  assert.equal(new URL(calls.at(-1)).hostname, "api.rawg.io");
});

test("ctx.api.rawg.candidates : permission « rawg » requise, aucune méthode ne donne la clé ; cover reste compatible pour un module existant", async () => {
  table.playrooms = [game(13, "Playrooms")];
  const inst = { id: "i1", key: "games", moduleId: "game-suggestions", names: {} };
  const api = makeApi(inst, "fr", ["storage", "rawg"]);
  assert.deepEqual(Object.keys(api.rawg).sort(), ["candidates", "configured", "cover"]);
  const c = await api.rawg.candidates("Playrooms");
  assert.equal(c.status, "found");
  assert.ok(!JSON.stringify(c).includes(KEY));
  // un module écrit pour l'ancien contrat ne lit que status et url
  const { status, url } = await api.rawg.cover("Playrooms");
  assert.deepEqual([status, url], ["found", img(13)]);
  for (const denied of [makeApi(inst, "fr", ["storage"]), makeApi(inst, "fr", []), makeApi(inst, "fr")]) {
    assert.deepEqual(await denied.rawg.candidates("Playrooms"), { status: "no-key", candidates: [] });
  }
});

// ── Sauvegarde ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("sauvegarde : les corrections font l'aller-retour (le journal, lui, n'est pas sauvegardé) ; une sauvegarde d'avant n'a aucune correction", async () => {
  const B = await import("@/core/backup/export");
  const Rs = await import("@/core/backup/restore");
  const { readTarGz } = await import("@/core/backup/tar");
  await prisma.user.create({ data: { email: "owner@example.org", name: "O", role: "owner", passwordHash: "x" } });
  await setSetting("setup.completed", true);
  // sauvegarde d'AVANT : aucune correction
  const old = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  table.playrooms = [game(13, "Playrooms")];
  await A.chooseGame("u1", "Playrooms", 13, "playrooms");
  await A.chooseNone("u1", "Jeu sans image");
  await F.noteDoubtful({ title: "Titre douteux", name: "Autre", url: img(5), candidates: 2 });
  const b = await B.createBackup("un-mot-de-passe-solide", { iterations: 1000 });
  const files = Object.fromEntries(readTarGz(b.plain).map((f) => [f.path, f.content]));
  const keys = JSON.parse(files["data/settings.json"].toString("utf8")).map((s) => s.key);
  assert.ok(keys.includes(F.FIXES_SETTING), "les corrections sont sauvegardées");
  assert.ok(!keys.includes(F.TO_CHECK_SETTING), "le journal est volatil");
  const fixesBefore = await F.readFixes();
  // on perd tout, puis on restaure
  await prisma.setting.deleteMany({ where: { key: F.FIXES_SETTING } });
  assert.equal(await F.fixFor("Playrooms"), null);
  const opened = Rs.openBackup(b.buffer, "un-mot-de-passe-solide", 1000);
  assert.ok(opened.ok);
  assert.equal((await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" })).ok, true);
  assert.deepEqual(await F.readFixes(), fixesBefore, "mêmes corrections après restauration");
  R.clearRawgCache();
  assert.equal((await R.rawgCover("Playrooms")).id, 13);
  // restauration de la sauvegarde d'avant : les corrections d'après disparaissent, le service marche comme avant
  const o2 = Rs.openBackup(old.buffer, "un-mot-de-passe-solide", 1000);
  assert.equal((await Rs.applyRestore(o2.backup, { confirmCustom: [], actor: "owner@example.org" })).ok, true);
  assert.deepEqual(await F.readFixes(), {});
  assert.equal(await F.fixFor("Playrooms"), null);
  assert.deepEqual(await F.readToCheck(), []);
});

// ── Droits et actions serveur ────────────────────────────────────────────────────────────────────────────────────────────────────
test("actions d'administration : propriétaire et administrateur oui ; éditeur, sans compte et sans rôle refusés ; rien n'est écrit sans droit", async () => {
  const mk = (name, role) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x" } });
  const owner = await mk("olive", "owner"), admin = await mk("adam", "admin"), editor = await mk("emma", "editor"), nobody = await mk("rien", "none");
  await Roles.syncSystemAssignments();
  const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: 0, role: "owner" } } : null; };
  const Act = await import("@/app/admin/(panel)/settings/rawg-covers/actions");
  const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
  table.playrooms = [game(13, "Playrooms")];
  for (const who of [null, editor, nobody]) {
    as(who);
    for (const [fn, data] of [["chooseNoneAction", { title: "Hades" }], ["chooseGameAction", { title: "Playrooms", rawgId: "13" }], ["chooseImageAction", { title: "Hades", imageUrl: "https://media.rawg.io/media/games/a/b.jpg" }], ["confirmAction", { title: "Hades" }], ["forgetAction", { key: "hades" }]]) {
      await assert.rejects(Act[fn](null, form(data)), RedirectError, `${fn} refusé pour ${who?.name ?? "personne"}`);
    }
    await assert.rejects(Act.forgetAllAction(), RedirectError);
  }
  assert.deepEqual(await F.readFixes(), {}, "rien écrit");
  as(admin);
  await assert.rejects(Act.chooseNoneAction(null, form({ title: "Hades" })), (e) => e instanceof RedirectError && e.url.endsWith("?saved=none"));
  assert.equal((await F.fixFor("Hades")).kind, "none");
  const bad = await Act.chooseImageAction(null, form({ title: "Hades", imageUrl: "https://evil.example/media/x.jpg" }));
  assert.match(bad.errors.imageUrl, /media\.rawg\.io/, "l'erreur est sous le champ, avec un exemple");
  const tooMany = await Act.chooseGameAction(null, form({ title: "Playrooms", rawgId: "999", q: "playrooms" }));
  assert.ok(tooMany.error && !tooMany.error.includes("rawgfix."), "message traduit");
  as(owner);
  await assert.rejects(Act.chooseGameAction(null, form({ title: "Playrooms", rawgId: "13", q: "playrooms" })), (e) => e instanceof RedirectError && e.url.endsWith("?saved=game"));
  assert.equal((await F.fixFor("Playrooms")).rawgId, 13);
  await assert.rejects(Act.forgetAction(null, form({ key: "hades" })), (e) => e.url.endsWith("?saved=forgot"));
  const audit = (await prisma.auditLog.findMany()).map((a) => `${a.actor} ${a.action}`);
  assert.ok(audit.includes("adam@example.org rawg.fix") && audit.includes("olive@example.org rawg.fix.forget"), audit.join("|"));
  // la clé n'est nulle part dans l'audit
  assert.ok(!JSON.stringify(await prisma.auditLog.findMany()).includes(KEY));
  // le code lit le droit en tête de chaque action et de la page
  const src = fs.readFileSync("src/app/admin/(panel)/settings/rawg-covers/actions.ts", "utf8");
  assert.match(src, /^"use server";/);
  for (const fn of ["chooseGameAction", "chooseNoneAction", "chooseImageAction", "confirmAction", "forgetAction", "forgetAllAction"]) assert.match(src, new RegExp(`export async function ${fn}[\\s\\S]*?adminCtx\\("admin"\\)`), fn);
  assert.match(fs.readFileSync("src/app/admin/(panel)/settings/rawg-covers/page.tsx", "utf8"), /adminCtx\("admin"\)/);
});

test("lien stable : /admin/settings/rawg-covers?titre=… ; le titre est validé côté serveur et n'est jamais écrit sans échappement", () => {
  assert.equal(A.rawgFixUrl("Hades II: Çà & là"), "/admin/settings/rawg-covers?titre=Hades%20II%3A%20%C3%87%C3%A0%20%26%20l%C3%A0");
  assert.equal(A.checkTitle("<script>alert(1)</script>"), "<script>alert(1)</script>", "le texte reste du texte");
  assert.equal(A.checkTitle("!!!"), null);
  assert.equal(A.checkTitle("x".repeat(401)), null);
  assert.equal(A.checkTitle(["a"]), null);
  const page = fs.readFileSync("src/app/admin/(panel)/settings/rawg-covers/page.tsx", "utf8");
  assert.ok(!/dangerouslySetInnerHTML/.test(page), "aucun HTML brut");
  assert.match(page, /checkTitle\(asked\)/);
});

// ── MCP ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("outils MCP : lecture accordée d'office ; l'écriture jamais ; noms de 64 caractères au plus ; mêmes garanties que l'écran", async () => {
  const tools = await rawgToolProvider.list();
  assert.deepEqual(tools.map((t) => t.name), ["rawg_covers_to_check", "rawg_cover_set"]);
  for (const t of tools) { assert.ok(t.name.length <= 64); assert.ok(t.source === "core" && t.input && t.description.length > 60); assert.ok(!/key/i.test(Object.keys(t.input.properties).join(" ")), "aucune clé dans les arguments"); }
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual([by.rawg_covers_to_check.readOnly, by.rawg_covers_to_check.default], [true, true]);
  assert.deepEqual([by.rawg_cover_set.readOnly, by.rawg_cover_set.default, by.rawg_cover_set.audited], [false, false, true]);
  assert.equal(canUse(by.rawg_covers_to_check, { scope: "read", grants: {} }), true);
  assert.equal(canUse(by.rawg_cover_set, { scope: "write", grants: {} }), false, "jamais d'office");
  assert.equal(canUse(by.rawg_cover_set, { scope: "read", grants: { rawg_cover_set: true } }), false, "plafond lecture");
  assert.equal(canUse(by.rawg_cover_set, { scope: "write", grants: { rawg_cover_set: true } }), true);

  table.playrooms = [game(11, "Astro's Playroom"), game(14, "The Playroom")];
  const actor = { name: "assistant", tokenId: "tok1" }, call = (n, a) => by[n].call(a, actor);
  await R.rawgCover("Playrooms");
  await journal();
  const list = await call("rawg_covers_to_check", {});
  assert.equal(list.total, 1);
  assert.deepEqual(Object.keys(list.items[0]).sort(), ["candidates", "checkedAt", "coverUrl", "foundGame", "rawgId", "title"]);
  assert.ok(!JSON.stringify(list).includes(KEY));
  const withCands = await call("rawg_covers_to_check", { title: "Playrooms" });
  assert.equal(withCands.candidates.length, 2);
  assert.deepEqual(Object.keys(withCands.candidates[0]).sort(), ["coverUrl", "name", "platforms", "rawgId", "year"]);
  await assert.rejects(call("rawg_covers_to_check", { title: "!!!" }), /title/);

  await assert.rejects(call("rawg_cover_set", { title: "Playrooms" }), /exactly one/);
  await assert.rejects(call("rawg_cover_set", { title: "Playrooms", none: true, rawgId: 11 }), /exactly one/);
  await assert.rejects(call("rawg_cover_set", { title: "Playrooms", rawgId: 999 }), /not among the games/);
  await assert.rejects(call("rawg_cover_set", { title: "Playrooms", imageUrl: "https://evil.example/media/a.jpg" }), /media\.rawg\.io/);
  await assert.rejects(call("rawg_cover_set", { title: "Playrooms", rawgId: 11, surprise: 1 }), /unexpected argument/);
  await assert.rejects(call("rawg_cover_set", { rawgId: 11 }), /missing required/);
  await assert.rejects(call("rawg_cover_set", { title: "x".repeat(121), none: true }), /at most 120|title/);
  const saved = await call("rawg_cover_set", { title: "Playrooms", rawgId: 11 });
  assert.deepEqual([saved.saved, saved.choice, saved.game, saved.coverUrl], [true, "game", "Astro's Playroom", img(11)]);
  assert.equal((await R.rawgCover("Playrooms")).id, 11);
  assert.equal((await call("rawg_covers_to_check", {})).total, 0, "retiré de la liste");
  assert.deepEqual(await call("rawg_cover_set", { title: "Playrooms", forget: true }), { forgotten: true, title: "Playrooms" });
  assert.equal((await call("rawg_cover_set", { title: "Sans", none: true })).choice, "none");
  const audit = (await prisma.auditLog.findMany()).map((a) => `${a.actor} ${a.action}`);
  assert.ok(audit.includes("mcp:assistant rawg.fix") && audit.includes("mcp:assistant rawg.fix.forget"), audit.join("|"));
  // cadence par jeton
  A.resetRawgRate();
  for (let i = 0; i < 60; i++) await call("rawg_cover_set", { title: `Cadence ${i}`, none: true });
  await assert.rejects(call("rawg_cover_set", { title: "Trop", none: true }), /Too many requests/);
});

// ── Textes et documents ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("i18n : toutes les clés rawgfix.* et les libellés d'audit existent en français et en anglais, avec les mêmes variables", async () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(fr).filter((k) => k.startsWith("rawgfix.") || /^audit\.action\.rawg\./.test(k));
  assert.ok(keys.length >= 60);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), `variables de ${k}`); }
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith("rawgfix.")).sort(), Object.keys(fr).filter((k) => k.startsWith("rawgfix.")).sort());
  // chaque clé utilisée par la page, l'écran et les actions existe
  const used = new Set();
  for (const f of ["src/app/admin/(panel)/settings/rawg-covers/page.tsx", "src/app/admin/(panel)/settings/rawg-covers/actions.ts", "src/app/admin/(panel)/settings/page.tsx"]) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/["'`](rawgfix\.[A-Za-z.\-${}a-z]+)["'`]/g)) used.add(m[1]);
  }
  for (const k of used) {
    if (k.includes("${")) { const prefix = k.slice(0, k.indexOf("${")); assert.ok(Object.keys(fr).some((x) => x.startsWith(prefix)), k); } else assert.ok(fr[k], k);
  }
  const { auditLabelKey } = await import("@/core/auditLabels");
  for (const a of ["rawg.fix", "rawg.fix.forget", "rawg.fix.forgetAll"]) assert.equal(auditLabelKey(a), `audit.action.${a}`);
});

test("documentation : contrat de cover, candidates, lien stable, stockage et outils MCP sont décrits", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  const modules = read("docs/MODULES.md"), platform = read("docs/PLATFORM.md"), secu = read("docs/SECURITE.md"), ia = read("docs/MAINTENANCE-IA.md");
  for (const word of ["ctx.api.rawg.candidates", "ambiguous", "/admin/settings/rawg-covers?titre=", "0.2.10"]) assert.ok(modules.includes(word), `MODULES.md : ${word}`);
  for (const word of ["rawg.fixes", "rawg_covers_to_check", "rawg_cover_set", "rawgFixes.ts"]) assert.ok(platform.includes(word), `PLATFORM.md : ${word}`);
  for (const word of ["media.rawg.io", "rawg_cover_set"]) assert.ok(secu.includes(word), `SECURITE.md : ${word}`);
  assert.ok(ia.includes("rawg_covers_to_check") && ia.includes("rawg_cover_set"), "MAINTENANCE-IA.md");
  assert.ok(read("testsupport/fakeCtx.mjs").includes("rawgCandidates"));
  assert.match(read("src/core/services/index.ts"), /ctx\.api\.rawg\.candidates/);
});
