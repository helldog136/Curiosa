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

/**
 * SRP (une responsabilité par module, un propriétaire par donnée ou capacité) — vérification PURE sur un ensemble de manifestes (objets module.json
 * déjà lus, ou passés par parseManifest). Détecte les violations évidentes, sans rien lire ailleurs :
 *   service  un même service `offers` par plusieurs modules, sauf substitution voulue (`opts.substitutes` : liste explicite des services dont
 *            plusieurs fournisseurs sont voulus, le mécanisme maître/répliques du cœur s'en charge) ;
 *   mcp      une action MCP du même nom (`mcp[].name`) dans deux modules (sauf `opts.mcp`, liste de noms voulus) ;
 *   secret   un réglage secret de même clé (`type: "secret"`) dans deux modules qui ne sont PAS fournisseur/consommateur l'un de l'autre
 *            (sauf `opts.secrets`, liste de clés voulues). Deux modules liés par `requires` → `offers` partagent la donnée par le service :
 *            s'ils la dupliquent, c'est une autre violation, que cette règle ne détecte pas.
 * Renvoie une liste de { rule, key, modules, message } ; vide = rien à signaler.
 */
export function findSrpViolations(manifests, opts = {}) {
  const substitutes = new Set(opts.substitutes ?? []);
  const allowedMcp = new Set(opts.mcp ?? []);
  const allowedSecrets = new Set(opts.secrets ?? []);
  const list = (manifests ?? []).filter((m) => m && typeof m.id === "string");
  const offered = (m) => new Set((m.offers ?? []).map((o) => o.service));
  const needed = (m) => new Set((m.requires ?? []).map((r) => r.service));
  const related = (a, b) => [...needed(a)].some((s) => offered(b).has(s)) || [...needed(b)].some((s) => offered(a).has(s));
  const group = (pick) => {
    const by = new Map();
    for (const m of list) for (const key of new Set(pick(m))) by.set(key, [...(by.get(key) ?? []), m]);
    return by;
  };
  const out = [];
  for (const [service, mods] of group((m) => [...offered(m)])) {
    if (mods.length > 1 && !substitutes.has(service)) out.push({ rule: "service", key: service, modules: mods.map((m) => m.id).sort(), message: `le service « ${service} » est offert par plusieurs modules (${mods.map((m) => m.id).sort().join(", ")}) : un seul propriétaire, ou déclarez la substitution voulue` });
  }
  for (const [name, mods] of group((m) => (m.mcp ?? []).map((a) => a.name))) {
    if (mods.length > 1 && !allowedMcp.has(name)) out.push({ rule: "mcp", key: name, modules: mods.map((m) => m.id).sort(), message: `l'action MCP « ${name} » existe dans plusieurs modules (${mods.map((m) => m.id).sort().join(", ")})` });
  }
  const secrets = (m) => [...(m.settings ?? []), ...(m.sections ?? []).flatMap((s) => s.options ?? [])].filter((s) => s.type === "secret").map((s) => s.key);
  for (const [key, mods] of group(secrets)) {
    if (allowedSecrets.has(key)) continue;
    const bad = new Set();
    for (let i = 0; i < mods.length; i++) for (let j = i + 1; j < mods.length; j++) if (!related(mods[i], mods[j])) { bad.add(mods[i].id); bad.add(mods[j].id); }
    if (bad.size) out.push({ rule: "secret", key, modules: [...bad].sort(), message: `le secret « ${key} » est demandé par des modules sans lien de service (${[...bad].sort().join(", ")}) : confiez-le à un module fournisseur` });
  }
  return out;
}

/** Échoue avec la liste lisible des violations SRP. */
export function assertNoSrpViolations(manifests, opts) {
  const v = findSrpViolations(manifests, opts);
  assert.deepEqual(v.map((x) => x.message), [], "violations du principe « un module fait une chose, une donnée n'a qu'un propriétaire »");
}
