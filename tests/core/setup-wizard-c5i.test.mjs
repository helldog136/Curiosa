// C5i: the setup wizard has three screens; the optional steps live in the dashboard "Getting started" checklist; nothing of the first-run security moved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forbiddenWords, labelProblems, toneProblems } from "../../testsupport/ergonomics.mjs";

const read = (p) => fs.readFileSync(p, "utf8");
const wizard = read("src/app/admin/(auth)/setup/SetupWizard.tsx");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const A = await import("@/core/adminAccess");
const U = { id: "u", email: "etoile_nord@example.test", name: "Camille", level: "admin", roles: ["admin"], rights: new Set(["core:mcp.tokens"]), locale: null, advanced: true, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false };

test("wizard: three screens, with the budgets of R2 and R4 on each", () => {
  assert.match(wizard, /const STEPS = \["welcome", "identity", "account"\] as const/);
  const welcome = wizard.slice(wizard.indexOf('section("welcome")'), wizard.indexOf('section("identity")'));
  const identity = wizard.slice(wizard.indexOf('section("identity")'), wizard.indexOf('current === "account"'));
  const account = wizard.slice(wizard.indexOf('current === "account"'), wizard.indexOf("{state?.error &&"));
  const fields = (src) => [...src.matchAll(/\bname="(\w+)"/g)].map((m) => m[1]).filter((n) => n !== "extraLocales");
  assert.deepEqual(fields(welcome), ["ownerName", "defaultLocale"], "language and name: two fields");
  assert.deepEqual(fields(identity), ["siteName"], "site name: one field");
  assert.deepEqual(fields(account), ["ownerEmail", "ownerPassword", "ownerPasswordConfirm", "setupToken"], "e-mail and password (the install code only when the server asks for it)");
  assert.match(wizard, /needsToken && /);
});

test("wizard: the restore link and the panel are still there, and the page no longer reads the catalogue to draw the wizard", () => {
  assert.ok(wizard.includes("/api/setup/restore") && wizard.includes("/api/setup/restore/apply") && wizard.includes("RestorePanel") && wizard.includes("setup.restore.link"));
  const page = read("src/app/admin/(auth)/setup/page.tsx");
  assert.match(page, /countUsers\(\)\) > 0\) redirect\(LOGIN_HREF\)/, "once an account exists, the wizard is closed");
  assert.match(page, /needsToken=\{!!process\.env\.SETUP_TOKEN\}/);
  assert.doesNotMatch(page, /setupModules/);
});

test("first-run security is unchanged: one owner once, install code, password rules, signed in right after", () => {
  const actions = read("src/app/admin/(auth)/setup/actions.ts");
  for (const needle of ["already-configured", "safeEqual(str(\"setupToken\")", "password.length < 10", "role: \"owner\"", "signIn(\"credentials\""]) assert.ok(actions.includes(needle), needle);
  assert.match(actions, /SETUP_NEXT = `\$\{ADMIN_HREF\}\?welcome=1`/);
  assert.match(actions, /installChosenModules\(presetIds\)/, "an old form that still sends modules is served the same way");
});

test("the AI assistant page keeps its route, its gate and a row in the access table", () => {
  const rule = A.ACCESS_RULES.find((r) => r.pattern === "/admin/setup/assistant");
  assert.deepEqual(rule?.need, { right: "core:mcp.tokens" });
  assert.equal(A.canOpen(U, "/admin/setup/assistant"), true);
  assert.equal(A.canOpen({ ...U, rights: new Set() }, "/admin/setup/assistant"), false);
  assert.match(read("src/app/admin/(auth)/setup/assistant/page.tsx"), /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
});

test("checklist texts: both languages, before the colour group, plain words, short labels", () => {
  const KEYS = ["setup.stepOf", "dash.setup.modules", "dash.setup.act.modules", "dash.setup.assistant", "dash.setup.act.assistant"];
  for (const dict of [en, fr]) {
    const all = Object.keys(dict);
    for (const k of KEYS) { assert.ok(dict[k], k); assert.ok(all.indexOf(k) < all.indexOf("theme.ember"), `${k} before theme.ember`); }
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
  for (const k of KEYS) for (const dict of [en, fr]) {
    assert.deepEqual(forbiddenWords(dict[k]), [], k);
    assert.deepEqual(toneProblems(dict[k]), [], k);
    assert.deepEqual(labelProblems(dict[k]), [], k);
  }
  assert.equal(en["setup.stepOf"], "Step {n} of {total}");
  assert.equal(fr["setup.stepOf"], "Étape {n} sur {total}");
});
