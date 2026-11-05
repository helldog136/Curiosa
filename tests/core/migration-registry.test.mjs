import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cmp, report, stillPresent } from "../../scripts/migrations-sunset.mjs";

// The migration policy (docs/MIGRATIONS.md): every one-time conversion is listed with the version that introduced it and the support floor at which its code must be gone.
const registry = JSON.parse(fs.readFileSync("src/core/updates/migrations-registry.json", "utf8"));
const floor = JSON.parse(fs.readFileSync("upgrade.json", "utf8")).minFrom;
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const V = /^\d+\.\d+\.\d+$/;

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("registry: well formed, ids unique, versions plain X.Y.Z, bridge not older than the floor", () => {
  const ids = [...registry.active, ...registry.removed].map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(registry.bridge, V);
  assert.ok(cmp(floor, registry.bridge) <= 0, "the floor cannot be newer than the published bridge");
  for (const m of registry.active) {
    assert.match(m.introducedIn, V, m.id);
    if (m.removableAtFloor === null) assert.ok(m.why, `${m.id}: a permanent entry says why`);
    else { assert.match(m.removableAtFloor, V, m.id); assert.ok(cmp(m.removableAtFloor, m.introducedIn) > 0, `${m.id}: removable after it was introduced`); }
  }
});

test("an expired migration is still present although the floor already allows deleting it -> fail", () => {
  for (const m of registry.active) {
    if (m.removableAtFloor === null || cmp(floor, m.removableAtFloor) < 0) continue;
    assert.deepEqual(stillPresent(m), [], `${m.id}: the floor (${floor}) is at or above ${m.removableAtFloor}, delete ${stillPresent(m).join(", ")} (docs/MIGRATIONS.md)`);
  }
});

test("a migration listed as present really is present (the registry does not rot)", () => {
  for (const m of registry.active) assert.ok(stillPresent(m).length > 0, `${m.id}: its code is gone, move the entry to "removed"`);
});

test("removed migrations: the floor is at least the version that made it safe, and the code is really gone", () => {
  const sources = sourceFiles("src").map((f) => [f, fs.readFileSync(f, "utf8")]);
  for (const r of registry.removed) {
    assert.ok(cmp(floor, r.removedWithFloor) >= 0, `${r.id}: upgrade.json minFrom (${floor}) must be >= ${r.removedWithFloor}`);
    for (const sym of r.absentSymbols) {
      for (const [f, text] of sources) {
        if (r.absentIn && !r.absentIn.includes(f.replaceAll("\\", "/"))) continue;
        assert.ok(!text.includes(sym), `${r.id}: "${sym}" is back in ${f}`);
      }
    }
  }
});

test("the sunset report flags what a floor raise would delete, and nothing when the floor stays", () => {
  const raised = report({ floor: "0.7.0", version, registry });
  assert.deepEqual(raised.filter((r) => r.expired).map((r) => r.id).sort(), ["menu-freeze", "rawg-handover"], "raising the floor to 0.7.0 makes these two deletable (tracked as proposal)");
  assert.equal(report({ floor, version, registry }).filter((r) => r.expired).length, 0);
});

test("every migration of the registry is documented in docs/MIGRATIONS.md", () => {
  const doc = fs.readFileSync("docs/MIGRATIONS.md", "utf8");
  for (const m of [...registry.active, ...registry.removed]) assert.ok(doc.includes(m.id), `${m.id} missing in docs/MIGRATIONS.md`);
});
