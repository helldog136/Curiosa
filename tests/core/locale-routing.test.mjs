// Préfixe de langue /en/… : le proxy transmet la langue de l'URL, la page l'applique SI la langue est activée (réglage « i18n.enabled »), sinon retombe sur la langue par défaut.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { setSetting } = await import("@/core/settings");
const { getVisitorLocale, LOCALE_HEADER } = await import("@/core/i18n/request");
const { state } = await import("../helpers/stubs/next-headers.mjs");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");

beforeEach(async () => { await db.reset(); state.headers.clear(); state.cookies.clear(); });
after(() => db.close());

const forwarded = (res, name) => res.headers.get(`x-middleware-request-${name}`);
const through = async (path, headers = {}) => await proxy(new NextRequest(`http://127.0.0.1:4104${path}`, { headers }));
/** Ce que Next fait d'une réponse du proxy : les en-têtes de requête réécrits, repris tels quels par le passage suivant. */
const overridden = (res) => Object.fromEntries((res.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean).map((name) => [name, res.headers.get(`x-middleware-request-${name}`)]));

test("proxy : /en/privacy est réécrit vers /privacy et transmet « en » aux pages ; sans préfixe, aucune langue transmise ; un en-tête de langue venant du visiteur est ignoré", async () => {
  const en = await through("/en/privacy");
  assert.equal(en.headers.get("x-middleware-rewrite")?.endsWith("/privacy"), true);
  assert.equal(forwarded(en, LOCALE_HEADER), "en");
  assert.equal(forwarded(en, "x-curiosa-path"), "/privacy");
  const plain = await through("/privacy", { [LOCALE_HEADER]: "en" });
  assert.equal(forwarded(plain, LOCALE_HEADER) ?? "", "", "l'en-tête inventé par le visiteur est retiré");
  assert.equal(forwarded(await through("/zz/privacy"), LOCALE_HEADER) ?? "", "", "une langue inconnue n'est pas un préfixe");
});

test("BUG corrigé (0.2.6) : Next relance le proxy sur l'adresse réécrite — la langue du premier passage survit ; un visiteur ne peut pas la forger", async () => {
  const first = await through("/en/privacy");
  const second = await through("/privacy", overridden(first));
  assert.equal(forwarded(second, LOCALE_HEADER), "en", "la langue posée au premier passage est conservée au second");
  assert.equal(forwarded(second, "x-curiosa-path"), "/privacy");
  // Forgeries : l'en-tête seul, ou avec une fausse preuve, ou avec la preuve d'ailleurs, est effacé.
  for (const headers of [{ [LOCALE_HEADER]: "en" }, { [LOCALE_HEADER]: "en", "x-curiosa-lp": "devine" }, { "x-curiosa-lp": overridden(first)["x-curiosa-lp"] }]) {
    assert.equal(forwarded(await through("/privacy", headers), LOCALE_HEADER) ?? "", "", JSON.stringify(Object.keys(headers)));
  }
  assert.equal(forwarded(await through("/privacy", { ...overridden(first), [LOCALE_HEADER]: "zz" }), LOCALE_HEADER) ?? "", "", "langue inconnue même avec la preuve");
  assert.equal(forwarded(await through("/privacy", { ...overridden(first), "x-curiosa-lp": "autre" }), "x-curiosa-lp") ?? "", "", "la preuve n'est jamais transmise aux pages sans validité");
});

test("langue servie : défaut « fr », « en » ACTIVÉE → /en/… est en anglais ; « en » non activée → la langue par défaut (réglage manquant, pas un défaut du cœur)", async () => {
  await setSetting("i18n.default", "fr");
  state.headers.set(LOCALE_HEADER, "en");
  assert.equal(await getVisitorLocale(), "fr", "anglais non activé : repli sur le français");
  await setSetting("i18n.enabled", ["fr"]);
  assert.equal(await getVisitorLocale(), "fr", "liste d'activation sans « en » : idem");
  await setSetting("i18n.enabled", ["fr", "en"]);
  assert.equal(await getVisitorLocale(), "en", "anglais activé : /en/… est en anglais");
  state.headers.delete(LOCALE_HEADER);
  assert.equal(await getVisitorLocale(), "fr", "sans préfixe : langue par défaut");
});

