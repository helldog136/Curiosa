#!/usr/bin/env node
// Release check for the migration policy (docs/MIGRATIONS.md).
//   node scripts/migrations-sunset.mjs                  list every migration with its age and when it can go
//   node scripts/migrations-sunset.mjs --floor 0.7.0    which migrations disappear if the support floor (upgrade.json minFrom) is raised to 0.7.0
//   node scripts/migrations-sunset.mjs --check          exit 1 if a migration is still present although the floor (or --floor) already allows deleting it
//   --max-age N  warn (exit 1 with --strict) when a migration is older than N minor releases (default 3)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(name);
const parts = (v) => String(v).split(".").map(Number);
export const cmp = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
const minorsBetween = (a, b) => { const x = parts(a), y = parts(b); return (y[0] - x[0]) * 100 + (y[1] - x[1]); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out); else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Does the code still exist? Files by path, symbols by a search of src/. */
export function stillPresent(entry, sources = walk("src").map((f) => [f, read(f)])) {
  const found = [];
  for (const f of entry.present?.files ?? []) if (fs.existsSync(path.join(root, f))) found.push(f);
  for (const s of entry.present?.symbols ?? []) if (sources.some(([, text]) => text.includes(s))) found.push(`symbol ${s}`);
  return found;
}

export function report({ floor, version, registry, maxAge = 3 }) {
  const rows = registry.active.map((m) => {
    const present = stillPresent(m);
    const canGo = m.removableAtFloor !== null && cmp(floor, m.removableAtFloor) >= 0;
    const age = minorsBetween(m.introducedIn, version);
    return { id: m.id, introducedIn: m.introducedIn, removableAtFloor: m.removableAtFloor, present, expired: canGo && present.length > 0, old: age > maxAge, age };
  });
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = JSON.parse(read("src/core/updates/migrations-registry.json"));
  const version = JSON.parse(read("package.json")).version;
  const current = JSON.parse(read("upgrade.json")).minFrom;
  const floor = arg("--floor") ?? current;
  const maxAge = Number(arg("--max-age") ?? 3);
  const rows = report({ floor, version, registry, maxAge });
  console.log(`version ${version}, floor in upgrade.json ${current}, floor considered ${floor}, max age ${maxAge} minor releases\n`);
  for (const r of rows) {
    const state = r.expired ? "EXPIRED (delete it)" : r.removableAtFloor === null ? "permanent" : cmp(floor, r.removableAtFloor) >= 0 ? "gone" : `removable once the floor reaches ${r.removableAtFloor}`;
    console.log(`- ${r.id.padEnd(16)} since ${r.introducedIn.padEnd(7)} age ${String(r.age).padStart(2)} minor(s)  ${state}${r.old && r.removableAtFloor !== null ? "  [older than the limit: raise the floor]" : ""}`);
  }
  const expired = rows.filter((r) => r.expired);
  const old = rows.filter((r) => r.old && r.removableAtFloor !== null && r.present.length > 0);
  if (flag("--check") && expired.length) { console.error(`\n${expired.length} expired migration(s) still present: ${expired.map((r) => r.id).join(", ")}`); process.exit(1); }
  if (old.length) { console.warn(`\nWarning: ${old.map((r) => r.id).join(", ")} older than ${maxAge} minor releases: raise the floor and delete them (docs/MIGRATIONS.md).`); if (flag("--strict")) process.exit(1); }
}
