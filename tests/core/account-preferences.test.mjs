// The mode (simple or advanced) and the admin theme moved from the sidebar footer to the "Preferences" of My account.
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
const PANEL = "src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "camille@example.org", name: "Camille", role: "owner", passwordHash: "x", locale: "en" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
async function account(advanced) {
  await prisma.user.update({ where: { id: owner.id }, data: { advanced } });
  as(owner);
  const mod = await import(`../../${PANEL}/account/page.tsx`);
  return renderAll(await mod.default({ searchParams: Promise.resolve({}) }));
}
const pressed = (html, group) => {
  const from = html.indexOf(`data-testid="${group}"`);
  const next = html.indexOf('data-testid="', from + 20);
  return [...html.slice(from, next).matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[2], m[1]]);
};

test("My account has the Preferences panel: mode and theme, the current choice pressed", async () => {
  let html = await account(false);
  assert.match(html, /data-testid="prefs-card"/);
  assert.match(html, />Preferences<\/h2>/);
  assert.deepEqual(pressed(html, "pref-mode"), [["Simple mode", "true"], ["Advanced mode", "false"]]);
  assert.deepEqual(pressed(html, "pref-theme").map(([l]) => l), ["Auto", "Light", "Dark"]);
  assert.equal(pressed(html, "pref-theme").filter(([, p]) => p === "true").length, 1, "exactly one theme is pressed");
  html = await account(true);
  assert.deepEqual(pressed(html, "pref-mode"), [["Simple mode", "false"], ["Advanced mode", "true"]]);
  assert.match(html, /href="\/admin\/mode"/, "link to the page that explains the difference");
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
});

test("the sidebar no longer has the mode switch or the theme buttons; the bug report link and sign out stay", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  for (const gone of ["setAdminMode", "setAdminTheme", "ADMIN_THEMES", "mode.switchToAdvanced", "mode.switchToSimple", "theme.admin", "MODE_HREF"]) assert.ok(!layout.includes(gone), `${gone} is gone from layout.tsx`);
  assert.match(layout, /BugReportLink/);
  assert.match(layout, /signOut\(/);
});

test("old addresses: the mode explainer page and both actions are still there", () => {
  assert.ok(fs.existsSync(`${PANEL}/mode/page.tsx`));
  const actions = read(`${PANEL}/mode/actions.ts`);
  assert.match(actions, /export async function setAdminMode/);
  assert.match(actions, /export async function setAdminTheme/);
});

test("each preference is a button inside its own form (works without a script), at least 44 px high, with a text label", () => {
  const src = read("src/components/admin/AdminPreferences.tsx");
  assert.match(src, /<form key=\{String\(adv\)\} action=\{setAdminMode\.bind\(null, adv\)\}>/);
  assert.match(src, /<form key=\{id\} action=\{setAdminTheme\.bind\(null, id\)\}>/);
  assert.match(src, /min-h-11/);
  assert.match(src, /aria-pressed/);
  assert.match(src, /role="group" aria-labelledby="pref-mode"/);
});

test("texts: EN and FR, short, no colon, no code word (R9, R10, R11)", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  for (const k of ["account.prefs.title", "account.prefs.mode", "account.prefs.modeHelp", "account.prefs.themeHelp"]) {
    assert.ok(en[k] && fr[k], k);
    assert.ok(!en[k].includes(":") && !fr[k].includes(":"), `${k}: no colon`);
    assert.ok(en[k].length <= 60 && fr[k].length <= 60, `${k}: 60 characters at most`);
  }
});
