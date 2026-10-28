// Niveaux STATIQUES du kit de test des skins (docs/SKINS.md §13) : manifeste, ressources, jetons, feuille, principe fondateur, lisibilité, neutralité.
// Reprend `validateSkinFolder()` du cœur (ce qui passe ici passe à l'installation) et ajoute ce que seul le kit contrôle : jetons inconnus et jetons de modules,
// valeurs refusées à la composition, corrections de lisibilité à prévoir, taille des aperçus, polices et images inutilisées, points de rupture, tailles minimales, neutralité.
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "./imageinfo.mjs";
import { levelOfCode } from "./levels.mjs";
import { kitIssue } from "./messages.mjs";
import { loadRulesText, parseRules, violations } from "./neutrality.mjs";
import { moduleLayer, readModules } from "./modules.mjs";

const lib = async (name) => import(`../../src/core/skins/${name}.ts`);

/** Un problème de la bibliothèque du cœur → forme du kit. Les conseils de lisibilité (AAA) deviennent des `advice`. */
export function fromLib(i) {
  return {
    code: i.code, level: levelOfCode(i.code), severity: i.code === "read-advice" ? "advice" : i.severity,
    message: i.message, hint: i.hint, ...(i.line ? { where: `skin.css:${i.line}${i.column ? `:${i.column}` : ""}` } : {}),
  };
}

const px = (value) => {
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(String(value).trim());
  return m ? Number(m[1]) * (m[2] === "px" ? 1 : 16) : null;
};

/** Largeurs (px) où la feuille source change la mise en page. */
function sheetBreakpoints(css) {
  const found = new Set();
  for (const m of css.matchAll(/@media[^{]*?\(\s*(?:min|max)-width\s*:\s*(-?\d*\.?\d+)(px|em|rem)\s*\)/gi)) found.add(Math.round(Number(m[1]) * (m[2] === "px" ? 1 : 16)));
  for (const m of css.matchAll(/@media[^{]*?\(\s*width\s*(?:<=|>=|<|>)\s*(-?\d*\.?\d+)(px|em|rem)\s*\)/gi)) found.add(Math.round(Number(m[1]) * (m[2] === "px" ? 1 : 16)));
  return [...found].filter((w) => w >= 320 && w <= 2560).sort((a, b) => a - b);
}

/** Réglages de taille posés sur les pièces de contenu : cibles, interligne, taille du texte (sur la feuille assainie). */
async function sizeAdvice(sanitizedCss, add) {
  const postcss = (await import("postcss")).default;
  let root;
  try { root = postcss.parse(sanitizedCss); } catch { return; }
  const CLICK = new Set(["button", "field", "nav-link", "chip", "input", "textarea", "submenu-toggle", "menu-toggle", "pagination-link"]);
  const BODY = new Set(["prose", "lead", "list-item", "card", "quote"]);
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    for (const sel of rule.selectors ?? []) {
      const last = sel.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
      const part = /data-skin-part="([a-z0-9.-]+)"/.exec(last)?.[1];
      if (!part || /::|:before|:after/.test(last)) continue;
      rule.walkDecls((d) => {
        const prop = d.prop.toLowerCase();
        if (CLICK.has(part) && (prop === "min-height" || prop === "height")) { const v = px(d.value); if (v !== null && v < 44) add(kitIssue("kit-target-small", { part, value: `${prop}: ${d.value}` })); }
        if (BODY.has(part) && prop === "line-height" && /^\d*\.?\d+$/.test(d.value.trim()) && Number(d.value) < 1.4) add(kitIssue("kit-leading-low", { part, value: d.value }));
        if (BODY.has(part) && prop === "font-size") { const v = px(d.value); if (v !== null && v < 14) add(kitIssue("kit-text-small", { part, value: d.value })); }
      });
    }
  });
}

/**
 * Contrôle statique d'un dossier de skin. Rend `{ ok, issues, manifest, validation, composed, css, tokens, moduleInfo, files }`.
 * Options : coreVersion, advice (conseils AAA), modules (dossier des modules), neutrality (fichier de termes).
 */
