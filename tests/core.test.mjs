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
  assert.equal(slugify("Été à Paris !"), "ete-a-paris");
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
      for (const s of m.settings ?? []) if (s.advanced) assert.ok(s.default !== undefined || s.type !== "number", `${name}.${s.key}: un réglage avancé numérique doit avoir une valeur par défaut`);
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

test("les modules qui déclarent des actions MCP les implémentent ; les actions irréversibles sont désactivées par défaut", () => {
  for (const name of fs.readdirSync("modules-community")) {
    const m = JSON.parse(read(`modules-community/${name}/module.json`));
    if (!m.mcp) continue;
    const code = read(`modules-community/${name}/${m.main}`);
    for (const action of m.mcp) {
      assert.ok(new RegExp(`\\b${action.name}\\b`).test(code), `${name}.${action.name} n'est pas implémentée`);
      // Supprimer / publier est possible, mais jamais d'office : à accorder à la main, jeton par jeton.
      if (/delete|remove|publish|destroy|purge/.test(action.name)) {
        assert.equal(action.destructive, true, `${name}.${action.name} doit être déclarée destructive`);
        assert.notEqual(action.default, true, `${name}.${action.name} ne doit pas être active par défaut`);
      }
      if (action.destructive) assert.notEqual(action.default, true, `${name}.${action.name} : destructive ⇒ jamais par défaut`);
      if (action.readOnly) assert.ok(!action.destructive, `${name}.${action.name} : lecture seule ne peut être destructive`);
    }
  }
});

test("droits d'un jeton : plafond, défauts du module, surcharges, effet immédiat", async () => {
  const { canUse, setGrant, parseGrants, isGranted } = await import("../src/core/services/mcp/access.ts");
  const read = { name: "p__list", readOnly: true, default: true };
  const write = { name: "p__create", readOnly: false, default: true };
  const del = { name: "p__delete", readOnly: false, default: false };
  const t = (scope, grants = {}) => ({ scope, grants });

  // Défauts : un jeton « écriture » voit lecture + écriture par défaut, PAS la suppression.
  assert.ok(canUse(read, t("write")) && canUse(write, t("write")));
  assert.ok(!canUse(del, t("write")), "une action destructrice n'est pas accordée d'office");
  // Plafond : un jeton « lecture » n'écrit jamais, même si on lui accorde.
  assert.ok(canUse(read, t("read")) && !canUse(write, t("read")));
  assert.ok(!canUse(del, t("read", { "p__delete": true })), "le plafond l'emporte sur l'octroi");
  // Octroi manuel, puis retrait : effet sur la requête suivante (la fonction est pure, sans cache).
  let grants = setGrant({}, del, true);
  assert.deepEqual(grants, { "p__delete": true });
  assert.ok(canUse(del, t("write", grants)));
  grants = setGrant(grants, del, false);
  assert.deepEqual(grants, {}, "une surcharge égale au défaut est supprimée");
  assert.ok(!canUse(del, t("write", grants)));
  // Retirer une action active par défaut.
  grants = setGrant({}, write, false);
  assert.ok(!canUse(write, t("write", grants)) && canUse(read, t("write", grants)));
  assert.equal(isGranted(write, grants), false);
  // Champ corrompu : aucune surcharge, jamais d'exception.
  for (const bad of ["", "nope", "[]", "null", '{"a":"x"}']) assert.deepEqual(parseGrants(bad), {});
  assert.deepEqual(parseGrants('{"a":true,"b":"x"}'), { a: true });
});

test("surnoms d'instances : libellé d'admin, identifiant dérivé, unicité", async () => {
  const { instanceLabel, keyFromNickname, checkNickname, suggestNickname, needsNickname } = await import("../src/core/instanceLabel.ts");
  // Une seule instance : le surnom est superflu — le libellé est le nom du module, même si un surnom existe.
  assert.equal(instanceLabel({ nickname: "Actus", publicName: "Blog", key: "blog" }, "Blog", 1), "Blog");
  assert.ok(!needsNickname(1) && needsNickname(2));
  // Plusieurs : le surnom prime, puis le nom public, puis l'identifiant.
  assert.equal(instanceLabel({ nickname: "Actus", publicName: "News", key: "actus" }, "Blog", 2), "Actus");
  assert.equal(instanceLabel({ nickname: null, publicName: "News", key: "blog-2" }, "Blog", 2), "News");
  assert.equal(instanceLabel({ nickname: " ", publicName: "", key: "blog-2" }, "Blog", 3), "blog-2");
  // L'identifiant technique vient du surnom (et jamais d'un numéro opaque).
  assert.equal(keyFromNickname("blog", "Chaîne 2"), "chaine-2");
  assert.equal(keyFromNickname("blog", "Été à Paris !"), "ete-a-paris");
  assert.equal(keyFromNickname("links", undefined), "links");
  assert.equal(keyFromNickname("blog", "2024"), "blog-2024", "ne commence pas par un chiffre");
  assert.equal(keyFromNickname("blog", "x"), "blog-x", "trop court");
  assert.match(keyFromNickname("blog", "A".repeat(80)), /^[a-z][a-z0-9-]{1,30}$/);
  // Unicité parmi les instances du même module, sans casse ni accents.
  assert.deepEqual(checkNickname("  Chaîne   2 ", ["Actus"]), { ok: true, value: "Chaîne 2" });
  assert.equal(checkNickname("chaine 2", ["Chaîne 2"]).reason, "taken");
  assert.equal(checkNickname("   ", []).reason, "empty");
  assert.equal(checkNickname("x".repeat(41), []).reason, "long");
  // Suggestion : le premier numéro libre.
  assert.equal(suggestNickname("Blog", []), "Blog 2");
  assert.equal(suggestNickname("Blog", ["Blog 2", "Blog 3"]), "Blog 4");
});
