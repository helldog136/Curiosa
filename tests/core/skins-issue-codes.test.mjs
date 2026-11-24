// Typed issue codes (messages.ts `IssueCode`): the compiler rejects a misspelt code; this test checks what the compiler cannot,
// i.e. that every code used by src/core/skins and src/core/overlays is in the table with EN + FR text, and that no code is dead.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const M = await import("@/core/skins/messages");
const R = await import("@/core/skins/readability");
const ROOT = path.join(import.meta.dirname, "../../src/core");
const read = (dir) => Object.fromEntries(fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".ts")).map((f) => [`${dir}/${f}`, fs.readFileSync(path.join(ROOT, dir, f), "utf8")]));
const skins = read("skins");
const overlays = read("overlays");
const CODE = "[a-z0-9]+(?:-[a-z0-9]+)+";

// Codes built from a template in readability.ts: `read-low-<pair>` and `probable-<field>[-mode]`.
const DYNAMIC = new Set([
  ...R.READABILITY_PAIRS.map((p) => `read-low-${p.id}`),
  ...["text", "surface", "accent", "link", "accent2"].flatMap((f) => [`probable-${f}`, `probable-${f}-mode`]),
]);

test("the table is typed: every code has a message and a hint in English and French", () => {
  assert.ok(M.ISSUE_CODES.length > 250, `${M.ISSUE_CODES.length} codes`);
  assert.equal(new Set(M.ISSUE_CODES).size, M.ISSUE_CODES.length, "duplicate code");
  for (const code of M.ISSUE_CODES) {
    const e = M.catalogEntry(code);
    assert.ok(e && e.fr.trim() && e.en.trim(), `${code}: message missing in one language`);
    if (!/^(read-low-|read-hint-|probable-)/.test(code)) assert.ok(e.hintFr.trim() && e.hintEn.trim(), `${code}: hint missing in one language`);
  }
});

test("every code used in src/core/skins exists in the table", () => {
  const known = new Set(M.ISSUE_CODES);
  const used = new Map();
  for (const [file, text] of Object.entries(skins)) {
    if (file.endsWith("/messages.ts") || file.endsWith("/allowlist.ts")) continue; // allowlist.ts: `add("border-radius")` is a property list, not an issue
    const re = new RegExp(`(?:makeIssue|catalogEntry|\\badd|\\bbad|\\bfail|\\bfatal\\([^,]+,[^,]+,|\\breport|\\brefuse|\\bpush|\\bissue|new (?:SelectorError|AtRuleError))\\(\\s*"(${CODE})"`, "g");
    for (const m of text.matchAll(re)) used.set(m[1], file);
    for (const m of text.matchAll(new RegExp(`\\? "(${CODE})" : "(${CODE})"`, "g"))) { used.set(m[1], file); used.set(m[2], file); }
  }
  assert.ok(used.size > 100, `${used.size} codes spotted`);
  const unknown = [...used].filter(([c]) => !known.has(c));
  assert.deepEqual(unknown, [], `used but not in the table: ${unknown.map(([c, f]) => `${c} (${f})`).join(", ")}`);
  for (const code of DYNAMIC) assert.ok(known.has(code), `dynamic code ${code} is not in the table`);
});

test("the overlay sheet check has its own typed code set, all of it emitted and nothing else", () => {
  const text = overlays["overlays/skinCss.ts"];
  const union = text.match(/export type OverlayCssCode =([^;]+);/);
  assert.ok(union, "OverlayCssCode type missing");
  const declared = new Set([...union[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
  const body = text.replace(union[0], "");
  const emitted = new Set();
  for (const m of body.matchAll(/(?:fail\(|code: )"([a-z-]+)"/g)) emitted.add(m[1]);
  for (const m of body.matchAll(/\? "([a-z-]+)" : "([a-z-]+)"/g)) { emitted.add(m[1]); emitted.add(m[2]); }
  assert.deepEqual([...emitted].filter((c) => !declared.has(c)).sort(), [], "emitted but not declared in OverlayCssCode");
  assert.deepEqual([...declared].filter((c) => !emitted.has(c)).sort(), [], "declared in OverlayCssCode but never emitted");
});

test("the overlay validators never name a skin code that is missing from the table", () => {
  const known = new Set(M.ISSUE_CODES);
  const validate = skins["skins/validate.ts"];
  const named = new Set([...validate.matchAll(new RegExp(`add\\(\\s*"(${CODE})"`, "g"))].map((m) => m[1]));
  for (const m of validate.matchAll(new RegExp(`add\\(i\\.code === "[a-z-]+" \\? "(${CODE})" : "(${CODE})"`, "g"))) { named.add(m[1]); named.add(m[2]); }
  const overlayOnes = [...named].filter((c) => /^(overlay|animation|scene)-/.test(c));
  assert.ok(overlayOnes.length > 20, `${overlayOnes.length} overlay codes spotted`);
  assert.deepEqual(overlayOnes.filter((c) => !known.has(c)), []);
  for (const [file, t] of Object.entries(overlays)) assert.ok(!/makeIssue\(\s*"/.test(t), `${file}: overlays must report through the validators, not build skin issues themselves`);
});

test("no dead code: every code of the table is used somewhere (dynamic families checked on their template)", () => {
  const all = Object.entries(skins).filter(([f]) => !f.endsWith("/messages.ts")).concat(Object.entries(overlays), [["app", fs.readFileSync(path.join(ROOT, "../app/admin/(panel)/appearance/actions.ts"), "utf8")]]).map(([, t]) => t).join("\n");
  const dead = M.ISSUE_CODES.filter((c) => !DYNAMIC.has(c) && !all.includes(`"${c}"`) && !all.includes(`'${c}'`));
  assert.deepEqual(dead, [], `dead codes (never emitted): ${dead.join(", ")}`);
  const readability = skins["skins/readability.ts"];
  assert.ok(readability.includes("`read-low-${pair}`") && readability.includes("`probable-text${sfx}`") && readability.includes("`probable-surface${sfx}`"), "dynamic code templates moved: update DYNAMIC");
});
