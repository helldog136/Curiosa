// Password managers and autofill on the administration (1Password, Bitwarden, Dashlane, LastPass, Chrome, Safari). Rule: docs/FORMULAIRES-AUTHENTIFICATION.md,
// "Champs qui ne sont pas des identifiants". Reads the source (no browser). It fails when:
//  1. a raw text-like `<input>` of the administration (type absent, text, search, email, url, tel, or a computed type) carries neither the "plain input" hints
//     (`{...PLAIN_INPUT}`, `fieldHints(`, `MANAGER_IGNORE`) nor a deliberate credential `autoComplete` token (username, email, name, passwords, one-time-code, webauthn);
//  2. `TextField` stops applying the hints by default, or the hints lose one of the four managers;
//  3. the access creator (McpTokenCreator) is named or typed like an identity field, loses its hints, or stops guarding against a second submit.
// New offenders fail: there is no baseline. The only exclusion is the appearance pages (another change), listed with its reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOTS = ["src/app/admin", "src/components/admin"];
/** Excluded folders, with the reason. */
const EXCLUDED = new Map([["(panel)/appearance", "being reworked in another change; its inputs are handled there"]]);
const NON_TEXT = /^(checkbox|radio|hidden|file|range|color|submit|button|number|date|time|datetime-local|password)$/;
const CREDENTIAL = /autoComplete="(username|email|name|current-password|new-password|one-time-code|webauthn)"/;
const HINTED = /PLAIN_INPUT|fieldHints\(|MANAGER_IGNORE/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).replaceAll("\\", "/");
    if (e.isDirectory()) { if (![...EXCLUDED.keys()].some((x) => p.endsWith(x))) yield* walk(p); } else if (p.endsWith(".tsx")) yield p;
  }
}

/** The `<input …>` tags of a source (braces respected), comments skipped. */
export function inputTags(source) {
  const out = [];
  const re = /<input(?=[\s/>])/g;
  let m;
  while ((m = re.exec(source))) {
    const lineStart = source.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\*|\/\/|\/\*)/.test(source.slice(lineStart, m.index))) continue;
    let i = m.index + 6, depth = 0;
    for (; i < source.length; i++) { const c = source[i]; if (c === "{") depth++; else if (c === "}") depth--; else if (c === ">" && depth === 0) break; }
    out.push({ text: source.slice(m.index, i + 1), line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** The problems of one source: the heart of the guard, tried below on samples that are wrong on purpose. */
export function problems(rel, source) {
  const out = [];
  for (const tag of inputTags(source)) {
    const literal = tag.text.match(/\stype="([^"]+)"/)?.[1];
    if (literal && NON_TEXT.test(literal)) continue;
    if (HINTED.test(tag.text) || CREDENTIAL.test(tag.text)) continue;
    out.push(`${rel}:${tag.line} : text-like <input> without {...PLAIN_INPUT} (or a credential autoComplete token): ${tag.text.slice(0, 90).replace(/\s+/g, " ")}`);
  }
  return out;
}

test("every text-like raw <input> of the administration is a plain input (hints) or a deliberate credential field", () => {
  const found = [];
  for (const root of ROOTS) for (const f of walk(root)) found.push(...problems(f, fs.readFileSync(f, "utf8")));
  assert.deepEqual(found, [], `Spread {...PLAIN_INPUT} (src/components/admin/managerHints.ts) on these inputs, or give them a credential autoComplete token if they really are a login field:\n${found.join("\n")}`);
});

test("the guard catches what it should", () => {
  assert.equal(problems("a.tsx", '<input name="name" className="x" />').length, 1, "no hints at all");
  assert.equal(problems("a.tsx", '<input name="nick" autoComplete="off" />').length, 1, "autoComplete=off alone is not enough: the managers have their own hints");
  assert.equal(problems("a.tsx", '<input type="search" onChange={(e) => go(e.target.value)} />').length, 1, "a search box too");
  assert.equal(problems("a.tsx", "<input type={kind} />").length, 1, "a computed type too");
  assert.equal(problems("a.tsx", '<input {...PLAIN_INPUT} name="name" />').length, 0);
  assert.equal(problems("a.tsx", '<input type="email" autoComplete="username" />').length, 0, "a login field keeps its token");
  assert.equal(problems("a.tsx", '<input autoComplete="one-time-code" />').length, 0);
  assert.equal(problems("a.tsx", '<input type="checkbox" name="x" /><input type="number" />').length, 0);
  assert.equal(problems("a.tsx", '// <input name="x" />\n/** <input> */').length, 0, "comments are not inputs");
});

test("the hints cover the four managers, and TextField applies them by default (explicit credential token = no hints)", async () => {
  const { MANAGER_IGNORE, PLAIN_INPUT, fieldHints } = await import("@/components/admin/managerHints");
  for (const k of ["data-1p-ignore", "data-lpignore", "data-bwignore", "data-form-type"]) assert.ok(k in MANAGER_IGNORE, k);
  assert.equal(PLAIN_INPUT.autoComplete, "off");
  for (const t of [undefined, "off", "on", "nickname", "given-name", "email-address"]) assert.deepEqual(fieldHints(t), PLAIN_INPUT, String(t));
  for (const t of ["username", "email", "name", "current-password", "new-password", "one-time-code", "webauthn"]) assert.deepEqual(fieldHints(t), { autoComplete: t }, t);
  const { TextField } = await import("@/components/admin/Field");
  const plain = renderToStaticMarkup(React.createElement(TextField, { label: "Nick", name: "nick" }));
  assert.match(plain, /autoComplete="off"|autocomplete="off"/i); assert.match(plain, /data-1p-ignore/); assert.match(plain, /data-lpignore/); assert.match(plain, /data-bwignore/);
  const mail = renderToStaticMarkup(React.createElement(TextField, { label: "E-mail", name: "email", type: "email" }));
  assert.match(mail, /data-1p-ignore/, "an e-mail typed in a form is not the person's own login by default");
  const login = renderToStaticMarkup(React.createElement(TextField, { label: "E-mail", name: "email", type: "email", autoComplete: "username" }));
  assert.match(login, /autocomplete="username"/i); assert.doesNotMatch(login, /data-1p-ignore/);
  const code = renderToStaticMarkup(React.createElement(TextField, { label: "Code", name: "code", autoComplete: "one-time-code" }));
  assert.match(code, /autocomplete="one-time-code"/i); assert.doesNotMatch(code, /data-1p-ignore/);
});

test("the invite form: another person's first password is not offered or saved as mine", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/users/page.tsx", "utf8");
  const pw = [...page.matchAll(/<TextField name="password"[^>]*>/g)].map((m) => m[0]);
  assert.ok(pw.length >= 1);
  for (const t of pw) assert.match(t, /\bnoManager\b/, "the first password of another account carries noManager");
});

