// Requirements on the languages of a module's texts (docs/TRANSLATING.md): English AND French are always supported.
// Ratchet: `tests/i18n-baseline.json` (modules repository) lists the known gaps; see ../i18n.mjs.
import fs from "node:fs";
import path from "node:path";
import { compareI18nBaseline, describeGap, manifestGaps, parseI18nBaseline } from "../i18n.mjs";

/** The baseline for this module: option `i18nBaseline` (object, path or `false`), else <repo>/tests/i18n-baseline.json (modules repository: <repo>/modules/<id>), else <module>/i18n-baseline.json. */
function findBaseline(m) {
  const opt = m.opts?.i18nBaseline;
  if (opt === false) return null;
  if (opt && typeof opt === "object") return parseI18nBaseline(opt);
  const files = typeof opt === "string" ? [opt] : [path.join(m.dir, "..", "..", "tests", "i18n-baseline.json"), path.join(m.dir, "i18n-baseline.json")];
  for (const f of files) {
    try { if (fs.existsSync(f)) return parseI18nBaseline(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { /* unreadable baseline: as if absent */ }
  }
  return null;
}

function inspect(m) {
  const gaps = manifestGaps(m.manifest);
  const baseline = findBaseline(m);
  return { gaps, baseline, ...compareI18nBaseline(gaps, baseline?.modules?.[m.name] ?? []) };
}

const requirements = [
  {
    id: "i18n.complete", level: "mandatory", group: "i18n",
    title: "Every text of module.json is declared in English and in French",
    what: "Name, description, privacy statement, setting labels and help, tab and group labels, rights, panels, overlay elements, dashboard texts, entry templates and onboarding texts are written as { \"en\": \"...\", \"fr\": \"...\" }: both languages present, not empty, with the same {variables}, valid language codes. A plain string has no language and is refused. Other languages may be added and may be partial (missing texts fall back to English). Known gaps listed in tests/i18n-baseline.json are tolerated (see i18n.complete.known); a NEW gap fails, and a known gap that disappeared must be removed from the baseline.",
    why: "English and French are always supported. A text that exists in one language only shows an empty line or, worse, another language to the person who reads it. The fallback chain is the requested language, then the main language of the site, then English, never French by accident.",
    fix: "Replace the plain string by { \"en\": \"...\", \"fr\": \"...\" } (see docs/TRANSLATING.md). Never add a line to the baseline to silence a new gap.",
    run(m) {
      if (!m.manifest) return { skip: "module.json unreadable" };
      const r = inspect(m);
      const out = r.fresh.map(describeGap);
      for (const key of r.stale) out.push(`the baseline lists a gap that no longer exists: ${key} (remove it from tests/i18n-baseline.json)`);
      return out;
    },
  },
  {
    id: "i18n.complete.known", level: "advice", group: "i18n",
    title: "Known translation gaps, to be fixed",
    what: "Texts of module.json that are still missing in English or French (the ones listed in tests/i18n-baseline.json).",
    why: "They are debt: the baseline may only shrink.",
    fix: "Translate the text, then remove its line from the baseline (node scripts/i18n-baseline.mjs --write in the modules repository).",
    run(m) {
      if (!m.manifest) return { skip: "module.json unreadable" };
      const r = inspect(m);
      const counts = {};
      for (const g of r.tolerated) counts[g.problem] = (counts[g.problem] ?? 0) + 1;
      return r.tolerated.length ? [`${r.tolerated.length} known gap(s) (${Object.entries(counts).map(([k, n]) => `${k} x${n}`).join(", ")}), for example ${describeGap(r.tolerated[0])}`] : [];
    },
  },
];

export default requirements;
