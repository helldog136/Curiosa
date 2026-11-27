// C5j: the account page and the signed-out pages. Presentation only: these tests also pin what must NOT change (the actions, the gates, the autocomplete tokens).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { prisma } = db;
const { setSetting } = await import("@/core/settings");
const { makeTranslator } = await import("@/core/i18n/dictionary");
after(() => db.close());

const AUTH = "src/app/admin/(auth)";
const PANEL = "src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
const PUBLIC_PAGES = ["login", "forgot-password", "invitation", "reset-password", "choose-password", "no-access"];

let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "camille@example.org", name: "Camille", role: "owner", passwordHash: "x", locale: "en" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };

test("every signed-out page uses the one frame: a main landmark, one h1 that is always there, a way back to sign in where the person is signed out", () => {
  const shell = read("src/components/admin/AuthShell.tsx");
  assert.match(shell, /<main /);
  assert.equal((shell.match(/<h1/g) ?? []).length, 1);
  for (const page of PUBLIC_PAGES) {
    const src = read(`${AUTH}/${page}/page.tsx`);
    assert.match(src, /<AuthShell /, `${page} uses AuthShell`);
    assert.ok(!/<h1|<main /.test(src), `${page} draws no title or landmark of its own`);
  }
  for (const f of ["InviteAccept", "ResetPasswordForm"]) assert.ok(!/<h1/.test(read(`src/components/admin/${f}.tsx`)), `${f} leaves the title to the frame (it is there while the link is checked and when it fails)`);
  for (const page of ["forgot-password", "invitation", "reset-password"]) assert.match(read(`${AUTH}/${page}/page.tsx`), /backLabel=/, `${page} says how to go back to sign in`);
  for (const page of ["choose-password", "no-access"]) assert.ok(!/backLabel=/.test(read(`${AUTH}/${page}/page.tsx`)), `${page}: the person is signed in, so no link to sign in`);
});

