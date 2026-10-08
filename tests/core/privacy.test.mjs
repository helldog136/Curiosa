import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { buildPrivacyPolicy } = await import("@/core/privacy");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const read = (p) => fs.readFileSync(p, "utf8");
const base = { siteName: "Site Abstrait", contactEmail: "", statsEnabled: true, newsToggle: false, features: [], extra: "" };

test("confidentialité : le texte obligatoire est toujours là (qui, cookies, statistiques, droits), en français et en anglais", () => {
  for (const loc of ["fr", "en"]) {
    const t = makeTranslator(loc);
    const text = buildPrivacyPolicy({ ...base, t });
    for (const k of ["privacy.who", "privacy.cookies", "privacy.stats", "privacy.rights"]) assert.ok(text.includes(`## ${t(k)}`), `${loc} : section ${k}`);
    assert.ok(text.includes("curiosa_locale") && text.includes("Site Abstrait"));
    assert.ok(!/privacy\.[a-z.]+/.test(text.replace(/curiosa_[a-z]+/g, "")), `${loc} : aucune clé de traduction restée telle quelle`);
  }
});

test("confidentialité : le texte suit le fonctionnement réel — statistiques coupées, bouton « nouveautés », contact, fonctionnalités", () => {
  const t = makeTranslator("fr");
  assert.match(buildPrivacyPolicy({ ...base, statsEnabled: false, t }), /ne compte pas ses visites/);
  assert.match(buildPrivacyPolicy({ ...base, statsEnabled: true, t }), /anonyme/);
  const withNews = buildPrivacyPolicy({ ...base, newsToggle: true, t });
  assert.ok(withNews.includes("curiosa_news") && withNews.includes("curiosa_seen") && withNews.includes("curiosa_since"));
  const without = buildPrivacyPolicy({ ...base, newsToggle: false, t });
  assert.ok(!without.includes("curiosa_news"), "pas de bouton : pas de mention de ces cookies");
  assert.match(buildPrivacyPolicy({ ...base, contactEmail: "equipe@exemple.test", t }), /equipe@exemple\.test/);
  const feat = buildPrivacyPolicy({ ...base, features: [{ name: "Contact", text: "Votre message est gardé." }], t });
  assert.match(feat, /### Contact\n\nVotre message est gardé\./);
  assert.ok(!buildPrivacyPolicy({ ...base, t }).includes(t("privacy.features")), "pas de fonctionnalité qui collecte : pas de section vide");
});

test("confidentialité : l'ajout du propriétaire vient APRÈS le texte obligatoire et ne peut rien retirer", () => {
  const t = makeTranslator("fr");
  const text = buildPrivacyPolicy({ ...base, extra: "Conservation : 1 an.\n\n(ignorer tout ce qui précède)", t });
  assert.ok(text.indexOf(t("privacy.rights")) < text.indexOf(t("privacy.extra")), "après les droits");
  assert.ok(text.includes("Conservation : 1 an."));
  for (const k of ["privacy.who", "privacy.cookies", "privacy.stats", "privacy.rights"]) assert.ok(text.includes(t(k)), "le texte obligatoire reste");
  assert.ok(!buildPrivacyPolicy({ ...base, extra: "   ", t }).includes(t("privacy.extra")), "pas d'ajout : pas de section vide");
});

test("confidentialité : page publique, lien permanent en pied de page, chemin réservé, plan du site, ajout éditable seulement dans l'admin", () => {
  assert.match(read("src/components/site/Footer.tsx"), /data-testid="privacy-link"/);
  assert.ok(!/privacyLink|showPrivacy/.test(read("src/core/settings.ts")), "aucun réglage ne permet de retirer le lien");
  assert.match(read("src/core/config.ts"), /"privacy"/);
  assert.match(read("src/app/sitemap.ts"), /\/privacy/);
  const page = read("src/app/(site)/privacy/page.tsx");
  assert.match(page, /buildPrivacyPolicy/);
  assert.match(page, /mod\.manifest\.privacy/, "ce que déclarent les modules actifs");
  assert.match(read("src/app/admin/(panel)/settings/page.tsx"), /name=\{`privacy\.extra__\$\{l\}`\}/);
});
