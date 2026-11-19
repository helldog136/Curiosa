// CATALOGUE COMPACT (core 0.37.0) — the Extensions > Catalogue tab starts with the task (search + ONE compact filter), not with a wall of chips (R19, R2, R27, R32, R33).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminPageErgonomicsProblems, CHIPS_PER_GROUP_MAX } from "../../testsupport/ergonomics.mjs";

const { relativeAge } = await import("@/core/relativeTime");
const { TopicPicker } = await import("@/components/admin/TopicPicker");
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));

const options = Array.from({ length: 33 }, (_, i) => ({ id: `g${i % 5}.p${i}`, title: `Page ${i}`, group: `Group ${i % 5}`, count: 1 + (i % 3), href: `/admin/extensions/add?topic=g${i % 5}.p${i}` }));
const labels = { label: "Adds settings to", search: "Find a page", none: "No page matches.", all: "All", remove: "Remove the filter {name}", list: "Adds settings to" };
const render = (current) => renderToStaticMarkup(React.createElement(TopicPicker, { options, current, allHref: "/admin/extensions/add", labels }));

test("relative age: short, locale aware, never a raw date", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  assert.equal(relativeAge(now - 10_000, "fr", now), "maintenant");
  assert.equal(relativeAge(now - 3 * 60_000, "fr", now), "il y a 3 min");
  assert.match(relativeAge(now - 3 * 60_000, "en", now), /3 min\. ago/);
  assert.match(relativeAge(now - 5 * 3600_000, "fr", now), /5 h/);
  assert.match(relativeAge(now - 3 * 86400_000, "fr", now), /3 j/);
  assert.equal(relativeAge(null, "fr", now), "—");
});

test("33 places: ONE control (a summary), the places are links inside it, no chip wall", () => {
  const html = render(null);
  assert.equal((html.match(/data-testid="topic-picker"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="topic-g\d\.p\d+"/g) ?? []).length, 33, "every place is listed, with its count");
  assert.doesNotMatch(html, /data-testid="topic-chip"/, "nothing chosen: no chip");
  assert.match(html, /<details/, "native disclosure: it works without a script");
  assert.match(html, /type="search"/, "its own search");
  assert.match(html, /href="\/admin\/extensions\/add\?topic=g0\.p0"/, "the ?topic= address is kept");
});

test("a chosen place is a removable chip that links back to the whole catalogue", () => {
  const html = render("g1.p1");
  const chip = /<a href="([^"]*)"[^>]*data-testid="topic-chip"[^>]*aria-label="([^"]*)"/.exec(html);
  assert.ok(chip, "chip present");
  assert.equal(chip[1], "/admin/extensions/add");
  assert.equal(chip[2], "Remove the filter Page 1");
  assert.match(html, /aria-current="true"[^>]*data-testid="topic-g1\.p1"/);
});

test("catalogue page: search first, then the cards; no chip wall, no freshness sentence, one short intro", () => {
  const page = read("src/app/admin/(panel)/extensions/add/page.tsx");
  assert.ok(!/TopicFacets/.test(page));
  assert.ok(page.indexOf("<CatalogueSearch") < page.indexOf("data-catalogue-section"), "the search comes before the cards");
  assert.ok(page.indexOf("<TopicPicker") < page.indexOf("data-catalogue-section"));
  assert.match(page, /catalogue\.intro\.short/);
  assert.match(page, /relativeAge\(source\.fetchedAt/, "freshness is relative");
  assert.match(page, /title=\{new Date\(source\.fetchedAt/, "the exact time stays in the tooltip");
  assert.ok(!/catalogue\.verified/.test(page), "R14: « verified » is the default, not a label on every card");
  for (const L of [en, fr]) {
    assert.ok(L["catalogue.intro.short"].length <= 60, "the intro is one short line");
    assert.ok(!("catalogue.source.repository" in L) && !("catalogue.installNote" in L) && !("updates.modules.help" in L), "filler texts are gone");
  }
});

test("Extensions pages: the tab name is not repeated as an intro; family help is a « ? » bubble", () => {
  const updates = read("src/app/admin/(panel)/extensions/updates/page.tsx");
  assert.ok(!/intro=/.test(updates));
  const installed = read("src/app/admin/(panel)/extensions/page.tsx");
  assert.match(installed, /<HelpTip always help=\{t\(`family\.\$\{g\.type\}\.help`\)\}/);
  assert.ok(!/<p className="mt-1 text-sm text-muted">\{t\(`family/.test(installed));
});

test("kit R19: more than 10 chips in one group fail (links block, segmented field, table filter); 10 pass", () => {
  assert.equal(CHIPS_PER_GROUP_MAX, 10);
  const items = (n) => Array.from({ length: n }, (_, i) => ({ label: `Page ${i}`, href: `/x/${i}` }));
  const problems = (blocks) => adminPageErgonomicsProblems(blocks).filter((p) => p.rule === "R19");
  assert.equal(problems([{ type: "links", items: items(10) }]).length, 0);
  assert.equal(problems([{ type: "links", items: items(11) }]).length, 1);
  const opts = (n) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `V${i}` }));
  const form = (n) => ({ type: "adminForm", action: "save", submitLabel: "Enregistrer la commande", fields: [{ name: "a", label: "Choix", kind: "segmented", options: opts(n) }] });
  assert.equal(problems([form(10)]).length, 0);
  assert.equal(problems([form(12)]).length, 1);
  const table = (n) => ({ type: "table", columns: ["Nom", "Origine"], rows: Array.from({ length: 12 }, (_, i) => [`n${i}`, `o${i % n}`]), filters: [{ column: "Origine" }], searchable: true });
  assert.equal(problems([table(10)]).length, 0);
  assert.equal(problems([table(12)]).length, 1);
});
