// Les skins OFFICIELS contre le cœur courant (docs/SKINS.md « Un nouvel élément est-il habillable ? ») : bibliothèque de `npm run skin:official` (scripts/skin-official.mjs).
//
//   1. lit le catalogue officiel comme le fait le cœur (src/core/skins/catalogue.ts : `git fetch --depth 1` du dépôt de skins, puis `sanitizeSkinEntries`) ;
//   2. récupère chaque skin à son étiquette épinglée (`fetchSkinSource`, le code même de l'installation) ;
//   3. lui fait passer le kit (`checkOne`) contre le cœur COURANT, avec le rapport de couverture ;
//   4. repère les pièces et régions NOUVELLES (absentes de la référence) que le skin ne cible pas.
//
// La référence des pièces « déjà publiées » est le fichier versionné `docs/skins-parts-baseline.json` : il ne dépend ni de l'historique git (clone superficiel), ni des
// étiquettes, ni du réseau. Il est régénéré à chaque publication du cœur (`--update-baseline`). `--since <réf-git>` compare plutôt à la liste d'une étiquette ou d'un commit.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const BASELINE_FILE = "docs/skins-parts-baseline.json";
const lib = async (name) => import(`../../src/core/skins/${name}.ts`);

// ── la référence (pièces et régions de la dernière version publiée) ───────────────────────────────────────────────────────────────────────────────────────

export const snapshot = (version, regions, parts) => ({
  note: "Pièces et régions de la dernière version PUBLIÉE du cœur. Régénérer à chaque publication : npm run skin:official -- --update-baseline (docs/SKINS.md, « Un nouvel élément est-il habillable ? »).",
  format: 1, version, regions: [...regions], parts: [...parts],
});

/** Lit et vérifie le fichier de référence. Lève avec un message clair s'il est absent ou abîmé. */
export function readBaseline(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`référence illisible (${file}) : ${e.code === "ENOENT" ? "fichier absent" : e.message}`); }
  const names = (v) => Array.isArray(v) && v.every((n) => typeof n === "string" && /^[a-z][a-z0-9.-]*$/.test(n)) && new Set(v).size === v.length;
  if (raw?.format !== 1 || typeof raw.version !== "string" || !names(raw.regions) || !names(raw.parts)) throw new Error(`référence invalide (${file}) : format attendu { format: 1, version, regions: [...], parts: [...] }`);
  return raw;
}

/** Lit REGIONS et PARTS dans le texte d'un `allowlist.ts` (d'une ancienne version : on n'exécute rien). */
export function parseAllowlistText(text) {
  const pick = (name) => {
    const m = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(text);
    if (!m) throw new Error(`${name} introuvable dans la liste des pièces`);
    return [...m[1].matchAll(/"([a-z][a-z0-9.-]*)"/g)].map((x) => x[1]);
  };
  return { regions: pick("REGIONS"), parts: pick("PARTS") };
}

/** Pièces et régions d'une version du cœur dans git (étiquette, branche ou commit). */
export function allowlistAtRef(root, ref) {
  if (!/^[\w./][\w./-]{0,99}$/.test(ref)) throw new Error(`référence git invalide : ${ref}`);
  let text;
  try { text = execFileSync("git", ["show", `${ref}:src/core/skins/allowlist.ts`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error(`la référence git « ${ref} » n'est pas dans ce dépôt (essayez git fetch --tags --depth 50, ou utilisez le fichier ${BASELINE_FILE})`); }
  return parseAllowlistText(text);
}

/** Ce que le cœur courant a de plus que la référence. */
export function newNames(current, base) {
  return { regions: current.regions.filter((n) => !base.regions.includes(n)), parts: current.parts.filter((n) => !base.parts.includes(n)) };
}

/** Ce que la référence avait et que le cœur courant n'a plus (changement cassant : nouveau `skinContract`). */
export function removedNames(current, base) {
  return { regions: base.regions.filter((n) => !current.regions.includes(n)), parts: base.parts.filter((n) => !current.parts.includes(n)) };
}

// ── un skin contre la liste des nouveautés ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nouvelles régions et pièces que la couverture du skin dit ne pas cibler. */
export function uncoveredNew(coverage, nn) {
  if (!coverage) return { regions: [...nn.regions], parts: [...nn.parts] };
  return { regions: nn.regions.filter((n) => coverage.regions.missing.includes(n)), parts: nn.parts.filter((n) => coverage.parts.missing.includes(n)) };
}
export const countOf = (u) => u.regions.length + u.parts.length;

/** Chromium et Playwright sont-ils là ? `{ ok, reason }` (jamais d'exception). */
export async function browserAvailable() {
  try {
    const pw = await import("../../scripts/visual/lib/playwright.mjs");
    pw.loadPlaywright(); pw.chromiumPath();
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message ?? e).split("\n")[0].slice(0, 200) }; }
}

