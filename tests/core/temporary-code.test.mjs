import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Code jetable : chaque entrée dit jusqu'à quelle version stable il a une raison d'exister. Passé ce jalon, ce test échoue et impose le ménage.
const TEMPORARY = [
  // (0.32.0) Empty: the last entry (legacyOff.ts, Module.enabled, ModuleInstance.enabled) was removed with a tested migration, see REMOVED.
  // Entry shape: { why, removeAfter: "x.y.99", files: ["src/..."], alsoRemove: ["..."] }.
];

// Code jetable déjà supprimé : une instance plus ancienne que `needs` n'a plus le droit de sauter à la version courante, elle doit passer par `needs`
// d'abord. C'est `upgrade.json` (asset de release, lu par le système de mise à jour) qui l'impose : en supprimant du code jetable, remontez `minFrom`
// et ajoutez ici une ligne.
const REMOVED = [
  { what: "restore of a backup made before 0.1.20 that lists switched-off modules or instances (legacyOff.ts, columns Module.enabled and ModuleInstance.enabled; 0.32.0): rows still switched off are set aside by the migration 20261118090000_drop_enabled_columns, such a backup file is now refused (error switched-off)", needs: "0.2.0" },
  { what: "RAWG handover of the old core key and cover fixes to the Game covers module (0.3.0): start-up hook, hooks after install/update/restore, relay wait (see src/core/updates/migrations-registry.json)", needs: "0.6.18" },
  { what: "one-time freeze of overlay placements (0.2.6) and the start-up menu freeze (see src/core/updates/migrations-registry.json)", needs: "0.6.10" },
  { what: "migrations « modules intégrés » et « Blocs de page » (0.1.2, 0.1.3-rc.x)", needs: "0.1.4" },
  { what: "rangement au démarrage des modules et instances « éteints » (avant la 0.1.20) et conversion des lignes de modules `bundled` / `builtin` en modules du catalogue (balayage de démarrage, mise à jour, réinstallation) : le démarrage de la 0.2.0 les a faits", needs: "0.2.0" },
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

test("code temporaire supprimé : `upgrade.json` (minFrom) exige au moins la version qui contenait encore la conversion", () => {
  const minFrom = JSON.parse(fs.readFileSync("upgrade.json", "utf8")).minFrom;
  for (const r of REMOVED) assert.ok(!newer(r.needs, minFrom), `upgrade.json : minFrom (${minFrom}) doit être ≥ ${r.needs} — ${r.what}`);
});
