// Vérifications structurelles communes à tous les modules : SOURCE UNIQUE, utilisée par la suite de conformité (testsupport/requirements/) et par les tests du cœur.
// Les fonctions `…Problems` renvoient la liste des problèmes lisibles ; les `assert…` échouent au premier (pour les tests node:test).
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

/**
 * Sections déclarées = sections implémentées ; actions MCP et permissions cohérentes avec ce que la définition fournit.
 * Renvoie la liste des problèmes (vide = rien à signaler). `assertDefinitionMatchesManifest` en est la version « échoue au premier ».
 */
export function definitionProblems(manifest, definition) {
  const out = [];
  const declared = (manifest.sections ?? []).map((s) => s.id).sort();
  const implemented = Object.keys(definition.sections ?? {}).sort();
  for (const id of declared) if (!implemented.includes(id)) out.push(`la section « ${id} » est déclarée dans module.json mais n'existe pas dans le code`);
  for (const id of implemented) if (!declared.includes(id)) out.push(`la section « ${id} » existe dans le code mais n'est pas déclarée dans module.json (sections)`);
  const mcpDecl = (manifest.mcp ?? []).map((a) => a.name).sort();
  const mcpImpl = Object.keys(definition.mcp ?? {}).sort();
  for (const n of mcpDecl) if (!mcpImpl.includes(n)) out.push(`l'action MCP « ${n} » est déclarée dans module.json mais n'est pas implémentée dans le code (mcp)`);
  for (const n of mcpImpl) if (!mcpDecl.includes(n)) out.push(`l'action MCP « ${n} » est implémentée dans le code mais n'est pas déclarée dans module.json (mcp)`);
  return out;
}

/** Permissions que la définition exige : { permission, why }. Version pure de ce que `assertDefinitionMatchesManifest` contrôlait. */
export function permissionsFromDefinition(definition) {
  const need = [];
  if (Object.keys(definition.sections ?? {}).length) need.push(["sections", "le code définit des sections"]);
  if (Object.keys(definition.routes ?? {}).length) need.push(["routes", "le code définit des routes"]);
  if (Object.keys(definition.slots ?? {}).length) need.push(["slots", "le code remplit des emplacements (slots)"]);
  if (definition.overlay) need.push(["overlay", "le code définit un overlay"]);
  if (definition.page) need.push(["pages", "le code définit une page publique"]);
  if (Object.keys(definition.mcp ?? {}).length) need.push(["mcp", "le code implémente des actions MCP"]);
  if (definition.filters) need.push(["filters", "le code définit des filtres"]);
  if (definition.adminPanel || Object.keys(definition.adminActions ?? {}).length || Object.keys(definition.adminDownloads ?? {}).length || Object.keys(definition.entryPanels ?? {}).length) need.push(["admin", "le code définit un panneau, des actions ou des téléchargements d'administration ou des sections d'éditeur d'entrée"]);
  return need.map(([permission, why]) => ({ permission, why }));
}

/** Sections déclarées = sections implémentées ; permissions cohérentes avec ce que la définition fournit. */
export function assertDefinitionMatchesManifest(manifest, definition) {
  const perms = new Set(manifest.permissions ?? []);
  const problems = definitionProblems(manifest, definition);
  for (const { permission } of permissionsFromDefinition(definition)) if (["sections", "routes", "slots", "overlay", "pages"].includes(permission) && !perms.has(permission)) problems.push(`permission ${permission} manquante`);
  assert.deepEqual(problems, [], "définition ≠ manifeste");
  void PERM_FOR;
}

/** Problèmes de langues : fr et en présents, mêmes clés, mêmes variables {x}, aucun texte vide. Vide = rien à signaler. */
export function localeProblems(locales) {
  const out = [];
  if (!locales || !Object.keys(locales).length) return out;
  const langs = Object.keys(locales);
  for (const l of ["en", "fr"]) if (!langs.includes(l)) out.push(`le fichier locales/${l}.json manque`);
  if (out.length) return out;
  const keys = (l) => Object.keys(locales[l]);
  for (const k of keys("en")) if (!(k in locales.fr)) out.push(`la clé « ${k} » existe en anglais mais pas en français`);
  for (const k of keys("fr")) if (!(k in locales.en)) out.push(`la clé « ${k} » existe en français mais pas en anglais`);
  for (const k of keys("en")) {
    if (!(k in locales.fr)) continue;
    if (!String(locales.en[k]).trim() || !String(locales.fr[k]).trim()) out.push(`la traduction de « ${k} » est vide`);
    else if (placeholders(locales.fr[k]) !== placeholders(locales.en[k])) out.push(`la clé « ${k} » n'a pas les mêmes variables en français ({${placeholders(locales.fr[k])}}) et en anglais ({${placeholders(locales.en[k])}})`);
  }
  return out;
}

/** Les deux langues ont exactement les mêmes clés et les mêmes variables {x}. */
export function assertLocalesParity(locales) {
  assert.deepEqual(localeProblems(locales), [], "langues en/fr différentes");
}

/** Problèmes de réglages : clés uniques, libellé non vide dans les deux langues, défaut d'une liste = une option, pas de défaut pour un secret. */
export function settingsProblems(manifest) {
  const out = [];
  const keys = new Set();
  for (const s of manifest.settings ?? []) {
    if (keys.has(s.key)) out.push(`clé de réglage en double : ${s.key}`);
    keys.add(s.key);
    for (const l of ["en", "fr"]) if (!(typeof s.label === "string" ? s.label.trim() : s.label?.[l]?.trim())) out.push(`le réglage « ${s.key} » n'a pas de libellé ${l === "fr" ? "français" : "anglais"}`);
    if (s.type === "select") {
      if (!s.options?.length) out.push(`le réglage « ${s.key} » est une liste sans options`);
      else if (s.default !== undefined && !s.options.some((o) => o.value === s.default)) out.push(`le défaut du réglage « ${s.key} » (« ${s.default} ») n'est pas une des options`);
    }
    if (s.type === "secret" && s.default !== undefined) out.push(`le réglage secret « ${s.key} » ne doit pas avoir de valeur par défaut`);
  }
  return out;
}

/** Tout `default` d'un réglage select est une option ; tout réglage a un label non vide dans les deux langues. */
export function assertSettingsSane(manifest) {
  assert.deepEqual(settingsProblems(manifest), [], "réglages incohérents");
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