export async function staticCheck(dir, options = {}) {
  const { validateSkinFolder } = await lib("validate");
  const folder = path.resolve(dir);
  const coreVersion = options.coreVersion;
  const modules = options.modules ? readModules(options.modules) : [];
  const layerReport = modules.length ? await moduleLayer(modules) : null;
  const layer = layerReport?.layer;
  const validation = validateSkinFolder(folder, {
    coreVersion, folderName: path.basename(folder), advice: !!options.advice,
    moduleParts: layer?.byModule, modulePairs: layer?.pairs?.map((p) => ({ fg: p.fg, bg: p.bg, defaults: undefined })),
  });
  const issues = validation.issues.map(fromLib);
  const add = (i) => { issues.push(i); };
  const result = { dir: folder, issues, validation, manifest: validation.manifest, css: validation.css, tokens: validation.tokens, composed: null, modules, layer, files: validation.files };
  const m = validation.manifest;
  if (!m) return finish(result);

  const raw = (rel) => { try { return fs.readFileSync(path.join(folder, rel)); } catch { return null; } };
  const sourceCss = m.stylesheet ? (raw(m.stylesheet)?.toString("utf8") ?? "") : "";
  const tokensText = raw(m.tokens)?.toString("utf8") ?? "";

  // ── jetons : vocabulaire, pièces de modules, composition réelle
  if (validation.tokens) {
    const { isKnownToken } = await lib("tokens");
    const seen = new Set();
    for (const group of ["light", "dark", "common"]) {
      for (const name of Object.keys(validation.tokens[group] ?? {})) {
        if (seen.has(name)) continue; seen.add(name);
        if (!isKnownToken(name)) add(kitIssue("kit-token-unknown", { token: name }));
      }
    }
    const mods = Object.keys(validation.tokens.modules ?? {});
    if (mods.length && !modules.length) add(kitIssue("kit-module-tokens-unverified", { modules: mods.join(", ") }));
    if (mods.length && modules.length) {
      const known = new Map(modules.map((x) => [x.id, x]));
      const declared = new Set((layer?.tokens ?? []).map((t) => t.name));
      for (const id of mods) {
        if (!known.has(id)) { add(kitIssue("kit-module-unknown", { module: id })); continue; }
        for (const name of Object.keys(validation.tokens.modules[id])) if (!declared.has(name)) add(kitIssue("kit-module-token-unknown", { module: id, token: name }));
      }
    }
    // ce que verrait le visiteur : valeurs refusées à la composition, corrections de lisibilité
    try {
      const { toSkinDefinition } = await lib("folder");
      const { composeSkin } = await lib("compose");
      const skin = toSkinDefinition({ id: m.id, version: m.version, manifest: m, css: validation.css, tokens: validation.tokens });
      const composed = composeSkin({ skin, moduleTokens: layer?.tokens, modulePairs: layer?.pairs });
      result.composed = composed;
      const dup = new Set(issues.map((i) => `${i.code}|${i.message.fr}`));
      for (const i of composed.issues) { const f = fromLib({ ...i, severity: "error" }); if (!dup.has(`${f.code}|${f.message.fr}`)) { f.level = "tokens"; add(f); } }
      for (const cm of composed.modes) {
        const modeText = { fr: cm.mode === "dark" ? "sombre" : "clair", en: cm.mode };
        if (cm.suspended) add(kitIssue("kit-mode-suspended", { mode: modeText }));
        else if (cm.changes.length) {
          const c = cm.changes[0];
          add(kitIssue("kit-readability-adjusted", { mode: modeText, token: c.token, example: c.to }));
        }
      }
    } catch { /* la composition ne doit jamais faire échouer le kit : le niveau « jetons » a déjà parlé */ }
  }

  // ── ressources : aperçus, polices et images utilisées, README et licence
  for (const p of m.previews ?? []) {
    const bytes = raw(p.file);
    if (!bytes) continue;
    const size = imageSize(bytes);
    if (!size) { add(kitIssue("kit-preview-unreadable", { file: p.file })); continue; }
    if (size.width !== 1280 || size.height !== 800) add(kitIssue("kit-preview-size", { file: p.file, size: `${size.width} × ${size.height}`, expected: "1280 × 800" }));
  }
  const cssNoFace = sourceCss.replace(/@font-face\s*\{[^}]*\}/g, "");
  for (const a of m.assets ?? []) {
    if (a.kind === "font" && a.family && !(cssNoFace.includes(a.family) || tokensText.includes(a.family))) add(kitIssue("kit-font-unused", { file: a.file }));
    if (a.kind === "image" && !(sourceCss.includes(`skin:${a.file}`) || tokensText.includes(`skin:${a.file}`))) add(kitIssue("kit-image-unused", { file: a.file }));
  }
  const names = fs.readdirSync(folder);
  if (!names.some((n) => /^LICENSE(\.md|\.txt)?$/.test(n))) add(kitIssue("kit-no-own-license"));
  if (!names.some((n) => /^README(\.[a-z]{2})?\.md$/.test(n))) add(kitIssue("kit-no-readme"));

  // ── feuille : points de rupture, tailles minimales
  const declared = new Set(m.breakpoints ?? []);
  for (const w of sheetBreakpoints(sourceCss)) {
    if ([390, 768, 1280, 1920].includes(w)) continue;
    if (![...declared].some((d) => Math.abs(d - w) <= 1)) add(kitIssue("kit-breakpoint-undeclared", { width: w }));
  }
  if (validation.css) await sizeAdvice(validation.css, add);

  // ── neutralité des textes
  const text = loadRulesText(options.neutrality);
  const rules = parseRules(text);
  if (!rules.length) add(kitIssue("kit-neutral-skipped"));
  else {
    const files = [["skin.json", raw("skin.json")?.toString("utf8") ?? ""], ["tokens.json", tokensText]];
    if (sourceCss) files.push([m.stylesheet, sourceCss]);
    for (const n of names) if (/^README(\.[a-z]{2})?\.md$/.test(n)) files.push([n, raw(n)?.toString("utf8") ?? ""]);
    for (const v of violations(files, rules)) add(kitIssue("kit-neutral", { term: v.term, file: v.file }));
  }
  return finish(result);
}

function finish(result) {
  const seen = new Set();
  result.issues = result.issues.filter((i) => { const k = `${i.code}|${i.message.fr}`; if (seen.has(k)) return false; seen.add(k); return true; });
  result.ok = !result.issues.some((i) => i.severity === "error");
  return result;
}
