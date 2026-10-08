import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("fonctionnalités : « installé » et « ajouter » sont deux onglets d'un même endroit, avec une seule entrée de menu", () => {
  const tabs = read("src/components/admin/FeatureTabs.tsx");
  assert.match(tabs, /href="\/admin\/modules"|"installed", "\/admin\/modules"/);
  assert.match(tabs, /"add", "\/admin\/catalogue"/);
  assert.match(tabs, /aria-current=\{current === id \? "page" : undefined\}/);
  assert.match(read("src/app/admin/(panel)/modules/page.tsx"), /<FeatureTabs current="installed"/);
  assert.match(read("src/app/admin/(panel)/catalogue/page.tsx"), /<FeatureTabs current="add"/);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /href="\/admin\/modules" also=\{\["\/admin\/catalogue"\]\}/, "le lien reste surligné dans le catalogue");
  assert.ok(!layout.includes('href="/admin/catalogue"'), "plus d'entrée de menu séparée pour le catalogue");
  assert.match(read("src/components/admin/NavLink.tsx"), /\[base, \.\.\.also\]/);
});

test("réglages : la case « compter les visites » (et le blocage des robots d'IA) vivent dans l'onglet Confidentialité, pas sous le logo", () => {
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  const privacy = page.slice(page.indexOf('data-tab="privacy"'), page.indexOf('data-tab="appearance"'));
  assert.match(privacy, /name="statsEnabled"/);
  assert.match(privacy, /name="blockAiBots"/);
  const identity = page.slice(page.indexOf('data-tab="site"'), page.indexOf('data-tab="languages"'));
  assert.ok(!identity.includes("statsEnabled") && !identity.includes("blockAiBots"));
});