/**
 * Le contrôle complet. Options : root (dépôt du cœur), coreVersion, repo, ref (catalogue), baseline (fichier) ou since (réf git), visual (true / false / "auto"), strict, widths, onlyPages,
 * only (ids), neutrality, git (injectable pour les tests : `{ fetchCatalogue, fetchSkin }`). Rend le rapport ; ne lève que si le catalogue est illisible.
 */
export async function runOfficial(options) {
  const { root, coreVersion } = options;
  const { REGIONS, PARTS } = await lib("allowlist");
  const current = { regions: [...REGIONS], parts: [...PARTS] };
  const base = options.since ? allowlistAtRef(root, options.since) : readBaseline(path.resolve(root, options.baseline ?? BASELINE_FILE));
  const baseline = options.since ? { source: "git", ref: options.since } : { source: "file", file: options.baseline ?? BASELINE_FILE, version: base.version };
  const nn = newNames(current, base);
  const removed = removedNames(current, base);

  const { fetchCatalogueFromRepo } = await import("../../src/core/modules/recognized.ts");
  const { resolveSkinsRepo, sanitizeSkinEntries } = await lib("catalogue");
  const { fetchSkinSource } = await lib("source");
  const fetchCatalogue = options.git?.fetchCatalogue ?? fetchCatalogueFromRepo;
  const fetchSkin = options.git?.fetchSkin ?? fetchSkinSource;
  const repo = options.repo || resolveSkinsRepo();
  if (!repo) throw new Error("adresse du dépôt de skins invalide");
  const ref = options.ref || process.env.CURIOSA_SKINS_REF || "HEAD";
  const got = await fetchCatalogue(repo, ref);
  let entries = sanitizeSkinEntries(got.index, coreVersion);
  if (options.only?.length) entries = entries.filter((e) => options.only.includes(e.id));

  const browser = options.visual === false ? { ok: false, reason: "--no-visual" } : await browserAvailable();
  const { checkOne } = await import("./check.mjs");
  const skins = [];
  for (const e of entries) {
    const row = { id: e.id, version: e.version, ref: e.ref, requiresCore: e.requires?.core };
    let fetched;
    try { fetched = await fetchSkin(e.repo, e.ref, e.subdir); }
    catch (err) {
      row.ok = false; row.fetchError = String(err?.message ?? err).split("\n")[0].slice(0, 200); row.issues = []; row.uncovered = uncoveredNew(null, nn);
      skins.push(row); continue;
    }
    try {
      const r = await checkOne(fetched.root, {
        coreVersion, coverage: true, strict: !!options.strict, visual: browser.ok, neutrality: options.neutrality, widths: options.widths, onlyPages: options.onlyPages,
      });
      // « le navigateur n'a pas pu démarrer » = niveau sauté (dit en clair), pas un skin refusé
      const unavailable = r.issues.some((i) => i.code === "kit-browser-unavailable");
      const issues = r.issues.filter((i) => i.code !== "kit-browser-unavailable");
      const bad = (i) => i.severity === "error" || (options.strict && i.severity === "warning");
      Object.assign(row, {
        skinVersion: r.version, issues, ok: !issues.some(bad), coverage: r.coverage, uncovered: uncoveredNew(r.coverage, nn),
        visual: browser.ok && !unavailable ? "ran" : "skipped",
        versionMismatch: r.version && e.version && r.version !== e.version ? { catalogue: e.version, skin: r.version } : undefined,
      });
    } finally { fetched.cleanup?.(); }
    skins.push(row);
  }
  const uncoveredSkins = skins.filter((s) => countOf(s.uncovered) > 0 && !s.fetchError);
  const ok = skins.every((s) => s.ok);
  const failOnUncovered = !!options.failOnUncovered;
  const exitCode = !ok ? 1 : failOnUncovered && uncoveredSkins.length ? 1 : 0;
  return {
    tool: "skin:official", format: 1, coreVersion, catalogue: { repo, ref, count: entries.length }, baseline, newNames: nn, removed,
    browser: browser.ok ? { ran: true } : { ran: false, reason: browser.reason }, strict: !!options.strict, failOnUncovered, ok, exitCode, skins,
  };
}

