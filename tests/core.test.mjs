// Tests sans dépendance : `npm test` (Node ≥ 22, exécute les .ts directement).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

test("les dictionnaires fr et en ont exactement les mêmes clés", () => {
  const fr = Object.keys(JSON.parse(read("src/locales/fr.json"))).sort();
  const en = Object.keys(JSON.parse(read("src/locales/en.json"))).sort();
  assert.deepEqual(fr, en);
});

test("toute clé t(\"…\") utilisée dans l'interface existe dans les dictionnaires", () => {
  const en = JSON.parse(read("src/locales/en.json"));
  // Les modules livrés avec le cœur ont leurs propres textes (locales du module).
  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("modules-builtin"));
  const missing = [];
  for (const file of files) {
    for (const m of read(file).matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g)) {
      if (!(m[1] in en)) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("slugify retire accents et symboles", async () => {
  const { slugify } = await import("../src/core/slug.ts");
  assert.equal(slugify("Été à Bruxelles !"), "ete-a-bruxelles");
  assert.equal(slugify("  --  "), "");
});

test("les liens sortants n'acceptent que http, https et mailto", async () => {
  const { isSafeExternalUrl, safeHref } = await import("../src/core/url.ts");
  assert.ok(isSafeExternalUrl("https://twitch.tv/x"));
  assert.ok(isSafeExternalUrl("mailto:a@b.c"));
  assert.ok(!isSafeExternalUrl("javascript:alert(1)"));
  assert.ok(!isSafeExternalUrl("data:text/html,x"));
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("//evil.example"), "#");
  assert.equal(safeHref("/blog"), "/blog");
});

test("la palette dérivée reste lisible (texte clair sur fond sombre, sombre sur fond clair)", async () => {
  const { buildPalette } = await import("../src/core/color.ts");
  assert.equal(buildPalette("#101010", "#ff8800")["--v-fg"], "#f4f4f5");
  assert.equal(buildPalette("#fafafa", "#ff8800")["--v-fg"], "#18181b");
  assert.equal(buildPalette("javascript", "x")["--v-bg"], "#121214");
});

test("les préfixes de langue connus ne collident pas avec les chemins réservés", async () => {
  const { KNOWN_LOCALES } = await import("../src/core/i18n/locales.ts");
  const { RESERVED_PATHS } = await import("../src/core/config.ts");
  for (const code of Object.keys(KNOWN_LOCALES)) assert.ok(!RESERVED_PATHS.has(code), code);
});

test("le module d'exemple est cohérent (id, version, fichier principal, réglages)", () => {
  const dir = "modules-examples/announcement-banner";
  const m = JSON.parse(read(`${dir}/module.json`));
  assert.match(m.id, /^[a-z][a-z0-9-]{1,39}$/);
  assert.match(m.version, /^\d+\.\d+\.\d+/);
  const core = read("src/core/config.ts").match(/MODULE_API_VERSION = (\d+)/);
  assert.equal(m.apiVersion, Number(core[1]));
  assert.ok(fs.existsSync(`${dir}/${m.main}`));
  for (const s of m.settings) assert.match(s.key, /^[a-zA-Z][a-zA-Z0-9_]*$/);
});

test("les modules communautaires ont un manifeste cohérent et ne sont PAS livrés avec le cœur", () => {
  const builtin = read("src/modules-builtin/index.ts");
  for (const dir of fs.readdirSync("modules-community")) {
    const m = JSON.parse(read(`modules-community/${dir}/module.json`));
    assert.equal(m.id, dir);
    assert.ok(fs.existsSync(`modules-community/${dir}/${m.main}`));
    assert.ok(!builtin.includes(m.id) && !builtin.includes(dir), `${dir} ne doit pas être un module par défaut`);
  }
});

test("les réglages avancés sont déclarés par les modules, jamais obligatoires pour le mode simple", () => {
  for (const dir of ["modules-examples", "modules-community"]) {
    for (const name of fs.readdirSync(dir)) {
      const m = JSON.parse(read(`${dir}/${name}/module.json`));
      for (const s of m.settings) if (s.advanced) assert.ok(s.default !== undefined || s.type !== "number", `${name}.${s.key}: un réglage avancé numérique doit avoir une valeur par défaut`);
    }
  }
});

test("validateArgs : types, bornes, énumérations, requis, propriétés inconnues refusées", async () => {
  const { validateArgs, McpToolError } = await import("../src/core/services/mcp/validate.ts");
  const schema = {
    type: "object",
    required: ["title"],
    properties: { title: { type: "string", maxLength: 5 }, n: { type: "integer", minimum: 1, maximum: 3 }, s: { type: "string", enum: ["a", "b"] }, tags: { type: "array", items: { type: "string" } } },
  };
  assert.deepEqual(validateArgs(schema, { title: "ok", n: 2, s: "a", tags: ["x"] }), { title: "ok", n: 2, s: "a", tags: ["x"] });
  for (const bad of [{}, { title: "toolong" }, { title: "a", n: 9 }, { title: "a", n: 1.5 }, { title: "a", s: "c" }, { title: "a", extra: 1 }, { title: "a", tags: [1] }, { title: 3 }]) {
    assert.throws(() => validateArgs(schema, bad), McpToolError, JSON.stringify(bad));
  }
  assert.deepEqual(validateArgs(undefined, {}), {});
  assert.throws(() => validateArgs(undefined, { x: 1 }), McpToolError);
});

test("les modules qui déclarent des actions MCP en implémentent chacune, et aucune n'est destructive", () => {
  for (const name of fs.readdirSync("modules-community")) {
    const m = JSON.parse(read(`modules-community/${name}/module.json`));
    if (!m.mcp) continue;
    const code = read(`modules-community/${name}/${m.main}`);
    for (const action of m.mcp) {
      assert.ok(new RegExp(`\\b${action.name}\\b`).test(code), `${name}.${action.name} n'est pas implémentée`);
      assert.ok(!/delete|remove|publish|destroy/.test(action.name), `${name}.${action.name} : les actions MCP ne suppriment ni ne publient jamais`);
    }
  }
});