test("the invitation, reset-link and login pages render one h1 and keep their test ids, before and while the link is checked", async () => {
  as(null);
  for (const [page, id] of [["invitation", "invitation"], ["reset-password", "reset-password"], ["login", "login"]]) {
    const mod = await import(`../../${AUTH}/${page}/page.tsx`);
    const html = renderToStaticMarkup(await mod.default({ searchParams: Promise.resolve({}) }));
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page}: one h1`);
    assert.match(html, new RegExp(`<main [^>]*data-testid="${id}"`));
  }
  const html = renderToStaticMarkup(await (await import(`../../${AUTH}/login/page.tsx`)).default({ searchParams: Promise.resolve({ changed: "1" }) }));
  assert.match(html, /data-testid="login-changed"/);
});

test("security notes: the sign-in, reset, invitation and password actions and the credential fields keep their tokens", () => {
  // autocomplete tokens (docs/FORMULAIRES-AUTHENTIFICATION.md): unchanged by the redesign
  const login = read("src/components/admin/LoginForm.tsx");
  assert.match(login, /autoComplete="username"/); assert.match(login, /autoComplete="current-password"/); assert.match(login, /autoComplete="one-time-code"/);
  assert.match(login, /method="post"/);
  assert.ok(!/onPaste|onCopy|onDrop|readOnly/.test(login));
  for (const f of ["InviteAccept", "ResetPasswordForm"]) {
    const src = read(`src/components/admin/${f}.tsx`);
    assert.equal((src.match(/autoComplete="new-password"/g) ?? []).length, 2, `${f}: both password fields are new-password`);
    assert.ok(!/noManager/.test(src), `${f}: the person's own password is offered to the manager`);
    assert.match(src, /name="token"/, "the token still travels in the form body");
  }
  assert.match(read(`${AUTH}/choose-password/page.tsx`), /<UsernameHint value=\{user\.email\}/);
  // the pages keep their gates
  assert.match(read(`${AUTH}/choose-password/page.tsx`), /adminCtx\("member", \{ allowForced: true, allowUnenrolled: true \}\)/);
  assert.match(read(`${PANEL}/account/page.tsx`), /adminCtx\("member", \{ allowUnenrolled: true \}\)/);
  assert.match(read(`${AUTH}/no-access/page.tsx`), /if \(isMember\(user\)\) redirect\(ADMIN_HREF\)/);
  assert.match(read(`${AUTH}/forgot-password/page.tsx`), /if \(!\(await isMailConfigured\(\)\.catch\(\(\) => false\)\)\) redirect\(LOGIN_HREF\)/);
  // the shell reads nothing and holds no secret
  const shell = read("src/components/admin/AuthShell.tsx");
  assert.ok(!/prisma|getSetting|cookies|headers\(|token|password/i.test(shell.replace(/\/\*\*[^]*?\*\//g, "")), "the frame is markup only");
});

test("my account: a jump list in page order, every link lands on a section that exists, one h1", async () => {
  as(owner);
  const mod = await import(`../../${PANEL}/account/page.tsx`);
  const { renderToPipeableStream } = await import("react-dom/server");
  const { Writable } = await import("node:stream");
  const html = await new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
    mod.default({ searchParams: Promise.resolve({}) }).then((el) => { const s = renderToPipeableStream(el, { onAllReady() { s.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject }); }, reject);
  });
  const nav = html.slice(html.indexOf('data-testid="account-nav"'), html.indexOf("</nav>"));
  const targets = [...nav.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["profile", "prefs", "password", "security", "my-accesses", "devices"]);
  for (const id of targets) assert.match(html, new RegExp(`<section id="${id}"`), `#${id} exists`);
  const order = targets.map((id) => html.indexOf(`<section id="${id}"`));
  assert.ok(order.every((v, i) => i === 0 || v > order[i - 1]), "the sections follow the order of the jump list");
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.ok(!/>Key:</.test(html) && !/Setup code/.test(html), "no technical key label is visible before the setup starts");
});

test("two-step and passkeys panels: the label is a real label, the error is under the field of the open step and focus goes to it", () => {
  const two = read("src/components/admin/TwoFactorPanel.tsx");
  const pk = read("src/components/admin/PasskeysPanel.tsx");
  for (const [name, src] of [["TwoFactorPanel", two], ["PasskeysPanel", pk]]) {
    assert.ok(!/placeholder=\{labels\.(password|name|code)\}/.test(src), `${name}: no placeholder standing in for a label`);
    assert.match(src, /data-first-field/, `${name}: the field to correct takes the focus`);
    assert.match(src, /role="alert"/);
    assert.ok(/aria-describedby/.test(src) && /aria-invalid/.test(src), `${name}: the error is tied to the field`);
  }
  for (const id of ["twofa-regen-password", "twofa-disable-password", "twofa-disable-code"]) assert.match(two, new RegExp(`htmlFor="${id}"`));
  for (const id of ["passkey-name", "passkey-add-password", "passkey-remove-password"]) assert.match(pk, new RegExp(`htmlFor="${id}"`));
  assert.match(two, /type="submit"/);
  assert.ok(!/onPaste|onCopy|readOnly/.test(two + pk));
  assert.ok(/autoComplete="current-password"/.test(two) && /autoComplete="current-password"/.test(pk));
  for (const loc of ["en", "fr"]) assert.ok(!/^(Key|Clé)\s*:?$/i.test(JSON.parse(read(`src/locales/${loc}.json`))["account.twofa.key"]), `${loc}: the label of the setup code is not “key”`);
});

test("login: after a refusal the field to retype takes the focus and the message is tied to it", () => {
  const src = read("src/components/admin/LoginForm.tsx");
  assert.match(src, /first\.focus\(\)/);
  assert.equal((src.match(/aria-describedby=\{state\?\.error \? "login-error" : undefined\}/g) ?? []).length, 2);
  assert.match(src, /id="login-error" role="alert"/);
});

test("my AI accesses: a row names its state only when it is the exception (paused or stopped), never “Active” on every row", async () => {
  const { MyAccesses } = await import("../../src/components/admin/MyAccesses.tsx");
  const t = makeTranslator("en", "en");
  const keys = ["name", "example", "password", "level", "submit", "new", "levelReplaces", "pending", "createdTitle", "secret", "createdOnce", "copy", "copied", "connect", "active", "paused", "switchLabel", "resumeNeed", "resume", "resumeWith", "menu", "changeLevel", "saveLevel", "remove", "removeConfirm", "removeAction", "ceiling"];
  const labels = Object.fromEntries(keys.map((k) => [k, t(`myai.${k}`)]));
  const noop = async () => ({});
  const rows = [
    { id: "a", name: "Claude", level: "read", levelLabel: "Look only", state: "active", stateLabel: "Active" },
    { id: "b", name: "Upkeep", level: "maintenance", levelLabel: "Site upkeep", state: "paused", stateLabel: "Paused" },
  ];
  const html = renderToStaticMarkup(React.createElement(MyAccesses, { rows, levels: [], canCreate: false, create: noop, pause: noop, resume: noop, remove: noop, setLevel: noop, labels }));
  assert.equal((html.match(/data-testid="my-access-state"/g) ?? []).length, 1, "only the paused row carries a state word");
  assert.match(html, /aria-checked="true"[^]*aria-checked="false"/, "the switch still shows every state");
});

test("the mode page keeps its reassurance as a tooltip, not as a sentence under the cards (R32)", () => {
  const src = read(`${PANEL}/mode/page.tsx`);
  assert.match(src, /<HelpTip help=\{t\("mode\.page\.safe"\)\}/);
  assert.ok(!/<p [^>]*>\{t\("mode\.page\.safe"\)\}<\/p>/.test(src));
  assert.match(src, /setAdminMode\.bind\(null, isAdvanced\)/, "the buttons still call the same action");
});
