// Le kit de test des skins (docs/SKINS.md §13) : `checkTargets()` contrôle un ou plusieurs dossiers (un skin, ou un dépôt de skins avec `skins/<id>/`) et rend un
// rapport. Utilisé par `npm run skin:check` (scripts/skin-check.mjs) et par les tests. Les niveaux statiques tournent toujours ; le niveau navigateur
// (`visual: true`) lance Chromium sur un site de démonstration minimal (voir ./visual/run.mjs).
import fs from "node:fs";
import path from "node:path";
import { buildReport, summarize } from "./report.mjs";
import { staticCheck } from "./static.mjs";

/** Les dossiers de skins à contrôler : le dossier lui-même, ou chaque `skins/<id>` d'un dépôt. */
export function skinDirs(dir) {
  if (fs.existsSync(path.join(dir, "skin.json"))) return [dir];
  const base = path.join(dir, "skins");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(base, e.name)).filter((d) => fs.existsSync(path.join(d, "skin.json"))).sort();
}

export async function checkTargets(targets, options = {}) {
  const skins = [];
  for (const t of targets) {
    const dir = path.resolve(t);
    const list = skinDirs(dir);
    if (!list.length) { skins.push({ dir, name: path.basename(dir), id: path.basename(dir), noSkin: true, issues: [], ok: false, levels: {}, fatal: true }); continue; }
    for (const d of list) skins.push(await checkOne(d, options));
  }
  return buildReport({ coreVersion: options.coreVersion, skins, strict: options.strict, visual: options.visual });
}

export async function checkOne(dir, options = {}) {
  const st = await staticCheck(dir, options);
  const issues = [...st.issues];
  const ran = {};
  let visualInfo = null;
  if (options.visual) {
    const { visualCheck } = await import("./visual/run.mjs");
    const v = await visualCheck(st, options);
    issues.push(...v.issues);
    visualInfo = v.info;
  } else ran.browser = false;
  return {
    dir: st.dir, id: st.manifest?.id ?? path.basename(dir), version: st.manifest?.version, ok: !issues.some((i) => i.severity === "error"),
    issues, levels: summarize(issues, ran), coverage: st.coverage,
    stats: { files: st.files.length, bytes: st.validation.totalBytes, fingerprint: st.validation.fingerprint, ...(visualInfo ? { visual: visualInfo } : {}) },
  };
}
