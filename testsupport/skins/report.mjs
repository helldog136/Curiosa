// Mise en forme du rapport du kit : texte lisible (mots simples, FR ou EN) et JSON. Un rapport = { tool, coreVersion, ok, exitCode, skins: [...] }.
import { LEVELS, LEVEL_TITLE } from "./levels.mjs";


/** Résume les problèmes d'un skin par niveau : { level: { errors, warnings, advice } }. */
export function summarize(issues, ran = {}) {
  const out = {};
  for (const level of LEVELS) {
    const list = issues.filter((i) => i.level === level);
    out[level] = {
      ran: ran[level] !== false,
      errors: list.filter((i) => i.severity === "error").length,
      warnings: list.filter((i) => i.severity === "warning").length,
      advice: list.filter((i) => i.severity === "advice").length,
    };
  }
  return out;
}

export function skinFails(skin, strict) {
  return skin.issues.some((i) => i.severity === "error" || (strict && i.severity === "warning")) || skin.fatal === true;
}

export function buildReport({ coreVersion, skins, strict, visual }) {
  const failed = skins.filter((s) => skinFails(s, strict));
  return { tool: "skin:check", format: 1, coreVersion, strict: !!strict, visual: !!visual, ok: failed.length === 0, exitCode: failed.length ? 1 : 0, skins };
}

export function toJson(report) {
  return JSON.stringify({
    ...report,
    skins: report.skins.map((s) => ({
      id: s.id, version: s.version, dir: s.dir, ok: s.ok, levels: s.levels, stats: s.stats, ...(s.coverage ? { coverage: s.coverage } : {}),
      issues: s.issues.map((i) => ({ code: i.code, level: i.level, severity: i.severity, message: i.message, hint: i.hint, ...(i.where ? { where: i.where } : {}) })),
      ...(s.noSkin ? { noSkin: true } : {}),
    })),
  }, null, 2);
}

/** La couverture en entier (option --coverage) : ce que le skin règle et ce qu'il laisse au skin de base. */
export function coverageLines(c, lang = "fr") {
  const T = (fr, en) => (lang === "fr" ? fr : en);
  const row = (fr, en, g, targeted) => `   · ${T(`${fr} :`, `${en}:`)} ${g[targeted].length} / ${g.total}${g.missing.length ? `\n       ${T("ce qui reste au skin de base :", "left to the basic skin:")} ${g.missing.join(", ")}` : ""}`;
  return [
    `   ${T("Couverture (conseil : un skin peut laisser le skin de base habiller un élément)", "Coverage (advice: a skin may let the basic skin dress an element)")}`,
    row("Régions réglées", "Regions styled", c.regions, "targeted"),
    row("Pièces réglées", "Parts styled", c.parts, "targeted"),
    row("Jetons fixés", "Tokens set", c.tokens, "set"),
  ];
}

export function toText(report, lang = "fr", { detail = false } = {}) {
  const T = (fr, en) => (lang === "fr" ? fr : en);
  const lines = [];
  for (const s of report.skins) {
    if (s.noSkin) { lines.push(`❌ ${s.name} — ${T("aucun skin.json ici (ni dans skins/<id>/).", "no skin.json here (nor in skins/<id>/).")}`, ""); continue; }
    const errors = s.issues.filter((i) => i.severity === "error");
    const warnings = s.issues.filter((i) => i.severity === "warning");
    const bad = skinFails(s, report.strict);
    lines.push(`${bad ? "❌" : warnings.length ? "⚠️ " : "✅"} ${s.id}${s.version ? ` ${s.version}` : ""} — ${bad
      ? T("à corriger : il ne serait pas accepté", "to fix: it would not be accepted")
      : T(`valide (${s.stats?.files ?? "?"} fichiers, ${Math.ceil((s.stats?.bytes ?? 0) / 1024)} Ko)`, `valid (${s.stats?.files ?? "?"} files, ${Math.ceil((s.stats?.bytes ?? 0) / 1024)} KB)`)}`);
    // niveaux
    for (const level of LEVELS) {
      const l = s.levels[level];
      if (level === "browser" && !report.visual) { lines.push(`   ${"·"} ${LEVEL_TITLE[level][lang]} — ${T("non lancé (ajoutez --visual)", "not run (add --visual)")}`); continue; }
      if (!l.ran) { lines.push(`   ${"·"} ${LEVEL_TITLE[level][lang]} — ${T("non lancé", "not run")}`); continue; }
      const mark = l.errors ? "❌" : l.warnings ? "⚠️ " : "✅";
      const bits = [l.errors && T(`${l.errors} erreur(s)`, `${l.errors} error(s)`), l.warnings && T(`${l.warnings} avertissement(s)`, `${l.warnings} warning(s)`), l.advice && T(`${l.advice} conseil(s)`, `${l.advice} tip(s)`)].filter(Boolean).join(", ");
      lines.push(`   ${mark} ${LEVEL_TITLE[level][lang]}${bits ? ` — ${bits}` : ""}`);
    }
    for (const i of errors) lines.push(`   ❌ ${i.message[lang]}\n      ${T("Comment corriger", "How to fix")} : ${i.hint[lang]}   [${i.code}]${i.where ? ` (${i.where})` : ""}`);
    for (const i of warnings) lines.push(`   ⚠️  ${i.message[lang]}${i.hint[lang] ? `\n      ${i.hint[lang]}` : ""}   [${i.code}]${i.where ? ` (${i.where})` : ""}`);
    if (detail || report.advice) for (const i of s.issues.filter((x) => x.severity === "advice")) lines.push(`   💡 ${i.message[lang]}${i.hint[lang] ? `\n      ${i.hint[lang]}` : ""}   [${i.code}]`);
    if (report.coverage && s.coverage) lines.push(...coverageLines(s.coverage, lang));
    lines.push("");
  }
  const failed = report.skins.filter((s) => skinFails(s, report.strict));
  lines.push(failed.length
    ? T(`${failed.length} skin(s) sur ${report.skins.length} à corriger.`, `${failed.length} of ${report.skins.length} skin(s) to fix.`)
    : T(`Tout va bien : ${report.skins.length} skin(s) contrôlé(s).`, `All good: ${report.skins.length} skin(s) checked.`));
  return lines.join("\n");
}
