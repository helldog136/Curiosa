import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const R = await import("@/core/services/rawg");
const { setSetting, getSetting } = await import("@/core/settings");
const { makeApi } = await import("@/core/modules/api");

const KEY = "cle-factice-0123456789abcdef";
const COVER = "https://media.rawg.io/media/games/abc/hades.jpg";
let calls;
let handler;
/** Réponse JSON factice de RAWG. */
const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const found = (url = COVER) => reply(200, { results: [{ name: "Hades", background_image: url }] });

beforeEach(async () => {
  await db.reset();
  R.clearRawgCache();
  calls = [];
  handler = async () => found();
  R.setRawgFetch(async (url, init) => { calls.push({ url, init }); return handler(url, init); });
});
after(() => { R.setRawgFetch(); return db.close(); });

/** Attend (sans durée fixe) qu'une condition devienne vraie : les lectures de réglages précèdent la requête. */
const until = async (cond) => { for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(cond(), "condition jamais atteinte"); };
const configure = (key = KEY) => R.saveRawgKey(key);
const instance = (moduleId = "game-suggestions") => db.prisma.moduleInstance.create({ data: { moduleId, key: `${moduleId}-1`, basePath: `${moduleId}-1` } });
const moduleKey = (inst, value) => setSetting(`instance.${inst.id}.rawgApiKey`, value);

test("sans clé : no-key, aucune requête, configured() faux", async () => {
  assert.equal(await R.isRawgConfigured(), false);
  assert.deepEqual(await R.rawgCover("Hades"), { status: "no-key", url: null });
  assert.equal(calls.length, 0);
});

