// Vérifications structurelles communes aux modules livrés avec le cœur (src/modules-builtin).
import assert from "node:assert/strict";

const PERM_FOR = { slots: "slots", routes: "routes", sections: "sections", overlay: "overlay", mcp: "mcp", page: "pages" };

export function placeholders(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
}

/** Le manifeste passe parseManifest tel quel (valeurs par défaut comprises). */
export async function assertValidManifest(manifest) {
  const { parseManifest } = await import("@/core/modules/manifest");
  const r = parseManifest(JSON.parse(JSON.stringify(manifest)));
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.manifest;
}

/** Sections déclarées = sections implémentées ; permissions cohérentes avec ce que la définition fournit. */
export function assertDefinitionMatchesManifest(manifest, definition) {
  const declared = (manifest.sections ?? []).map((s) => s.id).sort();
  const implemented = Object.keys(definition.sections ?? {}).sort();
  assert.deepEqual(implemented, declared, "sections déclarées ≠ sections implémentées");
  const perms = new Set(manifest.permissions ?? []);
  if (Object.keys(definition.sections ?? {}).length) assert.ok(perms.has("sections"), "permission sections manquante");
  if (Object.keys(definition.routes ?? {}).length) assert.ok(perms.has("routes"), "permission routes manquante");
  if (Object.keys(definition.slots ?? {}).length) assert.ok(perms.has("slots"), "permission slots manquante");
  if (definition.overlay) assert.ok(perms.has("overlay"), "permission overlay manquante");
  if (definition.page) assert.ok(perms.has("pages"), "permission pages manquante");
  // MCP : déclarations ↔ handlers
  const mcpDecl = (manifest.mcp ?? []).map((a) => a.name).sort();
  const mcpImpl = Object.keys(definition.mcp ?? {}).sort();
  assert.deepEqual(mcpImpl, mcpDecl, "actions MCP déclarées ≠ handlers");
  void PERM_FOR;
}

/** Les deux langues ont exactement les mêmes clés et les mêmes variables {x}. */
export function assertLocalesParity(locales) {
  if (!locales || !Object.keys(locales).length) return;
  const langs = Object.keys(locales);
  assert.ok(langs.includes("en") && langs.includes("fr"));
  const ref = Object.keys(locales.en).sort();
  assert.deepEqual(Object.keys(locales.fr).sort(), ref, "clés en/fr différentes");
  for (const k of ref) {
    assert.ok(locales.en[k].trim() && locales.fr[k].trim(), `traduction vide : ${k}`);
    assert.equal(placeholders(locales.fr[k]), placeholders(locales.en[k]), `variables différentes : ${k}`);
  }
}

/** Tout `default` d'un réglage select est une option ; tout réglage a un label non vide dans les deux langues. */
export function assertSettingsSane(manifest) {
  const keys = new Set();
  for (const s of manifest.settings ?? []) {
    assert.ok(!keys.has(s.key), `clé de réglage en double : ${s.key}`);
    keys.add(s.key);
    for (const l of ["en", "fr"]) assert.ok(typeof s.label === "string" || s.label[l]?.trim(), `label ${l} manquant : ${s.key}`);
    if (s.type === "select") {
      assert.ok(s.options?.length, `select sans options : ${s.key}`);
      if (s.default !== undefined) assert.ok(s.options.some((o) => o.value === s.default), `défaut hors options : ${s.key}`);
    }
    if (s.type === "secret") assert.equal(s.default, undefined, "un secret n'a pas de défaut");
  }
}

export const settingsDefaults = (manifest) =>
  Object.fromEntries((manifest.settings ?? []).filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
