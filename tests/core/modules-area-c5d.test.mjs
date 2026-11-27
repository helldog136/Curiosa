// MODULES AREA (admin redesign C5d): installed list, catalogue (« Ajouter »), updates, fiche. The bricks (StatusPill, EmptyState), the counts, the switch for the
// installed modules and the folded « not available » group (finding F-INFO-001); every gate and capability of the area stays.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { FamilyFilter } = await import("@/components/admin/FamilyFilter");
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
const PANEL = "src/app/admin/(panel)";
const t = (k) => k.replace("family.", "");

test("installed list: each family pill and each group heading says how many modules it holds; « all » counts every module", () => {
  const html = renderToStaticMarkup(React.createElement(FamilyFilter, { t, present: ["content", "community"], current: "content", counts: { all: 7, content: 5, community: 2 } }));
  assert.match(html, /data-testid="family-all"[^>]*>extensions\.familyAll<span[^>]*>7</);
  assert.match(html, /data-testid="family-content"[^>]*>content<span[^>]*>5</);
  assert.match(html, /data-testid="family-community"[^>]*>community<span[^>]*>2</);
  assert.match(html, /min-h-11/, "touch target of 44 px (R27)");
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(FamilyFilter, { t, present: ["content"], current: null })), /nav/, "one family: nothing to choose");
  const page = read(`${PANEL}/extensions/page.tsx`);
  assert.match(page, /family-count-\$\{g\.type\}/);
  assert.match(page, /<EmptyState title=\{t\("modules\.emptyTitle"\)\} action=/, "R18: one sentence and one action, no description (R32)");
  assert.match(read(`${PANEL}/extensions/loadInstalled.ts`), /counts\.all = all\.length/);
});

test("installed card: the states that need a look are StatusPills (shape and word, never colour alone)", () => {
  const card = read("src/components/admin/ExtensionCard.tsx");
  for (const id of ["module-behind-", "module-missing-", "module-auto-", "module-kept-"]) assert.match(card, new RegExp(`<StatusPill tone="[a-z]+" testid=\\{\`${id}`));
  assert.match(card, /<InstanceState /, "the « to set up » / « error » pill and its reason stay");
  assert.match(card, /<RowMenu /, "pin / unpin stay in the row menu");
  assert.match(card, /entriesHref\(single\.key\)/, "the items shortcut stays");
});

test("catalogue (Ajouter): installable first, installed behind a switch with its count, unavailable folded; gates unchanged", () => {
  const page = read(`${PANEL}/extensions/add/page.tsx`);
  assert.match(page, /adminCtx\("admin"\)/);
  assert.match(page, /filter\(\(e\) => isOwner \|\| !e\.personal\)/, "private catalogue names stay reserved to who may install");
  assert.match(page, /const visible = showInstalled \? \[\.\.\.addable, \.\.\.alreadyThere\] : addable;/);
  assert.match(page, /<ShowInstalledSwitch /);
  assert.match(page, /<details data-catalogue-section[^>]*data-testid="catalogue-unavailable"/);
  assert.ok(!/<details[^>]*catalogue-unavailable[^>]*\bopen\b/.test(page), "the unavailable group starts folded");
  assert.match(page, /canUpdateCore = canDo\(user, "core:updates"\)/, "the link to update Curiosa is shown only to who may open that page (R35)");
  assert.match(page, /canUpdateCore && <a href=\{UPDATES_HREF\}/);
  assert.match(page, /<CatalogueSearch [^>]*countLabel=/);
  assert.match(page, /<EmptyState testid="catalogue-all-installed"/);
  assert.match(page, /isOwner && advanced && \(\s*<section/, "extra sources stay owner + advanced");
  assert.ok(!/catalogue\.verified/.test(page), "R14: « verified » is not repeated on cards");
  const sw = read("src/components/admin/ShowInstalledSwitch.tsx");
  assert.match(sw, /router\.replace\(next \? onHref : offHref/);
  assert.match(sw, /quiet/, "R37: no state word beside the switch");
});

test("catalogue search: announces « shown of total », opens a folded group that holds a hit", () => {
  const src = read("src/components/admin/CatalogueSearch.tsx");
  assert.match(src, /<ResultCount text=\{count\} \/>/);
  assert.match(src, /sec instanceof HTMLDetailsElement\) sec\.open = true/);
});

test("updates and fiche: a state is a pill; « all up to date » is one pill, not a sentence; nothing about the gates changed", () => {
  const section = read("src/components/admin/ModulesUpdatesSection.tsx");
  assert.match(section, /<StatusPill tone="ok" title=\{t\("updates\.modules\.upToDate"\)\} testid="modules-uptodate">/);
  assert.match(section, /<EmptyState testid="modules-none"/);
  assert.match(read(`${PANEL}/extensions/updates/page.tsx`), /if \(!can\(user, "core:modules\.install"\)\) redirect\(EXTENSIONS_HREF\)/);
  assert.match(read(`${PANEL}/extensions/personal/page.tsx`), /if \(!can\(user, "core:modules\.install"\)\) redirect\(EXTENSIONS_HREF\)/);
  assert.match(read("src/components/admin/ModulesUpdates.tsx"), /<StatusPill tone=\{r\.major \? "warn" : "neutral"\}>/);
  assert.match(read("src/components/admin/ExtensionFiche.tsx"), /<StatusPill tone="ok">\{t\("catalogue\.verified"\)\}/);
  assert.match(read(`${PANEL}/extensions/personal/PersonalView.tsx`), /<StatusPill tone=\{state\.tone\}>/);
  assert.match(read(`${PANEL}/modules/[id]/ModuleView.tsx`), /<StatusPill tone="warn">\{t\("modules\.updateBadge"\)\}/);
});

test("words: tabs and filters agree in gender with « module » (FR), the new keys have parity, the last key is unchanged", () => {
  assert.equal(fr["hub.tab.installed"], "Installés");
  assert.equal(fr["catalogue.filter.all"], "Tous");
  const keys = ["catalogue.installedOpen", "catalogue.updateCore", "catalogue.showInstalled", "catalogue.showInstalledAction", "catalogue.allInstalledTitle", "catalogue.unavailable"];
  for (const k of keys) { assert.ok(en[k] && fr[k], k); assert.deepEqual(en[k].match(/\{\w+\}/g), fr[k].match(/\{\w+\}/g), `${k}: same variables`); }
  assert.match(en["catalogue.showInstalled"] + fr["catalogue.showInstalled"], /\{n\}[^]*\{n\}/);
  for (const L of [en, fr]) {
    assert.equal(Object.keys(L).at(-1), "settings.contrast.accent2");
    assert.ok(!("modules.emptyHelp" in L) && !("extensions.familyEmptyHelp" in L), "descriptions under an empty state are gone (R32)");
    for (const k of keys) assert.doesNotMatch(L[k], /extension|fonctionnalit|feature|!/i);
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
});