test("found : l'adresse background_image du premier résultat ; la requête est en https et porte la clé, pas le résultat", async () => {
  await configure();
  handler = async () => reply(200, { results: [{ background_image: COVER }, { background_image: "https://autre.example/x.jpg" }] });
  const r = await R.rawgCover("Hades");
  assert.deepEqual(r, { status: "found", url: COVER });
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.protocol, "https:");
  assert.equal(u.hostname, "api.rawg.io");
  assert.equal(u.searchParams.get("search"), "Hades");
  assert.equal(u.searchParams.get("key"), KEY);
  assert.ok(calls[0].init.signal, "un délai est posé");
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("none : aucun résultat, premier résultat sans image, ou image non https", async () => {
  await configure();
  handler = async () => reply(200, { results: [] });
  assert.deepEqual(await R.rawgCover("Inconnu"), { status: "none", url: null });
  handler = async () => reply(200, { results: [{ background_image: null }] });
  assert.deepEqual(await R.rawgCover("Sans image"), { status: "none", url: null });
  handler = async () => reply(200, { results: [{ background_image: "http://media.rawg.io/x.jpg" }] });
  assert.deepEqual(await R.rawgCover("Http"), { status: "none", url: null }, "https seulement");
  handler = async () => reply(200, { results: [{ background_image: "javascript:alert(1)" }] });
  assert.deepEqual(await R.rawgCover("Js"), { status: "none", url: null });
  handler = async () => reply(200, "n'importe quoi");
  assert.deepEqual(await R.rawgCover("Bizarre"), { status: "none", url: null });
});

test("refused (401/403) n'est pas « aucun résultat » ; 429, 5xx, réseau et délai → unreachable ; jamais d'exception", async () => {
  await configure();
  for (const code of [401, 403]) { handler = async () => reply(code, { detail: "Invalid API key" }); assert.deepEqual(await R.rawgCover(`A${code}`), { status: "refused", url: null }); }
  for (const code of [429, 500, 503]) { handler = async () => reply(code); assert.deepEqual(await R.rawgCover(`B${code}`), { status: "unreachable", url: null }); }
  handler = async () => { throw new TypeError(`fetch failed https://api.rawg.io/api/games?key=${KEY}`); };
  assert.deepEqual(await R.rawgCover("Réseau"), { status: "unreachable", url: null });
  handler = async () => { throw new DOMException("timeout", "TimeoutError"); };
  assert.deepEqual(await R.rawgCover("Délai"), { status: "unreachable", url: null });
});

test("les refus et pannes ne sont pas mis en cache : la requête suivante réessaie", async () => {
  await configure();
  handler = async () => reply(401);
  assert.equal((await R.rawgCover("Hades")).status, "refused");
  handler = async () => found();
  assert.equal((await R.rawgCover("Hades")).status, "found");
  assert.equal(calls.length, 2);
});

test("titre nettoyé et limité ; titre vide → none sans requête", async () => {
  await configure();
  await R.rawgCover("  Half\u0000-Life \n\t 2  ");
  assert.equal(new URL(calls[0].url).searchParams.get("search"), "Half -Life 2");
  await R.rawgCover("x".repeat(500));
  assert.equal(new URL(calls[1].url).searchParams.get("search").length, 100);
  calls.length = 0;
  assert.deepEqual(await R.rawgCover("   \n "), { status: "none", url: null });
  assert.deepEqual(await R.rawgCover(undefined), { status: "none", url: null });
  assert.equal(calls.length, 0);
});

test("la clé n'apparaît ni dans les valeurs renvoyées ni dans les journaux ni dans l'audit", async () => {
  const logs = [];
  const orig = [console.error, console.warn, console.log];
  console.error = console.warn = console.log = (...a) => logs.push(a.map(String).join(" "));
  try {
    await configure();
    const results = [];
    for (const h of [() => found(), () => reply(401), () => reply(500), () => { throw new Error(`boom ${KEY}`); }]) {
      handler = async () => h();
      results.push(await R.rawgCover(`Jeu ${results.length}`), await R.checkRawgKey());
    }
    assert.ok(!JSON.stringify(results).includes(KEY));
  } finally { [console.error, console.warn, console.log] = orig; }
  assert.ok(!logs.join("\n").includes(KEY), "rien dans les journaux");
  assert.ok(!JSON.stringify(await db.prisma.auditLog.findMany()).includes(KEY));
  assert.ok(!JSON.stringify(await getSetting("rawg.status")).includes(KEY), "l'état mémorisé ne contient pas la clé");
});

test("cache : trouvé ~24 h, aucun résultat ~1 h, insensible à la casse ; deux demandes simultanées = une requête", async (t) => {
  await configure();
  t.mock.timers.enable({ apis: ["Date"] });
  await R.rawgCover("Hades");
  await R.rawgCover("  HADES ");
  assert.equal(calls.length, 1, "servi par le cache");
  t.mock.timers.tick(23 * 3_600_000);
  await R.rawgCover("hades");
  assert.equal(calls.length, 1);
  t.mock.timers.tick(2 * 3_600_000);
  await R.rawgCover("hades");
  assert.equal(calls.length, 2, "expiré après 24 h");

  handler = async () => reply(200, { results: [] });
  await R.rawgCover("Rien");
  await R.rawgCover("Rien");
  assert.equal(calls.length, 3);
  t.mock.timers.tick(61 * 60_000);
  await R.rawgCover("Rien");
  assert.equal(calls.length, 4, "« aucun résultat » expire après 1 h");

  let release;
  handler = async () => { await new Promise((r) => { release = r; }); return found(); };
  const [a, b] = [R.rawgCover("Même"), R.rawgCover("même")];
  await until(() => typeof release === "function");
  release();
  assert.deepEqual(await Promise.all([a, b]), [{ status: "found", url: COVER }, { status: "found", url: COVER }]);
  assert.equal(calls.length, 5, "une seule requête pour deux demandes identiques");
});

test("concurrence : jamais plus de 2 requêtes en même temps, et toutes sont servies", async () => {
  await configure();
  let live = 0, peak = 0;
  const gates = [];
  handler = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => gates.push(r)); live--; return found(); };
  const all = Array.from({ length: 6 }, (_, i) => R.rawgCover(`Jeu ${i}`));
  await until(() => gates.length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(gates.length, 2, "la troisième attend qu'une place se libère");
  assert.equal(live, 2);
  for (let i = 0; i < 200 && calls.length < 6; i++) { while (gates.length) gates.shift()(); await new Promise((r) => setTimeout(r, 5)); }
  while (gates.length) gates.shift()();
  const results = await Promise.all(all);
  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r.status === "found"));
  assert.equal(peak, 2);
  assert.equal(calls.length, 6);
});