test("la langue de l'administration (réglage « i18n.adminDefault ») ne change pas la langue des pages publiques", async () => {
  await setSetting("i18n.default", "fr");
  await setSetting("i18n.enabled", ["fr", "en"]);
  state.headers.set(LOCALE_HEADER, "en");
  for (const admin of [undefined, "fr", "en"]) {
    if (admin) await setSetting("i18n.adminDefault", admin);
    assert.equal(await getVisitorLocale(), "en", `admin=${admin}`);
  }
  state.headers.set(LOCALE_HEADER, "fr");
  assert.equal(await getVisitorLocale(), "fr");
  state.headers.delete(LOCALE_HEADER);
  assert.equal(await getVisitorLocale(), "fr");
});

test("proxy : la preuve de langue (/en/…) ET la porte 410 des liens terminés coexistent — l'un ne défait pas l'autre", async () => {
  const { prisma } = await import("@/core/db");
  const { invalidateRedirectGate } = await import("@/core/redirectGate");
  const day = 86_400_000;
  for (const data of [
    { path: "fini", targetUrl: "https://dest.example/a", expiresAt: new Date(Date.now() - day) },
    { path: "futur", targetUrl: "https://dest.example/b", expiresAt: new Date(Date.now() + day) },
    { path: "eteint", targetUrl: "https://dest.example/c", active: false, expiresAt: new Date(Date.now() - day) },
  ]) await prisma.redirect.create({ data });
  invalidateRedirectGate();
  // 1. Lien terminé, sans préfixe : détourné vers la page 410 ; la page voit le chemin d'origine.
  const gone = await through("/fini");
  assert.match(gone.headers.get("x-middleware-rewrite") ?? "", /\/api\/redirect-gone\?p=fini$/);
  assert.equal(forwarded(gone, "x-curiosa-path"), "/fini");
  // 2. Lien terminé sous /en/ : détourné aussi (410), et la langue (avec sa preuve) est transmise à la page 410.
  const goneEn = await through("/en/fini");
  assert.match(goneEn.headers.get("x-middleware-rewrite") ?? "", /\/api\/redirect-gone\?p=fini$/);
  assert.equal(forwarded(goneEn, LOCALE_HEADER), "en");
  assert.ok(forwarded(goneEn, "x-curiosa-lp"), "la preuve de langue accompagne la réécriture 410");
  assert.equal(forwarded(goneEn, "x-curiosa-path"), "/fini");
  // 3. Lien non terminé, éteint ou inconnu : aucune porte ; la preuve de langue reste exacte, /en/ → /futur et second passage garde « en ».
  for (const p of ["/futur", "/eteint", "/inconnu"]) assert.equal((await through(p)).headers.get("x-middleware-rewrite"), null, p);
  const first = await through("/en/futur");
  assert.equal(first.headers.get("x-middleware-rewrite")?.endsWith("/futur"), true);
  assert.equal(forwarded(first, LOCALE_HEADER), "en");
  const second = await through("/futur", overridden(first));
  assert.equal(forwarded(second, LOCALE_HEADER), "en", "second passage : la langue survit même avec la porte active");
  // 4. Une preuve forgée n'est pas acceptée, la porte non plus ne change pas ça ; un POST sur un lien terminé n'est pas détourné.
  assert.equal(forwarded(await through("/futur", { [LOCALE_HEADER]: "en", "x-curiosa-lp": "devine" }), LOCALE_HEADER) ?? "", "");
  const post = await proxy(new NextRequest("http://127.0.0.1:4104/fini", { method: "POST" }));
  assert.equal(post.headers.get("x-middleware-rewrite"), null);
});
