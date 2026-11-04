// MODULE I18N for the test kit: the audit of the texts of a module, and the RATCHET of known gaps.
// The rules live in src/core/i18n/audit.mjs (one source; the modules repository keeps a verbatim copy in tests/helpers/i18nAudit.mjs).
//
// Ratchet (same idea as the ergonomics baseline): `tests/i18n-baseline.json` lists the KNOWN gaps of each module (`{ version: 1, modules: { id: [keys] } }`).
//   - a known gap          -> advice (i18n.complete.known)
//   - a NEW gap            -> failure (i18n.complete)
//   - a known gap that disappeared -> failure ("remove this line from the baseline"): the baseline can only shrink.
export * from "../src/core/i18n/audit.mjs";
import { auditManifest } from "../src/core/i18n/audit.mjs";

/** The blocking gaps (English or French missing, untagged text, empty, other {variables}, bad language code, bad `i18n` block) of a parsed `module.json`. */
export function manifestGaps(manifest) {
  return auditManifest(manifest).errors;
}

/** { tolerated, fresh, stale } from the gaps found and the keys known in the baseline for this module. */
export function compareI18nBaseline(gaps, known) {
  const knownSet = new Set(known ?? []);
  const now = new Set(gaps.map((g) => g.key));
  return { tolerated: gaps.filter((g) => knownSet.has(g.key)), fresh: gaps.filter((g) => !knownSet.has(g.key)), stale: [...knownSet].filter((k) => !now.has(k)).sort() };
}

/** Reads a baseline (already parsed): null when absent or unreadable. */
export function parseI18nBaseline(value) {
  if (!value || typeof value !== "object" || value.version !== 1 || !value.modules || typeof value.modules !== "object") return null;
  return { modules: Object.fromEntries(Object.entries(value.modules).map(([id, keys]) => [id, Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : []])) };
}

const SAY = { untagged: "is a plain text without a language", missing: "is missing", empty: "is empty", variables: "does not use the same {variables} as English", code: "is not a language code", overlay: "is not valid" };
export const describeGap = (g) => `${g.path}${g.lang === "*" ? "" : ` [${g.lang}]`} ${SAY[g.problem] ?? g.problem}${g.detail ? ` (${g.detail})` : ""}`;