test("état de la clé : mémorisé dans les réglages (ok / refusée / injoignable + date), refusée ≠ aucun résultat", async () => {
  await configure();
  assert.equal(await R.getRawgState(), null);
  await R.rawgCover("Hades");
  assert.equal((await R.getRawgState()).state, "ok");
  assert.ok(!Number.isNaN(Date.parse((await R.getRawgState()).at)));
  handler = async () => reply(403);
  assert.equal(await R.checkRawgKey(), "refused");
  assert.equal((await R.getRawgState()).state, "refused");
  handler = async () => { throw new Error("down"); };
  assert.equal(await R.checkRawgKey(), "unreachable");
  assert.equal((await R.getRawgState()).state, "unreachable");
  handler = async () => reply(200, { results: [] });
  assert.equal(await R.checkRawgKey(), "ok", "une clé valide sans résultat pour la requête de test reste valide");
  assert.equal((await R.getRawgState()).state, "ok");
  assert.ok((await db.prisma.setting.findUnique({ where: { key_locale: { key: "rawg.status", locale: "" } } })), "persistant, pas seulement en mémoire");
  await R.saveRawgKey("une-autre-cle-factice-9999");
  assert.equal(await R.getRawgState(), null, "une nouvelle clé efface l'ancien état");
});

test("checkRawgKey sans clé → no-key, sans requête", async () => {
  assert.equal(await R.checkRawgKey(), "no-key");
  assert.equal(calls.length, 0);
});

test("clé : format contrôlé ; retirer la clé la supprime", async () => {
  assert.ok(R.isValidRawgKey(KEY));
  for (const bad of ["", "court", "avec espace dans la clé", "a&b=c-12345678", "x".repeat(200)]) assert.equal(R.isValidRawgKey(bad), false, bad);
  await configure();
  assert.equal(await R.isRawgConfigured(), true);
  await R.clearRawgKey();
  assert.equal(await R.isRawgConfigured(), false);
});

// ── Reprise des clés existantes ──────────────────────────────────────────────────────────────────────────────────────
test("reprise : la clé d'une instance de module est copiée UNE fois, audit sans la valeur, valeur du module conservée", async () => {
  const inst = await instance();
  await moduleKey(inst, KEY);
  assert.equal(await R.importRawgKeyFromModules(), "imported");
  assert.equal(await getSetting("rawg.key"), KEY);
  assert.equal(await getSetting(`instance.${inst.id}.rawgApiKey`), KEY, "la valeur du module n'est pas supprimée");
  const audits = await db.prisma.auditLog.findMany({ where: { action: "settings.rawg.import" } });
  assert.equal(audits.length, 1);
  assert.ok(!JSON.stringify(audits).includes(KEY));
  // idempotent
  assert.equal(await R.importRawgKeyFromModules(), "done");
  assert.equal((await db.prisma.auditLog.count({ where: { action: "settings.rawg.import" } })), 1);
  // le cœur prend le dessus : changer la clé du module n'y change rien
  await moduleKey(inst, "cle-du-module-modifiee-1234");
  assert.equal(await R.getRawgKey(), KEY);
  await R.rawgCover("Hades");
  assert.equal(new URL(calls[0].url).searchParams.get("key"), KEY);
});

test("reprise : le service la fait aussi tout seul au premier usage ; planning aussi ; un réglage vide est ignoré", async () => {
  const empty = await instance("game-suggestions");
  await moduleKey(empty, "   ");
  const planning = await db.prisma.moduleInstance.create({ data: { moduleId: "planning", key: "planning", basePath: "planning" } });
  await moduleKey(planning, KEY);
  assert.equal(await R.isRawgConfigured(), true);
  assert.equal(await getSetting("rawg.key"), KEY);
});

test("reprise : le cœur a déjà sa clé → rien n'est repris ; retirer la clé du cœur ne la fait pas revenir d'un module", async () => {
  const inst = await instance();
  await moduleKey(inst, "cle-du-module-1234567890");
  await configure();
  assert.equal(await R.importRawgKeyFromModules(), "done");
  assert.equal(await getSetting("rawg.key"), KEY);
  assert.equal(await db.prisma.auditLog.count({ where: { action: "settings.rawg.import" } }), 0);
  await R.clearRawgKey();
  assert.equal(await R.isRawgConfigured(), false);
  assert.deepEqual(await R.rawgCover("Hades"), { status: "no-key", url: null });
});

test("reprise : aucune clé nulle part → « aucune clé saisie » ; un autre module n'est pas lu", async () => {
  assert.equal(await R.importRawgKeyFromModules(), "none");
  const other = await instance("blog");
  await moduleKey(other, KEY);
  assert.equal(await R.importRawgKeyFromModules(), "none");
  assert.equal(await R.isRawgConfigured(), false);
  assert.equal(await R.checkRawgKey(), "no-key");
});

