// R33 on core screens, core 0.37.0: dashboard checklist, upkeep, AI assistants, appearance, settings, extension updates, short links, « Repris ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
const both = (k) => [fr[k], en[k]];

test("dashboard checklist: no intro sentence, no « Done » repeated on every line", () => {
  const src = read("src/components/admin/dashboard/Blocks.tsx");
  assert.ok(!src.includes("dash.setup.intro") && !src.includes("dash.setup.done"));
  for (const k of ["dash.setup.intro", "dash.setup.done"]) assert.ok(!(k in fr) && !(k in en), k);
});

test("upkeep: no sentence that says everything is fine; the bug report explanation is a « ? » bubble", () => {
  assert.ok(!("updates.modulesLink.ok" in fr) && !("updates.modulesLink.ok" in en));
  const page = read("src/app/admin/(panel)/updates/page.tsx");
  assert.ok(!page.includes("updates.modulesLink.ok"));
  assert.doesNotMatch(page, /bugReport\./, "the one bug report link lives in the sidebar footer");
  assert.match(read("src/app/admin/(panel)/layout.tsx"), /title=\{t\("bugReport\.help"\)\}/, "its explanation is an accessible title, not a sentence");
});

test("AI assistants: no reassurance sentence (a loss warning stays)", () => {
  for (const [k, bad] of [["aim.pending.help", /risqué|risky/i], ["aim.notify.emailHelp", /ni mot de passe|no password/i], ["aim.level.1.help", /sans aucun risque|no risk at all/i], ["aim.tool.health", /sans aucun secret|never any secret/i]]) {
    for (const v of both(k)) assert.doesNotMatch(v, bad, k);
  }
  assert.match(fr["aim.pending.help"], /expire/, "the expiry is a fact that matters, it stays");
  const tab = read("src/app/admin/(panel)/assistants/AccessTab.tsx");
  assert.ok(!tab.includes("team.ai.where.help"), "the title and the button already say where");
  assert.match(tab, /\{!enabled && t\("assistants\.master\.off"\)\}/, "the chip says « Allowed »; the sentence only when suspended");
});

test("appearance: the current skin is not listed twice, no « reviewed, install with confidence »", () => {
  const page = read("src/app/admin/(panel)/appearance/page.tsx");
  assert.match(page, /view\.cards\.filter\(\(c\) => !c\.active\)/);
  assert.doesNotMatch(read("src/app/admin/(panel)/appearance/SkinCards.tsx"), /appearance\.base/);
  for (const v of both("appearance.add.help")) assert.doesNotMatch(v, /relus|confiance|reviewed|confidence/i);
  assert.match(page, /view\.switchAvailable && <p className=\{ui\.help\}>/, "the light/dark explanation is not repeated when the switch is absent");
});

test("settings: the low-disk line is shown once per page, not under every upload field", () => {
  const src = read("src/components/admin/StorageLine.tsx");
  assert.match(src, /registry/);
});

test("extension updates: unchecked extensions are ONE line with the count", () => {
  const src = read("src/components/admin/ModulesUpdatesSection.tsx");
  assert.match(src, /updates\.modules\.uncheckedMany/);
  assert.ok(!/report\.unchecked\.map\(\(id\) => <li/.test(src));
  for (const v of both("updates.modules.uncheckedMany")) assert.match(v, /\{n\}/);
});

test("short link created: no filler, no exclamation mark", () => {
  for (const v of both("redirects.createdBanner")) assert.doesNotMatch(v, /!|C'est fait|Done|prêt|ready/i);
});

test("no internal word as a state: « Repris », « Reprise » (FR) and « Taken over » (EN) are gone from the language files", () => {
  assert.equal(fr["field.carried"], "Réglé dans {source}");
  assert.equal(en["field.carried"], "Set in {source}");
  const internal = /\brepris(e|es)?\b/i;
  for (const [k, v] of Object.entries(fr)) assert.doesNotMatch(v, internal, k);
  for (const [k, v] of Object.entries(en)) assert.doesNotMatch(v, /taken over|carried over/i, k);
  assert.ok((fr["field.carried"].match(/\{source\}/g) ?? []).length === (en["field.carried"].match(/\{source\}/g) ?? []).length);
});

test("module page: the OBS address is one compact fold with a copy button, no permanent box, no colon", () => {
  const src = read("src/app/admin/(panel)/instances/[id]/InstanceView.tsx");
  assert.match(src, /data-testid="overlay-address"/);
  assert.doesNotMatch(src, /\{t\("instances\.overlayUrl"\)\}:/);
  assert.match(src, /<CopyText text=\{overlayUrl\(siteUrl, instance\.key\)\}/);
  assert.equal(fr["instances.overlayUrl"], "Adresse OBS");
  assert.equal(en["instances.overlayUrl"], "OBS address");
});

test("low-disk line: one per page, the first VISIBLE upload field keeps it (a hidden tab does not)", () => {
  const src = read("src/components/admin/StorageLine.tsx");
  assert.match(src, /getClientRects\(\)\.length > 0/);
  assert.match(src, /useSyncExternalStore/);
});

test("« Settings also in » folds when more than two places; refresh and copy texts are plain", () => {
  const src = read("src/components/admin/PlacedNotice.tsx");
  assert.match(src, /links\.length > 2/);
  assert.equal(fr["refresh.waiting"], "Actualisation automatique");
  assert.equal(fr["overlays.copied"], "Copié");
  for (const L of [fr, en]) for (const k of ["refresh.waiting", "refresh.stopped", "overlays.copied"]) assert.doesNotMatch(L[k], /!/, k);
});
