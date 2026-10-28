// La PLANCHE du banc d'essai (docs/SKINS.md §14) : toutes les pièces du cœur dans tous leurs états, puis les pièces des modules. Chaque section est un fragment généré par les
// vrais composants du cœur ; une légende (`data-bench-chrome`, hors des mesures du kit) dit quelles pièces la section montre.
import { fragment, loadFragments } from "./fragments.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const partsIn = (html) => [...new Set([...html.matchAll(/data-skin-(?:part|region)="([a-z0-9.-]+)"/g)].map((m) => m[1]))];

/** [id, titre FR, titre EN, fragments] */
export const SECTIONS = [
  ["text", "Titres et texte", "Headings and text", ["block-hero", "prose"]],
  ["buttons", "Boutons, étiquettes, états", "Buttons, labels, states", ["block-panel-cta", "form-sending", "entries-links"]],
  ["cards", "Cartes, listes, codes", "Cards, lists, codes", ["entries-cards", "entries-list", "entries-codes", "entries-empty"]],
  ["blocks", "Blocs de page", "Page blocks", ["block-hero-plain", "block-panel-media", "block-panel-tabs", "block-panel-stats", "block-panel-media-bg", "block-banners", "block-misc"]],
  ["forms", "Formulaires (repos, erreur, envoyé)", "Forms (idle, error, sent)", ["form", "form-error", "form-done"]],
  ["navigation", "Pagination", "Pagination", ["pagination"]],
  ["home", "Accueil fluide (morceaux de toutes les tailles)", "Fluid home (pieces of every size)", ["page-home"]],
];

/** Gabarit générique d'une pièce de module quand le module ne fournit pas de `demo` (d'après `kind`). */
export function genericPart(part) {
  const id = part.id, name = esc(part.name.fr), desc = esc(part.description.fr);
  switch (part.kind) {
    case "button": return `<a href="#" data-skin-part="${id}">${name}</a>`;
    case "badge": return `<span data-skin-part="${id}">${name}</span>`;
    case "list": return `<ul data-skin-part="${id}"><li>${name}</li><li>${desc}</li></ul>`;
    case "avatar": return `<img data-skin-part="${id}" src="/uploads/00000000-0000-4000-8000-000000000002.png" alt="" width="64" height="64"/>`;
    case "card": case "panel": return `<article data-skin-part="${id}"><h3>${name}</h3><p>${desc}</p><a href="#">${name}</a></article>`;
    default: return `<div data-skin-part="${id}"><p>${name}</p><p>${desc}</p></div>`;
  }
}

/** Le HTML d'exemple d'un module, nettoyé : ni script, ni style intégré, ni gestionnaire d'événement, ni adresse extérieure (le banc ne charge rien du dehors). */
export function cleanDemo(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<link[^>]*>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(src|href|srcset|poster)\s*=\s*("(?:https?:)?\/\/[^"]*"|'(?:https?:)?\/\/[^']*')/gi, ' $1="#"');
}

/** Aide pour voir les jetons d'une pièce de module sans le CSS du module : règles de démonstration d'après le suffixe du jeton (couleur de fond, de texte, rayon…). */
function tokenPreviewCss(part) {
  const rules = [];
  for (const t of part.tokens ?? []) {
    const n = t;
    if (/-(bg|background)$/.test(n)) rules.push(`background:var(${n})`);
    else if (/-(fg|text|color)$/.test(n)) rules.push(`color:var(${n})`);
    else if (/-border$/.test(n)) rules.push(`border:1px solid var(${n})`);
    else if (/-radius$/.test(n)) rules.push(`border-radius:var(${n})`);
    else if (/-shadow$/.test(n)) rules.push(`box-shadow:var(${n})`);
    else if (/-(gap|space|padding)$/.test(n)) rules.push(`padding:var(${n})`);
  }
  return rules.length ? `[data-bench-modules] [data-skin-part="${part.id}"]{${rules.join(";")}}` : "";
}

export function moduleSection(site, L) {
  const parts = site.layer?.parts ?? [];
  if (!parts.length) return { html: "", parts: [] };
  const demos = new Map((site.modules ?? []).map((m) => [m.id, m.demo]));
  const style = parts.map(tokenPreviewCss).filter(Boolean).join("");
  const body = parts.map((p) => {
    const demo = demos.get(p.moduleId);
    const inner = demo && demo.includes(`data-skin-part="${p.id}"`) ? cleanDemo(demo) : genericPart(p);
    return `<div><p data-bench-chrome>${esc(p.id)}${p.kind ? ` (${esc(p.kind)})` : ""} — ${esc(p.name[L])}</p>${inner}</div>`;
  }).join("");
  return { html: `<section data-bench-section="modules" data-bench-modules><style data-bench-chrome>${style}</style><h2 data-bench-chrome class="bench-h">${L === "fr" ? "Pièces des modules" : "Module parts"}</h2><div class="space-y-6">${body}</div></section>`, parts: parts.map((p) => p.id) };
}

/** Le contenu de la planche pour une langue. `q.layout` : mise en page d'en-tête montrée (pour la légende). */
export function boardContent(site, L) {
  const css = `<style data-bench-chrome>[data-bench-chrome]{display:block;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#222;background:#e4e4e7;border-radius:3px;padding:.25rem .5rem;margin:1.25rem 0 .5rem;text-transform:none;letter-spacing:0;font-weight:400;text-shadow:none;max-width:100%;overflow-wrap:anywhere}.bench-h{font-size:14px!important;font-weight:700;margin-top:3rem}</style>`;
  const seen = new Set();
  const sections = SECTIONS.map(([id, fr, en, names]) => {
    const inner = names.map((n) => {
      const html = fragment(L, n);
      partsIn(html).forEach((p) => seen.add(p));
      return `<div data-bench-fragment="${n}"><p data-bench-chrome>${n}</p>${html}</div>`;
    }).join("");
    return `<section data-bench-section="${id}"><h2 data-bench-chrome class="bench-h">${esc(L === "fr" ? fr : en)}</h2><div class="space-y-6">${inner}</div></section>`;
  }).join("");
  const mods = moduleSection(site, L);
  return `${css}<div data-bench-board class="space-y-6">${sections}${mods.html}</div>`;
}

/** Les pièces et régions du contrat que la planche (avec l'en-tête, le pied et le bandeau) ne montre pas. Sert à la légende et aux tests. */
export async function coverage(site, L = "fr") {
  const { PARTS, REGIONS } = await import("../../../src/core/skins/allowlist.ts");
  const all = loadFragments()[L];
  const seen = new Set(partsIn(boardContent(site, L)));
  for (const name of Object.keys(all)) if (/^(header-|footer|tray)/.test(name)) partsIn(all[name]).forEach((p) => seen.add(p));
  seen.add("shell"); seen.add("main"); seen.add("content"); seen.add("banner"); seen.add("skip-link");
  const missing = [...REGIONS, ...PARTS].filter((n) => !seen.has(n) && n !== "backdrop");
  return { total: REGIONS.length + PARTS.length, missing };
}