test("reprise : refaite après une restauration d'une ancienne sauvegarde (le repère revient avec la sauvegarde)", async () => {
  const inst = await instance();
  await moduleKey(inst, KEY);
  await R.importRawgKeyFromModules();
  await db.prisma.setting.deleteMany({ where: { key: { in: ["rawg.key", "rawg.keyImported"] } } }); // état d'une sauvegarde d'avant le service
  assert.equal(await R.importRawgKeyFromModules(), "imported");
});

// ── Exposition aux modules ───────────────────────────────────────────────────────────────────────────────────────────
const fakeInstance = { id: "i1", key: "games", moduleId: "game-suggestions", names: {} };

test("module : avec la permission rawg, ctx.api.rawg marche et ne renvoie jamais la clé", async () => {
  await configure();
  const api = makeApi(fakeInstance, "fr", ["storage", "rawg"]);
  assert.equal(await api.rawg.configured(), true);
  const r = await api.rawg.cover("Hades");
  assert.deepEqual(r, { status: "found", url: COVER });
  assert.deepEqual(Object.keys(api.rawg).sort(), ["configured", "cover"], "aucune méthode qui donne la clé");
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("module : sans la permission rawg → comme sans clé, aucune requête", async () => {
  await configure();
  for (const api of [makeApi(fakeInstance, "fr", ["storage", "mail"]), makeApi(fakeInstance, "fr", []), makeApi(fakeInstance, "fr")]) {
    assert.equal(await api.rawg.configured(), false);
    assert.deepEqual(await api.rawg.cover("Hades"), { status: "no-key", url: null });
  }
  assert.equal(calls.length, 0);
});

test("manifeste : la permission « rawg » est acceptée par le schéma ; une inconnue reste refusée ; le contexte transmet les permissions", async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const base = { apiVersion: 2, id: "demo", name: "Démo", version: "1.0.0", main: "index.mjs", icon: "star", type: "utility" };
  const ok = parseManifest({ ...base, permissions: ["rawg"] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(parseManifest({ ...base, permissions: ["rawgg"] }).ok, false);
  assert.match(fs.readFileSync("src/core/modules/context.ts", "utf8"), /makeApi\(instance, loc, mod\.manifest\.permissions\)/);
});

// ── Réglages : actions d'admin réservées au propriétaire ─────────────────────────────────────────────────────────────
test("admin : enregistrer / tester la clé sont des actions serveur réservées au propriétaire, sans clé dans les retours ni l'audit", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/settings/rawg-actions.ts", "utf8");
  assert.match(src, /^"use server";/);
  for (const name of ["saveRawg", "testRawgKey"]) assert.match(src, new RegExp(`export async function ${name}[\\s\\S]*?adminCtx\\("owner"\\)`));
  assert.ok(!/audit\([^)]*rawgKey/.test(src), "la valeur n'est jamais écrite dans l'audit");
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  assert.match(page, /isOwner && \(\s*<section data-tab="services"/, "section réservée au propriétaire");
  assert.match(page, /name="rawgKey" type="password"/, "champ masqué");
  assert.ok(!/defaultValue=\{[^}]*rawg/i.test(page), "la clé n'est jamais renvoyée au navigateur");
});

test("admin : « Tester la clé » → les quatre réponses en langage simple", async () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  assert.equal(fr["settings.rawgTestOk"], "La clé fonctionne.");
  assert.equal(fr["settings.rawgTestRefused"], "RAWG refuse cette clé.");
  assert.equal(fr["settings.rawgTestUnreachable"], "RAWG est injoignable depuis ce serveur.");
  assert.equal(fr["settings.rawgTestNoKey"], "Aucune clé saisie.");
  assert.equal(await R.checkRawgKey(), "no-key");
  await configure();
  assert.equal(await R.checkRawgKey(), "ok");
  handler = async () => reply(401);
  assert.equal(await R.checkRawgKey(), "refused");
  handler = async () => { throw new Error("réseau"); };
  assert.equal(await R.checkRawgKey(), "unreachable");
});

test("catalogue des services : « rawg » y figure ; le démarrage reprend la clé", () => {
  const idx = fs.readFileSync("src/core/services/index.ts", "utf8");
  assert.match(idx, /id: "rawg", exposedAs: "ctx\.api\.rawg\.cover/);
  assert.match(fs.readFileSync("src/instrumentation.ts", "utf8"), /importRawgKeyFromModules/);
});

test("i18n : toutes les clés rawg existent en fr et en", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = Object.keys(fr).filter((k) => /rawg|settings\.services/i.test(k));
  assert.ok(keys.length >= 20);
  for (const k of keys) assert.ok(en[k] && fr[k], k);
});
