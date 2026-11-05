// "Copy" button on the Markdown code blocks: the copy helper (Clipboard API, fallback, failure), the rendering (no button without JavaScript, labels EN/FR,
// 44 px, focus, live region) and the wiring (site and admin layouts). The behaviour in a real browser is checked with Chromium screenshots (see the PR).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const { copyText, codeBlockText } = await import("@/core/copyText");
const { CodeCopyProvider, CopyButtonView, COPIED_MS } = await import("@/components/site/CodeBlock");
const { codeCopyLabels } = await import("@/components/site/codeCopyLabels");
const { Markdown } = await import("@/components/site/Markdown");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const read = (f) => fs.readFileSync(f, "utf8");

const fakeDoc = ({ copy = true } = {}) => {
  const log = { appended: [], removed: [], focused: 0 };
  const area = { value: "", readOnly: false, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, select() { log.selected = true; }, setSelectionRange() {} };
  return { log, area, doc: { body: { appendChild: (n) => log.appended.push(n), removeChild: (n) => log.removed.push(n) }, activeElement: { focus: () => { log.focused++; } }, createElement: () => area, execCommand: (c) => { log.command = c; log.copied = area.value; return copy; } } };
};

test("copy helper: the Clipboard API is used first and the text is sent as is", async () => {
  const sent = [];
  assert.equal(await copyText("line 1\nline 2", { clipboard: { writeText: async (t) => { sent.push(t); } }, document: null }), true);
  assert.deepEqual(sent, ["line 1\nline 2"]);
});

test("copy helper: when the Clipboard API is missing or refuses, a hidden textarea + execCommand copies, then cleans up and gives the focus back", async () => {
  for (const clipboard of [null, undefined, { writeText: async () => { throw new Error("NotAllowedError"); } }]) {
    const f = fakeDoc();
    assert.equal(await copyText("npm install", { clipboard, document: f.doc }), true);
    assert.equal(f.log.command, "copy");
    assert.equal(f.log.copied, "npm install");
    assert.equal(f.area.attrs["aria-hidden"], "true");
    assert.equal(f.area.style.position, "fixed");
    assert.deepEqual(f.log.removed, f.log.appended, "the textarea is removed");
    assert.equal(f.log.focused, 1, "focus restored");
  }
});

test("copy helper: failure is reported (false), never thrown", async () => {
  const f = fakeDoc({ copy: false });
  assert.equal(await copyText("x", { clipboard: null, document: f.doc }), false);
  assert.deepEqual(f.log.removed, f.log.appended);
  assert.equal(await copyText("x", { clipboard: null, document: null }), false);
  assert.equal(await copyText("x", {}), false);
  const boom = { ...fakeDoc().doc, execCommand: () => { throw new Error("denied"); } };
  assert.equal(await copyText("x", { clipboard: null, document: boom }), false);
});

test("the copied text is exactly the code: no final newline added by Markdown, line breaks normalised, inner blank lines and spaces kept", () => {
  assert.equal(codeBlockText("a\n  b\n\nc\n"), "a\n  b\n\nc");
  assert.equal(codeBlockText("a\r\nb\r\n"), "a\nb");
  assert.equal(codeBlockText(""), "");
  assert.equal(codeBlockText(null), "");
});

const labels = (L) => codeCopyLabels(makeTranslator(L));

test("labels: EN and FR, exact parity, neutral wording", () => {
  assert.deepEqual(labels("en"), { copy: "Copy", aria: "Copy this code", copied: "Copied", failed: "Copy failed: select the text and copy it" });
  assert.deepEqual(labels("fr"), { copy: "Copier", aria: "Copier ce code", copied: "Copié", failed: "Échec de la copie : sélectionnez le texte et copiez-le" });
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  for (const k of Object.keys(en).filter((x) => x.startsWith("site.code."))) assert.ok(fr[k], k);
  for (const k of Object.keys(fr).filter((x) => x.startsWith("site.code."))) assert.ok(en[k], k);
});

