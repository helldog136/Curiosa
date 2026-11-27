// Admin redesign C5g: the overlay pages list and the OBS addresses tab (R14, R15, R16, R17, R30, R32, R36, R37). Source-level checks of the two pages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(`src/app/admin/(panel)/overlay-pages/${f}`, "utf8");
const list = read("page.tsx"), obs = read("obs/page.tsx"), editor = read("[id]/page.tsx");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));

test("list: live search from the first page, a row switch with no state word, one row menu, a copy button, no 'turn on / off' verb button", () => {
  assert.match(list, /<LiveSearch scope="overlay-pages"/, "R15: search from the first overlay page");
  assert.match(list, /data-live-item="overlay-pages"/);
  assert.match(list, /<Switch quiet /, "R17, R37: a quiet switch");
  assert.match(list, /onToggle=\{setPageActiveAction\.bind\(null, p\.id\)\}/);
  assert.match(list, /<RowMenu label=\{t\("ovp\.rowMenu"/, "R16: the secondary actions live in the menu");
  assert.match(list, /<CopyAddress /, "the address is still copied from the row");
  assert.doesNotMatch(list, /ovp\.turnOn|ovp\.turnOff/, "no 'Turn on / Turn off' button any more");
  assert.doesNotMatch(list, /<details/, "no folded 'More actions' block per row");
  // The delete confirmation names what is lost (R24).
  for (const d of [fr, en]) assert.match(d["ovp.deleteConfirm"], /\{n\}/);
});

test("list: the rows say only what sets them apart (R14, R37): a turned-off page and a page in test mode", () => {
  assert.match(list, /\{!p\.active && <span className=\{ui\.chip\}>/);
  assert.doesNotMatch(list, /p\.active \? t\("ovp\.on"\)/, "no 'Active' label repeated on every row");
});

test("one H1 and one tab title per page (R36): the OBS tab keeps the page name, never a third 'OBS' title", () => {
  assert.match(obs, /<PageHeader title=\{t\("ovp\.title"\)\}/);
  assert.match(obs, /adminTitle\(\(\{ t \}\) => `\$\{t\("ovp\.title"\)\}, \$\{t\("ovp\.obs\.tab"\)\}`\)/);
  assert.equal("ovp.obs.title" in fr, false); assert.equal("ovp.obs.title" in en, false);
});

test("OBS tab: each row has the button that leads to what produces the address (R30), the how-to is a tooltip (R32)", () => {
  assert.match(obs, /t\("ovp\.obs\.open"\)/); assert.match(obs, /<HelpTip help=\{t\("ovp\.obs\.howHelp"\)/);
  assert.doesNotMatch(obs, /ovp\.obs\.how"/, "no visible how-to sentence");
});

test("editor: the test-mode explanation is a tooltip, no filler sentence (R32)", () => {
  assert.match(editor, /<HelpTip help=\{t\("ovp\.testHelp"\)/);
  assert.doesNotMatch(editor, /ovp\.testOff/);
});

test("the gate is untouched: every page and action keeps adminCtx(OVERLAY_NEED)", () => {
  for (const src of [list, obs, editor]) assert.match(src, /adminCtx\(OVERLAY_NEED\)/);
});
