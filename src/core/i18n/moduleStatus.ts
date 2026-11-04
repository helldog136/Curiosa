import fs from "node:fs";
import path from "node:path";
import { applyTranslations, auditDictionaries, auditManifest, REQUIRED_LANGUAGES, type Gap } from "./audit.mjs";

/**
 * The translation status of ONE module, from its `module.json` (raw or parsed) and its `locales/*.json`. Pure: no database, no network.
 * English and French are required (a gap is an `error`); any other language may be partial (its coverage is reported, never refused).
 */
export type ModuleI18nReport = {
  /** Missing, empty, untagged or inconsistent texts in English or French (manifest + locale files). Zero = complete. */
  errors: number;
  /** MCP tool descriptions without a French translation: reported, never blocking (they are written for an AI assistant, in English). */
  advisories: number;
  /** Per language: share of the texts that exist (0 to 100). English and French are always listed. */
  languages: Record<string, number>;
  /** The first gaps, for display (50 at most). */
  gaps: { where: string; lang: string; problem: string }[];
};

export type LocaleFiles = Record<string, Record<string, string>>;

export function moduleI18nReport(manifest: unknown, locales: LocaleFiles = {}): ModuleI18nReport {
  // Languages added with files only (`locales/<code>.json`, keys `manifest.<path>`) count as part of the manifest texts.
  const audit = auditManifest(applyTranslations(structuredClone(manifest), locales));
  const gaps: ModuleI18nReport["gaps"] = audit.errors.map((g: Gap) => ({ where: g.path, lang: g.lang, problem: g.problem }));
  const languages: Record<string, number> = Object.fromEntries(Object.entries(audit.languages).map(([l, s]) => [l, s.percent]));
  let errors = audit.errors.length;
  const codes = Object.keys(locales);
  if (codes.length) {
    // The reference of a module's locale files is the union of what English and French declare: a text in only one of them is a gap in the other.
    const union = { ...(locales.fr ?? {}), ...(locales.en ?? {}) };
    const result = auditDictionaries({ ...locales, _union: union }, { reference: "_union" });
    for (const [lang, r] of Object.entries(result)) {
      if (lang === "_union") continue;
      const required = REQUIRED_LANGUAGES.includes(lang);
      if (required) for (const [problem, keys] of [["missing", r.missing], ["empty", r.empty], ["variables", r.variables]] as const) for (const k of keys) { errors++; gaps.push({ where: `locales/${lang}.json:${k}`, lang, problem }); }
      // Share of the whole module: locale keys count with the manifest texts.
      const total = (languages[lang] !== undefined ? audit.total : 0) + r.total;
      const translated = Math.round(((languages[lang] ?? 0) / 100) * audit.total) + r.translated;
      languages[lang] = total ? Math.floor((100 * translated) / total) : 100;
    }
  }
  for (const lang of REQUIRED_LANGUAGES) languages[lang] ??= 0;
  return { errors, advisories: audit.advisories.length, languages, gaps: gaps.slice(0, 50) };
}

/** Reads `module.json` and `locales/*.json` of a module folder. A folder that cannot be read gives `null` (nothing to say). */
export function readModuleTexts(dir: string): { manifest: unknown; locales: LocaleFiles } | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
    const locales: LocaleFiles = {};
    const localesDir = path.join(dir, "locales");
    if (fs.existsSync(localesDir)) for (const file of fs.readdirSync(localesDir)) if (file.endsWith(".json")) locales[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
    return { manifest, locales };
  } catch { return null; }
}

/** A note (never a refusal) for an installation or an update: the module lacks English or French texts. */
export type I18nWarning = { code: "i18n"; errors: number; languages: string[]; examples: string[] };

export function i18nWarning(dir: string): I18nWarning | null {
  const texts = readModuleTexts(dir);
  if (!texts) return null;
  const report = moduleI18nReport(texts.manifest, texts.locales);
  if (!report.errors) return null;
  const languages = REQUIRED_LANGUAGES.filter((l) => report.gaps.some((g) => g.lang === l || g.lang === "*"));
  return { code: "i18n", errors: report.errors, languages, examples: report.gaps.slice(0, 5).map((g) => `${g.where} [${g.lang}] ${g.problem}`) };
}
