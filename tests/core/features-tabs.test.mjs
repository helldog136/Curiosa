import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("fonctionnalités : « installé » et « ajouter » sont deux onglets d'un même endroit, avec une seule entrée de menu", () => {
  const tabs = read("src/components/admin/FeatureTabs.tsx");
  assert.match(tabs, /installed: EXTENSIONS_HREF/);
  assert.match(tabs, /add: EXTENSIONS_ADD_HREF/);
  assert.match(tabs, /updates: EXTENSIONS_UPDATES_HREF/, "troisième onglet : les mises à jour des modules");
  const links = read("src/core/modules/extensionsLinks.ts");
  assert.match(links, /EXTENSIONS_HREF = "\/admin\/extensions"/);
  assert.match(links, /EXTENSIONS_ADD_HREF = "\/admin\/extensions\/add"/);
  assert.match(links, /EXTENSIONS_UPDATES_HREF = "\/admin\/extensions\/updates"/);
  assert.match(tabs, /aria-current=\{current === id \? "page" : undefined\}/);
  assert.match(read("src/app/admin/(panel)/extensions/page.tsx"), /<ExtensionsHeader[^>]*current="installed"/);
  assert.match(read("src/app/admin/(panel)/extensions/updates/page.tsx"), /<ExtensionsHeader[^>]*current="updates"/);
  assert.match(read("src/app/admin/(panel)/extensions/add/page.tsx"), /<ExtensionsHeader[^>]*current="add"/);
  assert.match(read("src/components/admin/ExtensionsHeader.tsx"), /<FeatureTabs current=\{current\}/);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /href=\{EXTENSIONS_HREF\} also=\{\["\/admin\/modules"/, "le lien reste surligné dans les trois onglets (préfixe /admin/extensions)");
  assert.ok(!layout.includes('href="/admin/catalogue"'), "plus d'entrée de menu séparée pour le catalogue");
  assert.match(read("src/components/admin/navCurrent.ts"), /\[href, \.\.\.\(opts\.also \?\? \[\]\)\]/, "`also` reste pris en compte");
  assert.match(read("src/components/admin/NavLink.tsx"), /isCurrent\(href, path, search, \{ exact, also \}\)/);
});

test("réglages : la case « compter les visites » (et le blocage des robots d'IA) vivent dans l'onglet Confidentialité, pas sous le logo", () => {
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  const privacy = page.slice(page.indexOf('data-tab="privacy"'), page.indexOf('data-tab="appearance"'));
  assert.match(privacy, /name="statsEnabled"/);
  assert.match(privacy, /name="aiTraining"/);
  assert.match(privacy, /name="aiAnswers"/);
  assert.match(privacy, /name="llmsTxt"/);
  const identity = page.slice(page.indexOf('data-tab="site"'), page.indexOf('data-tab="languages"'));
  assert.ok(!identity.includes("statsEnabled") && !identity.includes("aiAnswers"));
});

test("menu : « Modules » n'est plus en haut ni en surbrillance ; le catalogue a une recherche, ses fiches s'ouvrent en fenêtre avec un bouton d'installation animé", () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.ok(layout.indexOf("EXTENSIONS_HREF}") > layout.indexOf("nav.admin"), "Extensions est dans Administration, après le contenu et le site");
  assert.equal((layout.match(/href=\{EXTENSIONS_HREF\}/g) ?? []).length, 1, "une seule entrée");
  assert.ok(!/prominent/.test(read("src/components/admin/NavLink.tsx")), "aucune entrée en surbrillance permanente");
  const page = read("src/app/admin/(panel)/extensions/add/page.tsx");
  assert.match(page, /<CatalogueSearch/);
  assert.match(page, /data-catalogue-item data-search=/);
  assert.match(page, /<Link href=\{`\/admin\/extensions\/add\/details\?id=/, "navigation douce : la fiche s'ouvre par-dessus");
  assert.match(read("src/components/admin/CatalogueSearch.tsx"), /foldText/, "sans accents ni majuscules (filtre partagé avec la page Modules)");
  assert.match(read("src/core/modules/installedList.ts"), /normalize\("NFD"\)/, "sans accents ni majuscules");
  // fiche en fenêtre : route interceptée + emplacement parallèle ; ouverte seule, la même fiche s'affiche en page entière
  assert.ok(fs.existsSync("src/app/admin/(panel)/extensions/add/@modal/(.)details/page.tsx"));
  assert.ok(fs.existsSync("src/app/admin/(panel)/extensions/add/@modal/default.tsx"));
  assert.match(read("src/app/admin/(panel)/extensions/add/layout.tsx"), /\{children\}\{modal\}/);
  assert.match(read("src/components/admin/RouteModal.tsx"), /key === "Escape"/);
  const view = read("src/app/admin/(panel)/extensions/add/details/DetailsView.tsx");
  assert.match(view, /data-testid="floating-install"/);
  assert.match(view, /sticky bottom-0/);
  const button = read("src/components/admin/InstallButton.tsx");
  assert.match(read("src/components/admin/animatedAction.ts"), /MIN_MS = 900/, "animation d'au moins une demi-seconde, même si l'installation est instantanée");
  assert.match(button, /installModuleAction\(id\)/);
  assert.match(read("src/components/admin/animatedAction.ts"), /Promise\.all\(\[run\(\), sleep\(minMs\)\]\)/);
});
