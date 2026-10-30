// POINT D'ENTRÉE PUBLIC ET STABLE du kit de test des modules (testsupport/). Voir docs/TESTSUPPORT.md.
//
//   import { checkModule, registerConformanceTests, fakeCtx } from "<dossier du cœur>/testsupport/index.mjs";
//
//   const report = await checkModule("/chemin/vers/mon-module");     // → rapport (le même que `--json`)
//   registerConformanceTests("/chemin/vers/mon-module", { test });   // une exigence = un test node:test nommé
//
// Le kit ne dépend pas de l'endroit où il est importé : il retrouve le cœur à partir de son propre emplacement.
// Il n'ouvre aucun port, n'appelle aucun réseau (tout accès est refusé et noté), n'utilise aucune vraie base de données.
import fs from "node:fs";
import path from "node:path";
import { test as nodeTest } from "node:test";
import { AssertionError } from "node:assert";
import { loadModuleDir, readModuleLight } from "./loader.mjs";
import { LEVELS, REQUIREMENTS, docLink } from "./requirements/index.mjs";

export { fakeCtx } from "./fakeCtx.mjs";
export { fakeFetch, withFakeFetch, blockNetwork, startLocalServer, netReplies, makeNetClient } from "./fakeNet.mjs";
export { loadModuleDir, readModuleLight, watchNetwork } from "./loader.mjs";
export { GROUPS, LEVELS, REQUIREMENTS, docLink } from "./requirements/index.mjs";
export { formatText, formatMatrix } from "./report.mjs";
export { assertMultiReaders } from "./overlayElements.mjs";
export { loadCore, CORE_DIR } from "./core.mjs";
export { makeTempDir, cleanupAll, removeTempDir } from "./tmp.mjs";
export { HOSTILE, HOSTILE_URL, CANARY, settingValue, makeCtx, observe } from "./probes.mjs";
export { settingsDefaults, findSrpViolations, assertNoSrpViolations, placeholders, assertValidManifest, assertDefinitionMatchesManifest, assertLocalesParity, assertSettingsSane } from "./builtinChecks.mjs";

const withTimeout = (p, ms, id) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`la vérification « ${id} » a pris plus de ${ms / 1000} s`)), ms).unref())]);

/** Dossiers de modules d'un dossier parent (ceux qui contiennent un module.json). */
export function listModuleDirs(parent) {
  if (!parent || !fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(parent, e.name, "module.json"))).map((e) => path.join(parent, e.name));
}

/**
 * Vérifie un module. Ne lève jamais pour un module fautif : tout est dans le rapport.
 * @param {string} dir dossier du module
 * @param {object} [opts]
 * @param {string[]} [opts.siblings] dossiers des AUTRES modules de l'ensemble (pour « un propriétaire par donnée »). Par défaut : les dossiers voisins qui contiennent un module.json.
 * @param {string[]} [opts.only] ne lancer que ces identifiants d'exigences
 * @returns {Promise<Report>} { module, core, summary, results[] } — voir docs/TESTSUPPORT.md
 */
export async function checkModule(dir, opts = {}) {
  const root = path.resolve(dir);
  const siblingDirs = (opts.siblings ?? listModuleDirs(path.dirname(root))).map((d) => path.resolve(d)).filter((d) => d !== root);
  const siblings = siblingDirs.map(readModuleLight).filter(Boolean);
  const m = await loadModuleDir(root, { siblings });
  const results = [];
  for (const r of REQUIREMENTS) {
    if (opts.only && !opts.only.includes(r.id)) continue;
    const base = { id: r.id, level: r.level, group: r.group, title: r.title, what: r.what, why: r.why, fix: r.fix, doc: docLink(r.id) };
    let res;
    try {
      res = await withTimeout(Promise.resolve(r.run(m)), 90_000, r.id);
    } catch (error) {
      results.push({ ...base, status: "fail", problems: [`la vérification n'a pas pu se terminer : ${String(error?.message ?? error).slice(0, 200)}`], note: "" });
      continue;
    }
    if (Array.isArray(res)) {
      const problems = res.map((p) => (typeof p === "string" ? p : p.message));
      results.push({ ...base, status: problems.length ? "fail" : "pass", problems, note: "" });
    } else if (res?.na) results.push({ ...base, status: "na", problems: [], note: res.na });
    else if (res?.skip) results.push({ ...base, status: "skip", problems: [], note: res.skip });
    else results.push({ ...base, status: "pass", problems: [], note: "" });
  }
  const count = (level, status) => results.filter((r) => r.level === level && r.status === status).length;
  const summary = {
    mandatory: { passed: count("mandatory", "pass"), failed: count("mandatory", "fail"), na: count("mandatory", "na"), skipped: count("mandatory", "skip") },
    advice: { passed: count("advice", "pass"), failed: count("advice", "fail"), na: count("advice", "na"), skipped: count("advice", "skip") },
  };
  summary.ok = summary.mandatory.failed === 0;
  const core = m.core;
  return {
    module: { dir: root, folder: path.basename(root), id: m.manifest?.id ?? null, version: m.manifest?.version ?? null },
    core: { version: core.version, apiVersion: core.apiVersion },
    summary, results,
  };
}

/**
 * Adaptateur node:test : enregistre une exigence = un test nommé. Une exigence OBLIGATOIRE en échec fait échouer le test (message complet : ce qui ne va pas,
 * pourquoi, comment corriger) ; un CONSEIL non suivi laisse le test passer et s'affiche en remarque. « Sans objet » et « non vérifié » passent (le test est ignoré).
 *
 *   import test from "node:test";
 *   registerConformanceTests(new URL("..", import.meta.url).pathname, { test });
 *
 * @param {string} dir dossier du module
 * @param {{ test?: Function, siblings?: string[], only?: string[], prefix?: string, known?: Record<string, string> }} [opts]
 *   `known` : { identifiant: raison } — exceptions EXPLIQUÉES et temporaires pour un défaut déjà connu : l'échec n'arrête pas le test (il s'affiche « à corriger »),
 *   et le jour où l'exigence réussit, le test échoue pour demander de retirer l'exception (elle ne doit pas survivre à la correction).
 */
export function registerConformanceTests(dir, opts = {}) {
  const test = opts.test ?? nodeTest;
  const prefix = opts.prefix ?? `[${path.basename(path.resolve(dir))}]`;
  let report;
  const reportOnce = () => (report ??= checkModule(dir, { siblings: opts.siblings, only: opts.only }));
  for (const r of REQUIREMENTS) {
    if (opts.only && !opts.only.includes(r.id)) continue;
    test(`${prefix} ${r.id} (${LEVELS[r.level]}) — ${r.title}`, async (t) => {
      const result = (await reportOnce()).results.find((x) => x.id === r.id);
      if (result.status === "na" || result.status === "skip") { t?.skip?.(result.note); return; }
      const reason = opts.known?.[r.id];
      if (result.status === "pass") { if (reason) throw new AssertionError({ message: `${r.id} réussit maintenant : retirez l'exception connue (« ${reason} »)` }); return; }
      if (reason) { t?.todo?.(reason); t?.diagnostic?.(`défaut connu : ${reason} — ${result.problems.join(" ; ")}`); return; }
      const lines = [...result.problems.map((p) => `• ${p}`), `Pourquoi : ${result.why}`, `Comment corriger : ${result.fix}`, `En savoir plus : ${result.doc}`].join("\n");
      if (result.level === "advice") { t?.diagnostic?.(`conseil non suivi — ${result.problems.join(" ; ")}`); return; }
      throw new AssertionError({ message: `${r.title}\n${lines}`, actual: result.problems, expected: [] });
    });
  }
}
