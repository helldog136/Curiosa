// Mise en forme du rapport : texte simple pour une personne, JSON pour une IA ou un outil.
import { GROUPS, LEVELS } from "./requirements/index.mjs";

const ICON = { pass: "✅", fail: "❌", advice: "⚠️ ", na: "➖", skip: "⏭️ ", error: "❌" };

const wrap = (text, indent, width = 100) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width - indent.length) { lines.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
};

/** Texte lisible par une personne non experte. */
export function formatText(report, { color = false, verbose = false } = {}) {
  const c = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const out = [];
  const m = report.module;
  out.push(c("1", `Vérification du module « ${m.id ?? m.folder} »${m.version ? ` (version ${m.version})` : ""}`));
  out.push(`Dossier : ${m.dir}`);
  out.push(`Cœur de référence : Curiosa ${report.core.version} · API des modules ${report.core.apiVersion}`);
  out.push("");
  out.push("Légende : ✅ réussi · ❌ échec (obligatoire : à corriger) · ⚠️  conseil non suivi · ➖ sans objet pour ce module");
  out.push("");
  for (const [group, title] of Object.entries(GROUPS)) {
    const rows = report.results.filter((r) => r.group === group);
    if (!rows.length) continue;
    out.push(c("1;36", `■ ${title}`));
    for (const r of rows) {
      const failed = r.status === "fail";
      const icon = failed ? (r.level === "mandatory" ? ICON.fail : ICON.advice) : ICON[r.status];
      if (r.status === "pass") out.push(`  ${icon} réussi : ${r.title}${verbose ? `  [${r.id}]` : ""}`);
      else if (r.status === "na") out.push(`  ${icon} sans objet : ${r.title} (${r.note})`);
      else if (r.status === "skip") out.push(`  ${icon} non vérifié : ${r.title} (${r.note})`);
      else {
        out.push(c(r.level === "mandatory" ? "31" : "33", `  ${icon} ${r.level === "mandatory" ? "échec (obligatoire)" : "conseil"} : ${r.title}  [${r.id}]`));
        out.push("      Ce qui ne va pas :");
        for (const p of r.problems.slice(0, 8)) out.push(wrap(`• ${p}`, "        "));
        if (r.problems.length > 8) out.push(`        … et ${r.problems.length - 8} autre(s)`);
        out.push("      Pourquoi c'est demandé :");
        out.push(wrap(r.why, "        "));
        out.push("      Comment corriger :");
        out.push(wrap(r.fix, "        "));
        out.push(`      En savoir plus : ${r.doc}`);
      }
    }
    out.push("");
  }
  const s = report.summary;
  out.push(c("1", "Résumé"));
  out.push(`  Obligatoires : ${s.mandatory.passed} réussies, ${s.mandatory.failed} en échec${s.mandatory.na ? `, ${s.mandatory.na} sans objet` : ""}${s.mandatory.skipped ? `, ${s.mandatory.skipped} non vérifiée(s)` : ""}.`);
  out.push(`  Conseils : ${s.advice.passed} suivis, ${s.advice.failed} non suivis${s.advice.na ? `, ${s.advice.na} sans objet` : ""}.`);
  out.push("");
  out.push(s.ok
    ? c("32", "✅ Ce module respecte toutes les exigences obligatoires : il peut être proposé dans le catalogue." + (s.advice.failed ? " (Les conseils ci-dessus l'amélioreraient encore.)" : ""))
    : c("31", `❌ ${s.mandatory.failed} exigence(s) obligatoire(s) à corriger avant de proposer ce module au catalogue. Corrigez les ❌ ci-dessus, puis relancez la même commande.`));
  return out.join("\n");
}

/** Tableau module × exigence pour plusieurs rapports (✔ réussi, ✘ échec obligatoire, ! conseil non suivi, · sans objet ou non vérifié). */
export function formatMatrix(reports) {
  const ids = reports[0]?.results.map((r) => r.id) ?? [];
  const lines = [];
  const mark = (r) => (r.status === "pass" ? "ok" : r.status === "fail" ? (r.level === "mandatory" ? "ECHEC" : "conseil") : "-");
  lines.push(["module", ...ids].join("\t"));
  for (const rep of reports) lines.push([rep.module.id ?? rep.module.folder, ...rep.results.map(mark)].join("\t"));
  return lines.join("\n");
}

export { LEVELS };
