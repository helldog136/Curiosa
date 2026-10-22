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
const through = (path, headers = {}) => proxy(new NextRequest(`http://127.0.0.1:4104${path}`, { headers }));
/** Ce que Next fait d'une réponse du proxy : les en-têtes de requête réécrits, repris tels quels par le passage suivant. */
const overridden = (res) => Object.fromEntries((res.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean).map((name) => [name, res.headers.get(`x-middleware-request-${name}`)]));

test("proxy : /en/privacy est réécrit vers /privacy et transmet « en » aux pages ; sans préfixe, aucune langue transmise ; un en-tête de langue venant du visiteur est ignoré", () => {
  const en = through("/en/privacy");
  assert.equal(en.headers.get("x-middleware-rewrite")?.endsWith("/privacy"), true);
  assert.equal(forwarded(en, LOCALE_HEADER), "en");
  assert.equal(forwarded(en, "x-curiosa-path"), "/privacy");
  const plain = through("/privacy", { [LOCALE_HEADER]: "en" });
  assert.equal(forwarded(plain, LOCALE_HEADER) ?? "", "", "l'en-tête inventé par le visiteur est retiré");
  assert.equal(forwarded(through("/zz/privacy"), LOCALE_HEADER) ?? "", "", "une langue inconnue n'est pas un préfixe");
});

test("BUG corrigé (0.2.6) : Next relance le proxy sur l'adresse réécrite — la langue du premier passage survit ; un visiteur ne peut pas la forger", () => {
  const first = through("/en/privacy");
  const second = through("/privacy", overridden(first));
  assert.equal(forwarded(second, LOCALE_HEADER), "en", "la langue posée au premier passage est conservée au second");
  assert.equal(forwarded(second, "x-curiosa-path"), "/privacy");
  // Forgeries : l'en-tête seul, ou avec une fausse preuve, ou avec la preuve d'ailleurs, est effacé.
  for (const headers of [{ [LOCALE_HEADER]: "en" }, { [LOCALE_HEADER]: "en", "x-curiosa-lp": "devine" }, { "x-curiosa-lp": overridden(first)["x-curiosa-lp"] }]) {
    assert.equal(forwarded(through("/privacy", headers), LOCALE_HEADER) ?? "", "", JSON.stringify(Object.keys(headers)));
  }
  assert.equal(forwarded(through("/privacy", { ...overridden(first), [LOCALE_HEADER]: "zz" }), LOCALE_HEADER) ?? "", "", "langue inconnue même avec la preuve");
  assert.equal(forwarded(through("/privacy", { ...overridden(first), "x-curiosa-lp": "autre" }), "x-curiosa-lp") ?? "", "", "la preuve n'est jamais transmise aux pages sans validité");
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
