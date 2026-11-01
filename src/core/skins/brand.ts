/**
 * Le NOM « Curiosa » (crédit « Propulsé par Curiosa » du pied de page) : ce qu'un skin ne peut jamais changer (docs/SKINS.md, « Ce qu'un skin ne peut jamais changer »).
 *
 * Règle de la propriétaire : le nom ne change JAMAIS de police de DA, pour aucun skin. Il a donc sa propre pièce verrouillée, `brand-mark`
 * (aussi marquée `data-curiosa-wordmark`), posée par le composant `CuriosaMark` partout où le nom apparaît. Trois garde-fous, indépendants :
 *
 *  1. l'assainisseur (`sanitize.ts`) REFUSE toute déclaration de police, de casse, d'espacement ou de soulignement qui atteint le mot : sélecteur direct
 *     (`[data-skin-part="brand-mark"]`), lien du crédit (`[data-skin-part="credit"] a`), ou propriété héritée posée sur le crédit lui-même ;
 *  2. le cœur émet, APRÈS la feuille du skin, la règle `BRAND_MARK_CSS` (en `!important`, qu'un skin ne peut pas écrire) qui fixe ces propriétés sur le mot :
 *     même un sélecteur plus large (`footer a`) ou une valeur héritée ne peut plus le changer ;
 *  3. le kit (`skin:check --visual`) compare le style CALCULÉ du mot sous le skin et sous basic.
 *
 * La COULEUR du mot, son alignement et sa marge restent habillables (le pied d'un skin peut être sombre : la lisibilité prime).
 */
import type { Complex, Compound } from "./selectors";

/** Pièce verrouillée du nom (allowlist `PARTS`). */
export const BRAND_PART = "brand-mark";
/** Repère de l'élément, présent partout où le nom apparaît (pied du site public ET administration). */
export const BRAND_ATTRIBUTE = "data-curiosa-wordmark";
/** Variable posée par la police du nom (`src/components/brand/wordmark.ts`) : la règle du cœur s'en sert, aucune feuille de skin ne peut la définir (`--sk-*` et `--v-*` seulement). */
export const BRAND_FONT_VARIABLE = "--curiosa-wordmark-font";

/** Propriétés HÉRITÉES qui changeraient l'allure du mot si elles étaient posées sur le crédit (le mot est dans `credit`). */
const INHERITED = [
  "font", "font-family", "font-weight", "font-style", "font-variant", "font-variant-caps", "font-variant-numeric", "font-variant-ligatures",
  "font-variant-east-asian", "font-variant-alternates", "font-variant-position", "font-feature-settings", "font-variation-settings", "font-kerning",
  "font-stretch", "font-synthesis", "font-optical-sizing", "text-transform", "letter-spacing", "word-spacing",
];
/** Propriétés refusées sur le mot lui-même : les précédentes, plus la taille relative et le soulignement du lien du cœur. */
const OWN = [
  ...INHERITED, "font-size", "font-size-adjust",
  "text-decoration", "text-decoration-line", "text-decoration-style", "text-decoration-thickness", "text-decoration-skip-ink",
  "text-underline-offset", "text-underline-position",
];
export const BRAND_LOCKED_OWN: ReadonlySet<string> = new Set(OWN);
export const BRAND_LOCKED_INHERITED: ReadonlySet<string> = new Set(INHERITED);

/** Comment une règle atteint le mot : `own` (la pièce ou le lien du crédit), `inherited` (le crédit, dont le mot hérite), ou `null`. */
export type BrandReach = "own" | "inherited" | null;

/** Pièces ancrées par un composé, y compris dans `:is()` / `:where()`. */
function partsOf(c: Compound): string[] {
  const out: string[] = [];
  for (const a of c.attrs) if (a.op === "=" && a.name === "data-skin-part") out.push(a.value);
  for (const p of c.pseudos) if ((p.name === "is" || p.name === "where") && Array.isArray(p.arg)) for (const x of p.arg) out.push(...partsOf(x.compounds[x.compounds.length - 1]!));
  return out;
}

/** Le dernier composé peut-il désigner un lien `<a>` ? (`a`, ou sans balise : `[rel~="noopener"]`, `:hover`…) */
const canBeLink = (c: Compound): boolean => c.type === null || c.type === "a";

/**
 * Les règles d'une liste de sélecteurs atteignent-elles le mot ? Le résultat le plus strict l'emporte.
 * Un sélecteur large (`footer a`) n'est PAS classé ici : il ne vise pas le mot, et la règle du cœur (`BRAND_MARK_CSS`) l'empêche de l'atteindre.
 */
export function brandReach(list: readonly Complex[]): BrandReach {
  let reach: BrandReach = null;
  for (const x of list) {
    const last = x.compounds[x.compounds.length - 1]!;
    const lastParts = partsOf(last);
    if (lastParts.includes(BRAND_PART)) return "own";
    // `credit a`, `credit > a`, `credit a:hover` : le lien du crédit est le mot
    const viaCredit = x.compounds.slice(0, -1).some((c, i) => partsOf(c).includes("credit") && x.combinators.slice(i).every((k) => k === " " || k === ">"));
    if (viaCredit && canBeLink(last)) return "own";
    if (lastParts.includes("credit")) reach = "inherited";
  }
  return reach;
}

/**
 * La règle du cœur, émise APRÈS la feuille du skin (`renderSheet`). `!important` : une feuille de skin n'en a pas le droit, et rien ne peut donc la défaire.
 * Elle fixe la police de DA du nom, sa casse, ses espacements et le soulignement de lien du cœur (Tailwind : `underline underline-offset-2`) ; la taille reste
 * relative (`1.15em` du crédit). Ni la couleur, ni l'alignement, ni la marge : ils restent habillables.
 */
export const BRAND_MARK_CSS =
  `[${BRAND_ATTRIBUTE}]{font-family:var(${BRAND_FONT_VARIABLE},Georgia,serif)!important;font-weight:600!important;font-style:italic!important;font-size:1.15em!important;`
  + "text-transform:none!important;letter-spacing:normal!important;word-spacing:normal!important;font-variant:normal!important;font-feature-settings:normal!important;"
  + "font-variation-settings:normal!important;font-kerning:auto!important;font-stretch:normal!important;font-size-adjust:none!important;"
  + "text-decoration-line:underline!important;text-decoration-style:solid!important;text-decoration-thickness:auto!important;text-underline-offset:2px!important;text-underline-position:auto!important}";
