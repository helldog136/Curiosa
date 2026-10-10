import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("fonctionnalités : « installé » et « ajouter » sont deux onglets d'un même endroit, avec une seule entrée de menu", () => {
  const tabs = read("src/components/admin/FeatureTabs.tsx");
  assert.match(tabs, /installed: "\/admin\/modules"/);
  assert.match(tabs, /add: "\/admin\/catalogue"/);
  assert.match(tabs, /updates: "\/admin\/modules\?tab=updates"/, "troisième onglet : les mises à jour des modules");
  assert.match(tabs, /aria-current=\{current === id \? "page" : undefined\}/);
  assert.match(read("src/app/admin/(panel)/modules/page.tsx"), /<FeatureTabs current=\{tab === "updates" \? "updates" : "installed"\}/);
  assert.match(read("src/app/admin/(panel)/catalogue/page.tsx"), /<FeatureTabs current="add"/);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /href="\/admin\/modules" also=\{\["\/admin\/catalogue"\]\}/, "le lien reste surligné dans le catalogue");
  assert.ok(!layout.includes('href="/admin/catalogue"'), "plus d'entrée de menu séparée pour le catalogue");
  assert.match(read("src/components/admin/navCurrent.ts"), /\[href, \.\.\.\(opts\.also \?\? \[\]\)\]/, "`also` reste pris en compte");
  assert.match(read("src/components/admin/NavLink.tsx"), /isCurrent\(href, path, search, \{ exact, also \}\)/);
});

test("réglages : la case « compter les visites » (et le blocage des robots d'IA) vivent dans l'onglet Confidentialité, pas sous le logo", () => {
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  const privacy = page.slice(page.indexOf('data-tab="privacy"'), page.indexOf('data-tab="appearance"'));
  assert.match(privacy, /name="statsEnabled"/);
  assert.match(privacy, /name="blockAiBots"/);
  const identity = page.slice(page.indexOf('data-tab="site"'), page.indexOf('data-tab="languages"'));
  assert.ok(!identity.includes("statsEnabled") && !identity.includes("blockAiBots"));
});

test("menu : « Modules » est la première entrée après le tableau de bord, mise en avant ; le catalogue a une recherche, ses fiches s'ouvrent en fenêtre avec un bouton d'installation animé", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.ok(layout.indexOf('href="/admin/modules"') < layout.indexOf("nav.myContent"), "Modules avant tout le reste du menu");
  assert.match(layout, /href="\/admin\/modules" also=\{\["\/admin\/catalogue"\]\} prominent/);
  assert.equal((layout.match(/href="\/admin\/modules"/g) ?? []).length, 1, "une seule entrée");
  assert.match(read("src/components/admin/NavLink.tsx"), /prominent/);
  const page = read("src/app/admin/(panel)/catalogue/page.tsx");
  assert.match(page, /<CatalogueSearch/);
  assert.match(page, /data-catalogue-item data-search=/);
  assert.match(page, /<Link href=\{`\/admin\/catalogue\/details\?id=/, "navigation douce : la fiche s'ouvre par-dessus");
  assert.match(read("src/components/admin/CatalogueSearch.tsx"), /foldText/, "sans accents ni majuscules (filtre partagé avec la page Modules)");
  assert.match(read("src/core/modules/installedList.ts"), /normalize\("NFD"\)/, "sans accents ni majuscules");
  // fiche en fenêtre : route interceptée + emplacement parallèle ; ouverte seule, la même fiche s'affiche en page entière
  assert.ok(fs.existsSync("src/app/admin/(panel)/catalogue/@modal/(.)details/page.tsx"));
  assert.ok(fs.existsSync("src/app/admin/(panel)/catalogue/@modal/default.tsx"));
  assert.match(read("src/app/admin/(panel)/catalogue/layout.tsx"), /\{children\}\{modal\}/);
  assert.match(read("src/components/admin/CatalogueModal.tsx"), /key === "Escape"/);
  const view = read("src/app/admin/(panel)/catalogue/details/DetailsView.tsx");
  assert.match(view, /data-testid="floating-install"/);
  assert.match(view, /sticky bottom-0/);
  const button = read("src/components/admin/InstallButton.tsx");
  assert.match(read("src/components/admin/animatedAction.ts"), /MIN_MS = 900/, "animation d'au moins une demi-seconde, même si l'installation est instantanée");
  assert.match(button, /installModuleAction\(id\)/);
  assert.match(read("src/components/admin/animatedAction.ts"), /Promise\.all\(\[run\(\), sleep\(minMs\)\]\)/);
});
