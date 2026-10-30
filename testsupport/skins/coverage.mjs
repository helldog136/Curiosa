// COUVERTURE d'un skin (docs/SKINS.md §13 et « Un nouvel élément est-il habillable ? ») : quelles régions, pièces et jetons du cœur le skin règle, et lesquels il laisse au skin de base.
// Ce n'est JAMAIS une erreur : un skin peut laisser `basic` habiller une pièce, et rien ne casse (repli valeur par valeur). Le rapport sert à voir, avant une publication du cœur,
// les éléments que l'aspect d'un skin n'a pas prévus.
//
// « Ciblée » = la feuille du skin (déjà assainie) a un sélecteur qui vise la région ou la pièce elle-même. Une mention dans `:not(…)` ou `:has(…)` ne compte pas : elle ne règle rien.
import postcss from "postcss";

const lib = async (name) => import(`../../src/core/skins/${name}.ts`);

/** Retire le contenu des pseudo-classes `:not(…)` et `:has(…)` (parenthèses équilibrées) : ce qu'elles nomment n'est pas réglé par la règle. */
export function stripConditions(selector) {
  let out = "";
  for (let i = 0; i < selector.length;) {
    const m = /^:(?:not|has)\(/.exec(selector.slice(i));
    if (!m) { out += selector[i++]; continue; }
    let depth = 1, j = i + m[0].length;
    while (j < selector.length && depth) { if (selector[j] === "(") depth++; else if (selector[j] === ")") depth--; j++; }
    i = j;
  }
  return out;
}

/** Régions et pièces visées par une feuille de style (assainie ou non). */
export function targetedNames(css) {
  const regions = new Set(), parts = new Set();
  if (!css) return { regions, parts };
  let root;
  try { root = postcss.parse(css); } catch { return { regions, parts }; }
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) return;
    for (const sel of rule.selectors ?? []) {
      const s = stripConditions(sel);
      for (const m of s.matchAll(/\[data-skin-(region|part)\s*=\s*["']?([a-z][a-z0-9.-]*)["']?\s*\]/g)) (m[1] === "region" ? regions : parts).add(m[2]);
    }
  });
  return { regions, parts };
}

/**
 * Couverture d'un skin contre une liste de régions et de pièces. `css` : sa feuille assainie ; `tokens` : son tokens.json lu (`{ common, light, dark }`).
 * Rend les listes de ce qui est ciblé, ce qui ne l'est pas, et les jetons du vocabulaire (valeur de basic connue, non dérivés) qu'il ne fixe dans aucun mode.
 */
export async function skinCoverage({ css, tokens }, names) {
  const { REGIONS, PARTS } = names ? { REGIONS: names.regions, PARTS: names.parts } : await lib("allowlist");
  const { TOKEN_DEFS, DERIVED_COLOR_TOKENS } = await lib("tokens");
  const { regions, parts } = targetedNames(css);
  const set = new Set(["common", "light", "dark"].flatMap((g) => Object.keys(tokens?.[g] ?? {})));
  const derived = new Set(DERIVED_COLOR_TOKENS);
  const tokenNames = TOKEN_DEFS.filter((d) => d.basic !== null && !derived.has(d.name)).map((d) => d.name);
  return {
    regions: { total: REGIONS.length, targeted: REGIONS.filter((r) => regions.has(r)), missing: REGIONS.filter((r) => !regions.has(r)) },
    parts: { total: PARTS.length, targeted: PARTS.filter((p) => parts.has(p)), missing: PARTS.filter((p) => !parts.has(p)) },
    tokens: { total: tokenNames.length, set: tokenNames.filter((n) => set.has(n)), missing: tokenNames.filter((n) => !set.has(n)) },
  };
}

/** Un résumé court d'une liste : les premiers noms, puis « … et N autres ». */
export function shortList(list, max = 8, more = (n) => `… +${n}`) {
  return list.length <= max ? list.join(", ") : `${list.slice(0, max).join(", ")} ${more(list.length - max)}`;
}
