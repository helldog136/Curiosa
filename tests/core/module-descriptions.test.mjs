import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Les modules du catalogue. Les modules d'exemple (pour développeurs) disent « Example module » et décrivent des sujets techniques : hors règle.
const mods = ["modules-community"].flatMap((root) =>
  fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => JSON.parse(fs.readFileSync(path.join(root, d.name, "module.json"), "utf8"))));
const text = (v) => (typeof v === "string" ? [v] : Object.values(v ?? {}).map(String));
const norm = (s) => s.toLowerCase().replace(/\s*\((obs|interne|internal)\)\s*/g, " ").replace(/\s+/g, " ").trim();

test("catalogue : la description d'un module dit ce que fait CE module — jamais un autre module, ni ce qui le consomme ou l'alimente", () => {
  assert.ok(mods.length >= 10);
  for (const m of mods) {
    const own = new Set(text(m.name).map(norm));
    for (const description of text(m.description)) {
      assert.ok(!/\bmodules?\b/i.test(description), `${m.id} : le mot « module » désigne un autre module → « ${description} »`);
      for (const other of mods) {
        if (other.id === m.id) continue;
        for (const name of text(other.name).map(norm)) {
          if (own.has(name) || !name.includes(" ")) continue; // noms d'un seul mot (« Contacts », « Sponsors ») : des mots courants, pas des références
          assert.ok(!norm(description).includes(name), `${m.id} cite « ${name} » (module ${other.id}) → « ${description} »`);
        }
      }
    }
  }
});

test("catalogue : pas de jargon technique dans une description (sujets d'échange, noms d'API)", () => {
  for (const m of mods)
    for (const description of text(m.description)) assert.ok(!/\b(topic|sujet [a-z]+\.[a-z]+|overlay\.item|feed\.item|ctx\.api|mcp)\b/i.test(description), `${m.id} → « ${description} »`);
});
