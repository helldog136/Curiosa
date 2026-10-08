import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Code jetable : chaque entrée dit jusqu'à quelle version stable il a une raison d'exister. Passé ce jalon, ce test échoue et impose le ménage.
const TEMPORARY = [
  {
    why: "migration automatique du module « Blocs de page » vers les blocs du cœur (0.1.2 et 0.1.3-rc.x)",
    removeAfter: "0.1.3",
    files: ["src/core/migrations/blocksToCore.ts", "tests/core/blocks-migration.test.mjs"],
    alsoRemove: ["l'appel à migrateBlocksModule dans src/core/modules/registry.ts (syncBuiltins)"],
  },
];

const base = (v) => v.replace(/[-+].*$/, "").split(".").map(Number);
const newer = (a, b) => { const x = base(a), y = base(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

test("code temporaire : à supprimer quand sa date de péremption est passée", () => {
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  for (const t of TEMPORARY) {
    if (!newer(version, t.removeAfter)) continue;
    const left = t.files.filter((f) => fs.existsSync(f));
    assert.equal(left.length, 0, `Version ${version} > ${t.removeAfter} : supprimez « ${t.why} » → ${left.join(", ")}${t.alsoRemove.length ? ` ; et ${t.alsoRemove.join(" ; ")}` : ""}`);
  }
});

test("code temporaire : tant qu'il existe, il est signalé comme tel dans son propre fichier", () => {
  for (const t of TEMPORARY) for (const f of t.files.filter((x) => fs.existsSync(x) && x.startsWith("src/"))) assert.match(fs.readFileSync(f, "utf8"), /TEMPORAIRE — À SUPPRIMER APRÈS LA /, f);
});