// ── présentation ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const nameList = (u, lang) => [...u.regions.map((r) => `${r} (${lang === "fr" ? "région" : "region"})`), ...u.parts];

function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => [...String(r[i])].length)));
  const line = (r) => r.map((c, i) => String(c) + " ".repeat(w[i] - [...String(c)].length)).join(" | ").trimEnd();
  return [line(rows[0]), w.map((n) => "-".repeat(n)).join("-+-"), ...rows.slice(1).map(line)];
}

export function toText(report, lang = "fr") {
  const T = (fr, en) => (lang === "fr" ? fr : en);
  const L = [];
  const nn = report.newNames, nnCount = nn.regions.length + nn.parts.length;
  L.push(T(`Skins officiels contre le cœur ${report.coreVersion} (catalogue : ${report.catalogue.repo}, ${report.catalogue.count} skin(s)).`, `Official skins against core ${report.coreVersion} (catalogue: ${report.catalogue.repo}, ${report.catalogue.count} skin(s)).`));
  const baseTxt = report.baseline.source === "git" ? T(`l'étiquette ${report.baseline.ref}`, `${report.baseline.ref}`) : T(`${report.baseline.file} (cœur ${report.baseline.version})`, `${report.baseline.file} (core ${report.baseline.version})`);
  L.push(nnCount
    ? T(`Éléments NOUVEAUX depuis ${baseTxt} : ${nameList(nn, lang).join(", ")}.`, `NEW elements since ${baseTxt}: ${nameList(nn, lang).join(", ")}.`)
    : T(`Aucun élément nouveau depuis ${baseTxt} : rien à habiller.`, `No new element since ${baseTxt}: nothing to dress.`));
  L.push(report.browser.ran
    ? T("Contrôle dans un navigateur : lancé.", "In-browser check: run.")
    : T(`Contrôle dans un navigateur : SAUTÉ (${report.browser.reason}).`, `In-browser check: SKIPPED (${report.browser.reason}).`));
  const rem = report.removed;
  if (rem.regions.length + rem.parts.length) L.push(T(`⚠️  Éléments RETIRÉS depuis la référence : ${nameList(rem, lang).join(", ")}. C'est un changement cassant (nouveau skinContract, docs/SKINS.md §9.2).`, `⚠️  Elements REMOVED since the reference: ${nameList(rem, lang).join(", ")}. This is a breaking change (new skinContract, docs/SKINS.md §9.2).`));
  L.push("");
  const head = [T("Skin", "Skin"), T("Version", "Version"), T("Valide ?", "Valid?"), T("Navigateur", "Browser"), T("Nouveautés non habillées", "New, not dressed")];
  const rows = [head, ...report.skins.map((s) => [
    s.id, s.skinVersion ?? s.version ?? "?", s.fetchError ? T("non (introuvable)", "no (not found)") : s.ok ? T("oui", "yes") : T("NON", "NO"),
    s.fetchError ? "-" : s.visual === "ran" ? T("oui", "yes") : T("sauté", "skipped"),
    s.fetchError ? "-" : !nnCount ? T("(aucune nouveauté)", "(nothing new)") : countOf(s.uncovered) ? `${countOf(s.uncovered)}/${nnCount} : ${nameList(s.uncovered, lang).join(", ")}` : T(`0/${nnCount} (tout habillé)`, `0/${nnCount} (all dressed)`),
  ])];
  L.push(...table(rows), "");
  for (const s of report.skins) {
    if (s.fetchError) { L.push(`❌ ${s.id} — ${T("récupération impossible", "could not be fetched")} (${s.ref ?? "?"}) : ${s.fetchError}`); continue; }
    for (const i of s.issues.filter((x) => x.severity === "error" || (report.strict && x.severity === "warning"))) L.push(`❌ ${s.id} — ${i.message[lang]}\n      ${T("Comment corriger", "How to fix")} : ${i.hint[lang]}   [${i.code}]${i.where ? ` (${i.where})` : ""}`);
    if (s.versionMismatch) L.push(`⚠️  ${s.id} — ${T(`le catalogue annonce ${s.versionMismatch.catalogue} mais le skin porte ${s.versionMismatch.skin}.`, `the catalogue says ${s.versionMismatch.catalogue} but the skin says ${s.versionMismatch.skin}.`)}`);
  }
  const unc = report.skins.filter((s) => !s.fetchError && countOf(s.uncovered) > 0);
  if (unc.length) {
    L.push("", `${report.failOnUncovered ? "❌" : "⚠️ "} ${T("AVERTISSEMENT : des éléments nouveaux ne sont habillés par aucune règle de ces skins :", "WARNING: new elements are not dressed by any rule of these skins:")}`);
    for (const s of unc) L.push(`   - ${s.id} : ${nameList(s.uncovered, lang).join(", ")}`);
    L.push(T("   Que faire : ajoutez la règle au skin (version corrective ou mineure du skin, `requires.core` à jour), étiquetez `<id>/vX.Y.Z` et mettez le catalogue à jour,", "   What to do: add the rule to the skin (a patch or minor version of the skin, `requires.core` up to date), tag `<id>/vX.Y.Z` and update the catalogue,"),
      T("   puis relancez cette commande. Sans règle, l'élément garde l'aspect du skin de base : rien ne casse, mais il peut jurer avec le thème.", "   then run this command again. Without a rule the element keeps the basic skin look: nothing breaks, but it may clash with the theme."));
  }
  const bad = report.skins.filter((s) => !s.ok);
  L.push("", bad.length
    ? T(`${bad.length} skin(s) sur ${report.skins.length} à corriger.`, `${bad.length} of ${report.skins.length} skin(s) to fix.`)
    : unc.length
      ? report.failOnUncovered ? T("Tous les skins sont valides, mais des éléments nouveaux ne sont pas habillés (--fail-on-uncovered).", "All skins are valid, but new elements are not dressed (--fail-on-uncovered).") : T(`Tous les skins sont valides (${report.skins.length}). Avertissement ci-dessus : à traiter avant la publication du cœur.`, `All skins are valid (${report.skins.length}). Warning above: deal with it before publishing the core.`)
      : T(`Tout va bien : ${report.skins.length} skin(s) valide(s), rien de nouveau sans habillage.`, `All good: ${report.skins.length} skin(s) valid, nothing new left undressed.`));
  return L.join("\n");
}

export function toJson(report) {
  return JSON.stringify({
    ...report,
    skins: report.skins.map((s) => ({
      id: s.id, version: s.skinVersion ?? s.version, ref: s.ref, ok: s.ok, visual: s.visual, ...(s.fetchError ? { fetchError: s.fetchError } : {}), uncoveredNew: s.uncovered,
      ...(s.coverage ? { coverage: { regions: { missing: s.coverage.regions.missing }, parts: { missing: s.coverage.parts.missing }, tokens: { missing: s.coverage.tokens.missing } } } : {}),
      issues: s.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message, hint: i.hint, ...(i.where ? { where: i.where } : {}) })),
    })),
  }, null, 2);
}
