import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { trayState, parseChoice, cookieWrites, modeFor, hasAccepted, TRAY_TEXT_KEYS, CHOICE_COOKIE } = await import("@/core/cookieTray");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { buildPrivacyPolicy } = await import("@/core/privacy");
const read = (p) => fs.readFileSync(p, "utf8");

test("bandeau : réglage inactif → ni bandeau ni lien, quels que soient les cookies", () => {
  for (const [news, choice] of [[undefined, undefined], ["1", undefined], [undefined, "no"]]) {
    assert.deepEqual(trayState({ enabled: false, newsCookie: news, choiceCookie: choice }), { enabled: false, accepted: false, showTray: false, showLink: false });
  }
});

test("bandeau : visible tant que le visiteur n'a pas répondu ; plus du tout après accord, refus ou Échap ; le lien reste", () => {
  assert.deepEqual(trayState({ enabled: true }), { enabled: true, accepted: false, showTray: true, showLink: true });
  assert.equal(trayState({ enabled: true, newsCookie: "1" }).showTray, false);
  assert.equal(trayState({ enabled: true, newsCookie: "1" }).accepted, true);
  assert.equal(trayState({ enabled: true, choiceCookie: "no" }).showTray, false);
  assert.equal(trayState({ enabled: true, choiceCookie: "later" }).showTray, false);
  assert.equal(trayState({ enabled: true, choiceCookie: "no" }).showLink, true);
  assert.equal(trayState({ enabled: true, newsCookie: "0", choiceCookie: "n'importe quoi" }).showTray, true, "valeurs inconnues ignorées");
  assert.equal(parseChoice("no"), "no"); assert.equal(parseChoice("x"), null); assert.equal(parseChoice(undefined), null);
});

test("bandeau : accepter pose curiosa_news ; refuser ne pose aucun cookie de date ; retirer efface tout", () => {
  assert.ok(cookieWrites.accept[0].startsWith("curiosa_news=1; path=/; max-age=31536000"));
  const all = (list) => list.map((c) => c.split("=")[0]);
  assert.deepEqual(all(cookieWrites.refuse), [CHOICE_COOKIE]);
  assert.ok(cookieWrites.refuse[0].includes("curiosa_cookies=no") && cookieWrites.refuse[0].includes("max-age=2592000"), "30 jours");
  assert.ok(!cookieWrites.later[0].includes("max-age"), "Échap : cookie de session");
  assert.ok(!cookieWrites.refuse.concat(cookieWrites.later).some((c) => /curiosa_(news|seen|since)/.test(c)), "un refus ne dépose rien de facultatif");
  assert.deepEqual(all(cookieWrites.withdraw), ["curiosa_news", "curiosa_seen", "curiosa_since"]);
  assert.equal(modeFor(true), "withdraw"); assert.equal(modeFor(false), "ask");
  assert.ok(hasAccepted("a=1; curiosa_news=1; b=2") && hasAccepted("curiosa_news=1") && !hasAccepted("curiosa_news=0") && !hasAccepted("xcuriosa_news=1"));
});

test("bandeau : textes en français et en anglais — les deux parties, les promesses, le lien, les deux boutons", () => {
  for (const loc of ["fr", "en"]) {
    const t = makeTranslator(loc);
    for (const k of TRAY_TEXT_KEYS) assert.ok(t(`cookies.${k}`) !== `cookies.${k}`, `${loc} : cookies.${k}`);
  }
  const fr = makeTranslator("fr");
  assert.equal(fr("cookies.accept"), "Accepter les cookies");
  assert.equal(fr("cookies.refuse"), "Non merci");
  assert.match(fr("cookies.necessaryText"), /langue/);
  assert.match(fr("cookies.optionalText"), /dernière visite/);
  assert.match(fr("cookies.promise"), /aucun suivi, aucune publicité, aucun service tiers/);
  assert.match(fr("cookies.promise"), /retirer votre accord à tout moment/);
});

test("bandeau : la politique de confidentialité décrit le cookie de choix, seulement quand le bandeau existe", () => {
  const t = makeTranslator("fr");
  const base = { siteName: "S", contactEmail: "", statsEnabled: true, features: [], extra: "", t };
  assert.ok(buildPrivacyPolicy({ ...base, newsToggle: true }).includes("curiosa_cookies"));
  assert.ok(!buildPrivacyPolicy({ ...base, newsToggle: false }).includes("curiosa_cookies"));
});

test("bandeau : accessible et fidèle à la demande (dialogue non bloquant, Échap, clavier, lien de retrait, pas de bouton cloche)", () => {
  const tray = read("src/components/site/CookieTray.tsx");
  assert.match(tray, /role="dialog" aria-modal="false"/);
  assert.match(tray, /aria-labelledby="cookie-tray-title"/);
  assert.match(tray, /e\.key !== "Escape"/);
  assert.match(tray, /type="button"/);
  assert.match(tray, /data-testid="cookie-accept"/);
  assert.match(tray, /data-testid="cookie-refuse"/);
  assert.match(tray, /data-testid="cookie-withdraw"/);
  assert.match(read("src/app/globals.css"), /@keyframes cookie-tray-in[\s\S]*translateY\(100%\)/, "monte du bas");
  assert.match(read("src/app/globals.css"), /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.match(read("src/components/site/Footer.tsx"), /config\.newsToggle && [\s\S]*CookieSettingsLink/);
  assert.match(read("src/app/(site)/privacy/page.tsx"), /config\.newsToggle && [\s\S]*CookieSettingsLink/);
  assert.ok(!read("src/components/site/Header.tsx").includes("NewsToggle"));
  assert.match(read("src/app/(site)/layout.tsx"), /tray\.enabled && <CookieTray/);
});

test("bandeau : les noms de cookies sont ceux de la dernière visite (core/visit.ts)", async () => {
  const V = await import("@/core/visit");
  assert.deepEqual(cookieWrites.withdraw.map((c) => c.split("=")[0]), [V.NEWS_COOKIE, V.SEEN_COOKIE, V.SINCE_COOKIE]);
  assert.ok(cookieWrites.accept[0].startsWith(`${V.NEWS_COOKIE}=1;`));
});
