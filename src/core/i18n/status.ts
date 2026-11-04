import { prisma } from "../db";
import { getSiteConfig } from "../settings";
import { moduleDir } from "../modules/registry";
import { auditDictionaries, languageLabel, pickText } from "./audit.mjs";
import { DICTIONARIES } from "./dictionary";
import { languageStatus, localeName, REQUIRED_LOCALES } from "./locales";
import { moduleI18nReport, readModuleTexts, type ModuleI18nReport } from "./moduleStatus";

/**
 * THE I18N STATUS of the site: for every language, how complete the interface and the installed modules are; for every installed module, what is missing.
 * Read by the admin (Settings > Languages) and by the AI assistant (`maintenance_modules`, `maintenance_status`). Reads files only: no module code is run.
 */
export type LanguageStatusRow = {
  code: string;
  name: string;
  /** "official" (English, French: always complete) or "community" (any other language: may be partial). */
  status: "official" | "community";
  /** The site publishes in this language. */
  enabled: boolean;
  /** Share of the interface texts translated (0 to 100) and the label to show: "complete" or "partial: 82%". */
  interface: { percent: number; missing: number; label: string };
  /** Share of the texts of the installed modules translated (0 to 100). */
  modules: { percent: number };
};
export type ModuleStatusRow = { id: string; name: string; errors: number; advisories: number; languages: Record<string, number>; gaps: ModuleI18nReport["gaps"] };
export type I18nStatus = {
  languages: LanguageStatusRow[];
  modules: ModuleStatusRow[];
  /** Installed modules with at least one missing English or French text, and how many modules are installed. */
  summary: { modulesWithGaps: number; modulesTotal: number; missingTexts: number };
};

export async function i18nStatus(): Promise<I18nStatus> {
  const config = await getSiteConfig();
  const main = config.defaultLocale;
  const adminLocale = config.adminLocale ?? main;
  const rows = await prisma.module.findMany({ select: { id: true } });
  const modules: ModuleStatusRow[] = [];
  for (const { id } of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    const texts = readModuleTexts(moduleDir(id));
    if (!texts) continue;
    const report = moduleI18nReport(texts.manifest, texts.locales);
    const name = pickText((texts.manifest as { name?: string | Record<string, string> }).name, adminLocale, main) || id;
    modules.push({ id, name, errors: report.errors, advisories: report.advisories, languages: report.languages, gaps: report.gaps });
  }
  const ui = auditDictionaries(DICTIONARIES);
  const codes = [...new Set<string>([...REQUIRED_LOCALES, ...Object.keys(DICTIONARIES), ...config.locales, ...modules.flatMap((m) => Object.keys(m.languages))])];
  const languages = codes.map((code): LanguageStatusRow => {
    const interfaceAudit = ui[code];
    const percent = interfaceAudit?.percent ?? 0;
    const status = languageStatus(code);
    const shares = modules.map((m) => m.languages[code] ?? 0);
    return {
      code, name: localeName(code), status, enabled: config.locales.includes(code),
      interface: { percent, missing: interfaceAudit ? interfaceAudit.missing.length : 0, label: languageLabel({ status, percent }).coverage },
      modules: { percent: shares.length ? Math.floor(shares.reduce((a, b) => a + b, 0) / shares.length) : 100 },
    };
  });
  // English and French first, then the languages of the site, then the others by name.
  languages.sort((a, b) => Number(b.status === "official") - Number(a.status === "official") || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  return {
    languages, modules,
    summary: { modulesWithGaps: modules.filter((m) => m.errors > 0).length, modulesTotal: modules.length, missingTexts: modules.reduce((n, m) => n + m.errors, 0) },
  };
}