test("button: label and aria-label per language, 44 px target, skin part, keyboard reachable (a real button), no inline script", () => {
  for (const L of ["en", "fr"]) {
    const l = labels(L);
    const out = renderToStaticMarkup(h(CopyButtonView, { state: "idle", labels: l, onCopy: () => {} }));
    assert.match(out, /<button type="button"/);
    assert.ok(out.includes(`aria-label="${l.aria}"`));
    assert.ok(out.includes(`>${l.copy}</button>`));
    assert.match(out, /min-h-target/, "44 px target token");
    assert.match(out, /data-skin-part="copy-code"/);
    assert.doesNotMatch(out, /tabindex|<script|onclick/i);
    assert.match(out, /role="status" aria-live="polite"[^>]*class="sr-only"/, "live region, silent when idle");
  }
});

test("button states: Copied (announced politely) and the plain visible failure message", () => {
  const l = labels("fr");
  const done = renderToStaticMarkup(h(CopyButtonView, { state: "copied", labels: l, onCopy: () => {} }));
  assert.ok(done.includes(`>${l.copied}</button>`));
  assert.match(done, /aria-live="polite"[^>]*class="sr-only">Copié</);
  const bad = renderToStaticMarkup(h(CopyButtonView, { state: "failed", labels: l, onCopy: () => {} }));
  assert.match(bad, /aria-live="polite"[^>]*class="mt-1 text-sm text-fg">Échec de la copie/, "visible, not sr-only");
  assert.ok(bad.includes(`>${l.copy}</button>`), "the button stays usable");
  assert.equal(COPIED_MS, 2000);
});

test("without JavaScript (server render): the code is a plain readable <pre>, no button, no script; every fenced block is wrapped the same way", () => {
  const text = "Intro\n\n```\nfirst block\n```\n\nand\n\n```bash\nnpm i\nnpm test\n```\n\nInline `code` stays inline.";
  const out = renderToStaticMarkup(h(CodeCopyProvider, { labels: labels("en") }, h(Markdown, { text })));
  assert.equal((out.match(/<pre /g) ?? []).length, 2);
  assert.equal((out.match(/<div class="relative mt-4"><pre data-skin-part="code-block"/g) ?? []).length, 2);
  assert.doesNotMatch(out, /<button|<script|copy-code/);
  assert.match(out, /<code[^>]*>first block\n<\/code>/);
  assert.match(out, /pe-14/, "room for the button at the end of the first lines");
  assert.match(out, /min-h-\[3\.75rem\]/, "a one-line block is tall enough for the 44 px button");
  assert.match(out, /overflow-x-auto/, "long lines scroll inside the block");
  assert.match(out, /<code data-skin-part="code" class="[^"]*">code<\/code>/, "inline code has no block wrapper");
});

test("without a provider (page outside the site and admin layouts) the block is as before: no padding for a button that is not there", () => {
  const out = renderToStaticMarkup(h(Markdown, { text: "```\nx\n```" }));
  assert.match(out, /<pre data-skin-part="code-block"/);
  assert.doesNotMatch(out, /pe-14|<button/);
});

test("wiring: Markdown uses CodeBlock; the site and the admin layouts give the translated labels", () => {
  assert.match(read("src/components/site/Markdown.tsx"), /<CodeBlock /);
  assert.match(read("src/app/(site)/layout.tsx"), /<CodeCopyProvider labels=\{codeCopyLabels\(t\)\}>/);
  assert.match(read("src/app/admin/(panel)/layout.tsx"), /<CodeCopyProvider labels=\{codeCopyLabels\(t\)\}>/);
  const block = read("src/components/site/CodeBlock.tsx");
  assert.match(block, /^"use client"/);
  assert.doesNotMatch(block, /dangerouslySetInnerHTML|<script|innerHTML/);
});
