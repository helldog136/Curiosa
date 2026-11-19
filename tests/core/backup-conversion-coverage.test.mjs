// A conversion cannot be removed without a way for an old backup to still be read (core 0.39.0, docs/MIGRATIONS.md rule 5, docs/BACKUP.md "Old backups").
// Every entry of src/core/updates/migrations-registry.json (active and removed) says what a restore does for it (`backup`): a conversion function that exists, an explicit refusal
// (an error code that exists and has its texts), something automatic, or a permanent contract. Every Prisma migration that moves or rewrites data is listed under `schemaMigrations`
// with the same answer. A new conversion or migration without an answer fails here: add the function or the refusal first.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync("src/core/updates/migrations-registry.json", "utf8"));
const read = (f) => fs.readFileSync(f, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const KINDS = ["converted", "refused", "automatic", "permanent"];

function check(where, a) {
  assert.ok(a && KINDS.includes(a.kind), `${where}: say what a restore does (kind: ${KINDS.join(" | ")})`);
  if (a.kind === "converted") {
    assert.ok(fs.existsSync(a.file), `${where}: ${a.file} is gone`);
    assert.match(read(a.file), new RegExp(`export (async )?function ${a.symbol}\\b`), `${where}: the conversion function ${a.symbol} is not exported by ${a.file}`);
    // The function must be used by the restore (not just defined).
    const used = ["src/core/backup/restore.ts", "src/core/backup/conversion/plan.ts", "src/core/backup/conversion/coreConversions.ts"].some((f) => new RegExp(`\\b${a.symbol}\\b`).test(read(f).replace(new RegExp(`export (async )?function ${a.symbol}\\b`), "")));
    assert.ok(used, `${where}: ${a.symbol} exists but nothing runs it`);
  }
  if (a.kind === "refused") {
    assert.match(read("src/core/backup/restore.ts"), new RegExp(`"${a.error}"`), `${where}: the refusal "${a.error}" is not a restore error`);
    for (const [lang, loc] of [["en", en], ["fr", fr]]) assert.equal(typeof loc[`backup.error.${a.error}`], "string", `${where}: no ${lang} text for backup.error.${a.error}`);
  }
  if (a.kind === "automatic" || a.kind === "permanent") assert.ok(String(a.why ?? "").length > 20, `${where}: say why it needs nothing`);
}

test("every conversion of the migration registry, active or removed, has an answer for old backups", () => {
  for (const e of [...registry.active, ...registry.removed]) check(`registry ${e.id}`, e.backup);
});

test("every Prisma migration that moves or rewrites data says what a backup made before it does", () => {
  const listed = registry.schemaMigrations ?? {};
  for (const name of fs.readdirSync("prisma/migrations").filter((d) => /^\d{8,}_/.test(d))) {
    const sql = read(`prisma/migrations/${name}/migration.sql`);
    if (!/^\s*(UPDATE|INSERT|DELETE|DROP|ALTER TABLE .* RENAME)/im.test(sql)) continue;
    check(`migration ${name}`, listed[name]);
  }
  for (const name of Object.keys(listed)) if (name !== "$comment") assert.ok(fs.existsSync(`prisma/migrations/${name}`), `${name} is listed but the migration is gone: remove the line`);
});

test("a schema upgrade named by the registry exists, and the list of upgrades only names real migrations", () => {
  const src = read("src/core/backup/schema.ts");
  for (const [name, a] of Object.entries(registry.schemaMigrations ?? {})) if (a?.kind === "upgrade") assert.ok(src.includes(`"${name}"`), `${name}: no schemaUpgrades entry`);
});

test("the check itself fails for a removed function, a missing answer and a refusal without texts", () => {
  assert.throws(() => check("x", { kind: "converted", file: "src/core/backup/conversion/coreConversions.ts", symbol: "removedConversion" }));
  assert.throws(() => check("x", undefined));
  assert.throws(() => check("x", { kind: "refused", error: "no-such-error" }));
  assert.throws(() => check("x", { kind: "automatic", why: "" }));
});