test("McpTokenCreator: plain label field, hints on the form, one submit at a time, the secret kept outside the remounted form", async () => {
  const src = fs.readFileSync("src/components/admin/McpTokenCreator.tsx", "utf8");
  const nameInput = inputTags(src).find((t) => /id="mcp-name"/.test(t.text));
  assert.ok(nameInput, "the label input exists");
  assert.match(nameInput.text, /PLAIN_INPUT/);
  assert.doesNotMatch(nameInput.text, /name="(name|username|email)"/, "not named like an identity field");
  assert.doesNotMatch(nameInput.text, /type="(email|password)"/);
  const form = src.slice(src.indexOf("<form "), src.indexOf("className=\"space-y-4\">", src.indexOf("<form ")));
  assert.match(form, /autoComplete="off"/); assert.match(form, /\{\.\.\.MANAGER_IGNORE\}/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8"), /formData\.get\("accessLabel"\)/);
  // A second submit while one runs is ignored; the form is remounted by `key`, but the created block is OUTSIDE the form and driven by the action state.
  assert.match(src, /const submit = \(data: FormData\) => \{ if \(gate\.enter\(\)\) run\(data\); \};/);
  assert.match(form, /onSubmit=\{submitKeepingValues\(submit\)\}/);
  assert.ok(src.indexOf("<CreatedAccess") < src.indexOf("<form "), "the created block renders above, not inside, the remounted form");
  const created = src.slice(src.indexOf("<CreatedAccess"), src.indexOf("<form "));
  assert.doesNotMatch(created, /<form/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie/, "the secret is never stored in the browser");

  const { CreatedAccess, McpTokenCreator } = await import("@/components/admin/McpTokenCreator");
  const labels = { name: "Name", nameHelp: "", submit: "Create", afterCreate: "", createdTitle: "Access {name} created", createdSecret: "Secret", createdUrl: "Address", createdOnce: "Shown once", copy: "Copy", copied: "Copied",
    profile: { label: "", standard: "", maintenance: "", help: "", levels: [], approval: "", approvalHuman: "", approvalDirect: "", notify: "", notifyAdmin: "", notifyEmail: "" },
    scope: { label: "Scope", help: "", read: "Read", write: "Write" }, url: { label: "By address", help: "", keyLabel: "", keyHelp: "" }, simpleGuide: { claudeTitle: "", claudeText: "", keyText: "Paste the key", warn: "" } };
  const guide = {};
  const initial = renderToStaticMarkup(React.createElement(McpTokenCreator, { action: async () => null, baseUrl: "https://site.example", labels, guide, advanced: false }));
  assert.doesNotMatch(initial, /mcp-created/, "nothing is shown before an access is created");
  assert.match(initial, /id="mcp-name"[^>]*name="accessLabel"|name="accessLabel"[^>]*id="mcp-name"/);
  assert.match(initial, /data-1p-ignore/); assert.match(initial, /data-lpignore/); assert.match(initial, /data-bwignore/);
  const shown = renderToStaticMarkup(React.createElement(CreatedAccess, { created: { name: "Camille", token: "sk-test-secret", byUrl: false }, baseUrl: "https://site.example", labels, guide, advanced: false }));
  assert.match(shown, /data-testid="mcp-created"/); assert.match(shown, /sk-test-secret/); assert.match(shown, /Access Camille created/);
  const byUrl = renderToStaticMarkup(React.createElement(CreatedAccess, { created: { name: "Camille", token: "sk-test-secret", byUrl: true }, baseUrl: "https://site.example", labels, guide, advanced: false }));
  assert.match(byUrl, /https:\/\/site\.example\/api\/mcp\/sk-test-secret/);
});

test("the single-submit gate: a second submit is refused until the action ends (also when it throws), and the action runs once", async () => {
  const { createGate } = await import("@/components/admin/singleFlight");
  const gate = createGate();
  let calls = 0; let release;
  const slow = gate.wrap(() => { calls++; return new Promise((r) => { release = r; }); });
  assert.equal(gate.enter(), true);
  const first = slow();
  assert.equal(gate.enter(), false, "double submit while running is ignored");
  assert.equal(gate.enter(), false);
  release({ created: true }); assert.deepEqual(await first, { created: true });
  assert.equal(calls, 1, "one creation");
  assert.equal(gate.busy(), false);
  assert.equal(gate.enter(), true, "ready for the next one");
  const failing = gate.wrap(async () => { throw new Error("network"); });
  await assert.rejects(failing(), /network/);
  assert.equal(gate.enter(), true, "released after a failure");
});
