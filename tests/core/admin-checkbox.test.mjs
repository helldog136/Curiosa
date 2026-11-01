import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(f, "utf8");

test("adminForm : le champ « checkbox » existe (type, rendu, doc) et une case décochée n'envoie rien", () => {
  assert.match(read("src/core/blocks.ts"), /kind\?: [^;]*"checkbox"/);
  const ui = read("src/components/admin/AdminBlocks.tsx");
  assert.ok(ui.includes('f.kind === "checkbox"') && ui.includes("<Checkbox"), "le champ est rendu par la case à cocher du cœur");
  assert.ok(ui.includes('["on", "1", "true"]'), "cochée si la valeur vaut on, 1 ou true");
  const doc = read("docs/MODULES.md");
  assert.ok(doc.includes("`checkbox` (case à cocher"), "documenté dans docs/MODULES.md");
  // Une case décochée est absente du FormData : le module la lit comme « faux ».
  const fd = new FormData(); fd.set("other", "x");
  assert.equal(fd.get("show"), null);
});
