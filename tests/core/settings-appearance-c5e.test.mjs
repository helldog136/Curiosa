// Admin redesign C5e: Settings and Appearance. Two-to-four choices are side-by-side buttons (R19), the site tab shows five fields at most
// before "More options" (R4), explanations sit in tips (R32), every settings form saves from the one sticky bar, and the active skin is
// listed once, first, instead of in a summary card above the list (R33.7).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const { setSetting } = await import("@/core/settings");
after(() => db.close());
const PANEL = "../../src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
const settingsSrc = read("src/app/admin/(panel)/settings/page.tsx");
let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "camille@example.test", name: "Camille", role: "owner", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const render = async (file, advanced) => {
  await prisma.user.update({ where: { id: owner.id }, data: { advanced } });
  globalThis.curiosaTestSession = { user: { id: owner.id, sv: 0, role: owner.role } };
  const mod = await import(`${PANEL}/${file}`);
  return renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }));
};
const radios = (html, name) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`name="${name}"`));

test("settings: the two-option choices are side-by-side buttons, not drop-down lists (R19)", async () => {
  const html = await render("settings/page.tsx", false);
  for (const n of ["entityType", "aiTraining", "aiAnswers"]) {
    assert.equal(radios(html, n).length, 2, n);
    assert.doesNotMatch(html, new RegExp(`<select[^>]*name="${n}"`), `${n} is not a select`);
  }
  assert.doesNotMatch(settingsSrc, /<Select name="(entityType|aiTraining|aiAnswers)"/);
});

test("settings, site tab: five fields at most before 'More options'; the long presentation is folded but still sent", async () => {
  const html = await render("settings/page.tsx", false);
  const site = html.slice(html.indexOf('data-tab="site"'), html.indexOf('data-tab="languages"'));
  const open = site.replace(/<details(?![^>]*\sopen)[\s\S]*?<\/details>/g, "");
  const names = new Set([...open.matchAll(/<(input|textarea|select)\b[^>]*\sname="([^"]+)"/g)].filter((m) => !/type="hidden"|type="file"/.test(m[0])).map((m) => m[2]));
  assert.ok(names.size <= 5, `${names.size} visible fields: ${[...names].join(", ")}`);
  assert.match(site, /<details(?![^>]*\sopen)[^>]*data-more-options[\s\S]*name="site\.about__fr"/, "the presentation is under a folded group and posted with the form");
});

test("settings, advanced mode: the presentation stays in the open card", async () => {
  const html = await render("settings/page.tsx", true);
  const site = html.slice(html.indexOf('data-tab="site"'), html.indexOf('data-tab="languages"'));
  const open = site.replace(/<details(?![^>]*\sopen)[\s\S]*?<\/details>/g, "");
  assert.match(open, /name="site\.about__fr"/);
});

test("settings: explanations sit in tips, not in paragraphs under the titles (R32)", () => {
  assert.doesNotMatch(settingsSrc, /<p className=\{ui\.help\}>\{t\("settings\.(aiExplain|privacyPageHelp)"\)\}/);
  assert.match(settingsSrc, /HelpTip help=\{t\("settings\.aiExplain"\)\}/);
  assert.match(settingsSrc, /HelpTip help=\{t\("settings\.privacyPageHelp"\)\}/);
});

test("settings: the search, sound and e-mail forms use the same sticky save bar as the first form (one primary Save)", () => {
  for (const a of ["saveSettings", "saveSearch", "saveSound", "saveMail"]) assert.match(settingsSrc, new RegExp(`<ActionForm action=\\{${a}\\} floating=\\{floatingLabels\\(t\\)\\}`), a);
  assert.match(settingsSrc, /<ActionForm action=\{sendTestMail\} submitLabel/, "the test e-mail stays a separate, discreet action");
});

test("appearance: the active skin is listed once, first, marked, with Customise on its card and no summary card", async () => {
  process.env.CURIOSA_SKINS_REPO = "file:///nonexistent/curiosa-skins";
  const html = await render("appearance/page.tsx", false);
  assert.equal((html.match(/<li [^>]*data-skin-card=/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="current-skin"/g) ?? []).length, 1);
  assert.match(html, /data-skin-card="basic"[^>]*aria-current="true"/);
  assert.doesNotMatch(html, /id="current-title"|Le skin de votre site/);
  assert.match(html, /id="choose-skin"/, "the #choose-skin anchor stays");
});

test("appearance: halo and background are side-by-side buttons, the layers are folded in simple mode and open in advanced mode", async () => {
  const simple = await render("appearance/page.tsx", false);
  assert.equal(radios(simple, "glow").length, 3, "basic skin: no 'from the skin' choice");
  assert.doesNotMatch(simple, /<select[^>]*name="(glow|bgPreset)"/);
  assert.match(simple, /<details(?![^>]*\sopen)[^>]*data-more-options[\s\S]*data-testid="bg-layers"/, "folded with its summary");
  const adv = await render("appearance/page.tsx", true);
  assert.equal(radios(adv, "glow").length, 4, "four choices: still buttons");
  assert.match(adv, /<select[^>]*name="bgPreset"/, "five choices in advanced mode: a list (R19)");
  assert.doesNotMatch(adv, /<details(?![^>]*\sopen)[^>]*data-more-options[^>]*>(?:(?!<\/details>)[\s\S])*data-testid="bg-layers"/);
});

test("appearance: no description paragraph under the font and header titles; the light/dark note is a tip", () => {
  const src = read("src/app/admin/(panel)/appearance/page.tsx");
  assert.doesNotMatch(src, /t\("appearance\.font\.help"\)|t\("settings\.headerHelp"\)/);
  assert.doesNotMatch(src, /<p className=\{ui\.help\}>\{t\("settings\.layersHelp"\)/);
});
