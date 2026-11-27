// C5l: the Home and menu tabs: one purpose line, the short path of the link and button, the link to Accounts and connections.
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
const { RedirectError } = await import("next/navigation");
const L = await import("@/core/adminLinks");
const { setSetting } = await import("@/core/settings");

after(() => db.close());
const PANEL = "src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en", "fr"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "camille@example.org", name: "Camille", role: "owner", passwordHash: "x", locale: "en" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
async function render(file, props = {}) {
  as(owner);
  const mod = await import(`../../${PANEL}/${file}`);
  try { return await renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}), ...props })); }
  catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}
test("every tab shows one line that says what it is for, no emoji in the title, and the tab name only for screen readers", async () => {
  for (const file of ["home/page.tsx", "navigation/page.tsx", "navigation/header/page.tsx", "social/page.tsx"]) {
    const html = await render(file);
    assert.equal((html.match(/data-testid="homemenu-purpose"/g) ?? []).length, 1, `${file}: one purpose line`);
    assert.ok(!html.includes("🏠"), `${file}: no emoji in the title`);
    assert.equal((html.match(/<h2 class="sr-only">/g) ?? []).length, 1, `${file}: tab name as a hidden heading`);
  }
});

test("link and button: two fields per item on the short path, the other languages are folded in the same form", async () => {
  const html = await render("navigation/header/page.tsx");
  for (const id of ["secondary", "button"]) {
    const card = html.split(`data-testid="header-${id}"`)[1].split("</section>")[0];
    const visible = card.replace(/<details[^]*?<\/details>/g, "");
    assert.equal((visible.match(/<input /g) ?? []).length, 2, `${id}: text and address`);
    assert.match(card, /<details/);
    assert.ok(card.includes(`name="header.${id === "secondary" ? "secondaryLabel" : "buttonLabel"}__fr"`), `${id}: French text is still in the form`);
    assert.ok(card.includes(`name="header.${id === "secondary" ? "secondaryLabel" : "buttonLabel"}__en"`), `${id}: English text`);
  }
  assert.match(html, /For example: \/contact/);
  assert.match(read(`${PANEL}/navigation/header/page.tsx`), /submitLabel=\{t\("homemenu\.header\.save"\)\}/, "a precise verb on the one main button (R3)");
});

test("social buttons: the page links to Accounts and connections", async () => {
  const html = await render("social/page.tsx");
  assert.match(html, /<a [^>]*href="\/admin\/networks"[^>]*data-testid="social-accounts-link"|<a [^>]*data-testid="social-accounts-link"[^>]*href="\/admin\/networks"/);
});

test("home page: the long explanation is not written on the page", () => {
  const p = read(`${PANEL}/home/page.tsx`);
  assert.ok(!/ui\.help/.test(p), "no help paragraph under the builder");
  assert.match(p, /more=\{advanced \?/);
});
