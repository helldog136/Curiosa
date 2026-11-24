// The redirects admin actions never write redirects themselves and never touch the redirect gate: those writes live in src/core/redirects.ts,
// which invalidates the gate (and the measure map) internally. A source scan, so a new action cannot quietly bring the old pattern back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ACTIONS = "src/app/admin/(panel)/redirects/actions.ts";
const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
/** Source without comments, so that a comment may mention the old names. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the redirects actions do not call prisma redirect writes nor invalidateRedirectGate", () => {
  const src = code(ACTIONS);
  assert.doesNotMatch(src, /invalidateRedirectGate/);
  assert.doesNotMatch(src, /redirectGate/);
  assert.doesNotMatch(src, /prisma\.redirect\.(?!find|count|aggregate|groupBy)\w+/, "reads are fine, writes belong to core/redirects.ts");
  assert.doesNotMatch(src, /prisma\.\$transaction|\btx\.redirect\./);
  assert.doesNotMatch(src, /setSetting\(/, "the measure setting is written by setMeasureEnabled");
});

test("the actions go through the writes of core/redirects.ts, which invalidate the gate themselves", () => {
  const actions = code(ACTIONS);
  for (const fn of ["setRedirectActiveRecord", "toggleRedirectActiveRecord", "reactivateRedirectRecord", "setMeasureEnabled"]) assert.match(actions, new RegExp(`\\b${fn}\\(`), fn);
  const core = code("src/core/redirects.ts");
  for (const fn of ["setRedirectActiveRecord", "toggleRedirectActiveRecord", "reactivateRedirectRecord", "setMeasureEnabled"]) {
    const m = new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}\\n`).exec(core);
    assert.ok(m, `${fn} is exported by core/redirects.ts`);
    // toggle delegates to setRedirectActiveRecord, which invalidates.
    if (fn !== "toggleRedirectActiveRecord") assert.match(m[1], /invalidateRedirectGate\(\)/, `${fn} invalidates the gate`);
  }
});

test("no page or action under src/app imports invalidateRedirectGate (it is reserved to the core)", () => {
  const offenders = walk("src/app").filter((f) => /\.(ts|tsx)$/.test(f) && /invalidateRedirectGate/.test(code(f)));
  assert.deepEqual(offenders, []);
});
