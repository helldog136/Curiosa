import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

// L'INCIDENT : une mise à jour de module dans le MÊME processus. Le fichier principal est rechargé avec `?v=<commit>`, mais un fichier voisin importé
// statiquement (`import … from "./source.mjs"`) restait à l'ancienne version dans le cache de Node : le nouveau fichier principal ne s'accorde plus avec lui.
const db = await useTestDb();
const R = await import("@/core/modules/registry");
after(() => db.close());
beforeEach(async () => { await db.reset(); });

const manifest = (version) => ({ apiVersion: 2, id: "demo", name: "Demo", version, main: "index.mjs" });
function put(files, id = "demo") {
  const dir = R.moduleDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
}
const row = (version, commit) => ({ id: "demo", source: "git", version, commit, enabled: true });
const V1 = {
  "module.json": manifest("1.0.0"),
  "index.mjs": 'import { greet } from "./source.mjs";\nexport default { marker: greet() };\n',
  "source.mjs": 'export const greet = () => "v1";\n',
};
const V2 = {
  "module.json": manifest("1.1.0"),
  "index.mjs": 'import { greet, shout } from "./source.mjs";\nexport default { marker: greet(), loud: shout() };\n',
  "source.mjs": 'export const greet = () => "v2";\nexport const shout = () => "V2!";\n',
};
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

test("INCIDENT reproduit : module à 2 fichiers avec import statique, mis à jour dans le même processus, se charge avec le code NEUF des deux fichiers", async () => {
  put(V1);
  const a = await R.loadModule(row("1.0.0", "aaa"));
  assert.equal(a?.def.marker, "v1");
  put(V2);                       // la mise à jour remplace les fichiers…
  R.forgetModule("demo");        // …et le cœur oublie le module (installer.ts)
  const b = await quiet(() => R.loadModule(row("1.1.0", "bbb")));
  assert.ok(b, "avant la correction : « impossible à charger » (le voisin source.mjs est resté à la v1 : il n'exporte pas `shout`)");
  assert.deepEqual([b.def.marker, b.def.loud], ["v2", "V2!"]);
});
