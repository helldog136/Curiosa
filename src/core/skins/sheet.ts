/**
 * La FEUILLE de jetons qu'on met dans le `<head>` du site public (docs/SKINS.md §3.5) : fonction pure, à partir du résultat de `composeSkin`.
 *
 * Un seul mode (basic, skin à un mode, ou site devenu mono-mode par une retouche) :
 *   :root[data-skin="id"]{ tous les jetons }
 * Deux modes : le clair par défaut, le sombre selon l'appareil et selon le choix du visiteur (attribut `data-mode` posé par /skins/mode.js) :
 *   :root[data-skin="id"]{ jetons clairs ; color-scheme:light }
 *   @media (prefers-color-scheme:dark){ :root[data-skin="id"]:not([data-mode="light"]){ jetons sombres ; color-scheme:dark } }
 *   :root[data-skin="id"][data-mode="dark"]{ jetons sombres ; color-scheme:dark }
 * puis la feuille de style (assainie) du skin. Aucune URL, aucun script : seulement des déclarations de variables.
 */
import { gradientOf, isHexColor, type Theme } from "../color";
import type { Composed, ComposedMode } from "./compose";

const UPGRADE_SUPPORT = "@supports (background-image:linear-gradient(in oklch,#000,#fff))";

export type Decor = {
  /** Halo : règles `body{…}` pour ce thème, sous un préfixe de portée. */
  glow?: (theme: Theme, scope: string) => string;
  /** Fond : règles de couleur des couches pour ce thème, sous un préfixe de portée. */
  background?: (theme: Theme, scope: string) => string;
  /** Partie fixe du fond (la même pour tous les thèmes), écrite une seule fois. */
  backgroundBase?: string;
};

/** Le dégradé d'un thème : couleurs sRGB (compris partout) puis, si les couleurs le permettent, amélioration en OKLCH pour les navigateurs qui savent. */
function gradientOf2(tokens: Record<string, string>): { plain: string; upgrade: string | null } {
  const g = tokens["--v-gradient"] ?? "";
  const a = tokens["--v-accent"], b = tokens["--v-accent2"];
  if (isHexColor(a) && isHexColor(b) && g === gradientOf(a, b, true)) {
    const plain = gradientOf(a, b, false);
    return { plain, upgrade: plain !== g ? g : null };
  }
  return { plain: g, upgrade: null };
}

const decl = (name: string, value: string) => `${name}:${value}`;

function declarations(tokens: Record<string, string>, names: string[], plainGradient: string): string[] {
  return names.map((n) => decl(n, n === "--v-gradient" ? plainGradient : tokens[n]!));
}

function upgradeRule(selector: string, tokens: Record<string, string>): string {
  const { upgrade } = gradientOf2(tokens);
  return upgrade ? `${UPGRADE_SUPPORT}{${selector}{--v-gradient:${upgrade}}}` : "";
}

function monoSheet(id: string, m: ComposedMode, c: Composed, decor: Decor): string {
  const sel = `:root[data-skin="${id}"]`;
  const { plain } = gradientOf2(m.tokens);
  const names = Object.keys(m.tokens);
  const decls = declarations(m.tokens, names, plain);
  if (c.colorScheme) decls.push(decl("color-scheme", m.mode));
  return `${sel}{${decls.join(";")}}${upgradeRule(sel, m.tokens)}${decor.glow?.(m.theme, "") ?? ""}${decor.backgroundBase ?? ""}${decor.background?.(m.theme, "") ?? ""}`;
}

function dualSheet(id: string, light: ComposedMode, dark: ComposedMode, c: Composed, decor: Decor): string {
  const sel = `:root[data-skin="${id}"]`;
  const names = [...new Set([...Object.keys(light.tokens), ...Object.keys(dark.tokens)])];
  const gl = gradientOf2(light.tokens), gd = gradientOf2(dark.tokens);
  const sameInBoth = (n: string) => (n === "--v-gradient" ? gl.plain === gd.plain && gl.upgrade === gd.upgrade : light.tokens[n] === dark.tokens[n]);
  const shared = names.filter(sameInBoth);
  const lightOnly = names.filter((n) => !sameInBoth(n) && light.tokens[n] !== undefined);
  const darkNames = names.filter((n) => !sameInBoth(n) && dark.tokens[n] !== undefined);
  const lightDecls = [...declarations(light.tokens, shared.filter((n) => light.tokens[n] !== undefined), gl.plain), ...declarations(light.tokens, lightOnly, gl.plain)];
  if (c.colorScheme) lightDecls.push(decl("color-scheme", "light"));
  const darkDecls = declarations(dark.tokens, darkNames, gd.plain);
  if (c.colorScheme) darkDecls.push(decl("color-scheme", "dark"));
  const autoDark = `${sel}:not([data-mode="light"])`;
  const manualDark = `${sel}[data-mode="dark"]`;
  const sharedGradientUpgrade = shared.includes("--v-gradient") ? upgradeRule(sel, light.tokens) : "";
  const out: string[] = [`${sel}{${lightDecls.join(";")}}`, sharedGradientUpgrade];
  // le clair par défaut, puis le sombre : sur demande de l'appareil (si le visiteur n'a pas choisi « clair »), ou choisi par le visiteur
  if (darkDecls.length > 0) {
    out.push(`@media (prefers-color-scheme:dark){${autoDark}{${darkDecls.join(";")}}}`, `${manualDark}{${darkDecls.join(";")}}`);
    if (!shared.includes("--v-gradient")) {
      if (gl.upgrade) out.push(upgradeRule(sel, light.tokens));
      if (gd.upgrade) out.push(`@media (prefers-color-scheme:dark){${UPGRADE_SUPPORT}{${autoDark}{--v-gradient:${gd.upgrade}}}}`, `${UPGRADE_SUPPORT}{${manualDark}{--v-gradient:${gd.upgrade}}}`);
    }
  }
  // halo et fond : une série de règles par mode, sous la même portée que les jetons
  const scopeLight = `${sel} `, scopeAutoDark = `${autoDark} `, scopeManualDark = `${manualDark} `;
  if (decor.glow) {
    out.push(decor.glow(light.theme, scopeLight));
    const g = decor.glow(dark.theme, scopeAutoDark);
    if (g) out.push(`@media (prefers-color-scheme:dark){${g}}`, decor.glow(dark.theme, scopeManualDark));
  }
  if (decor.background) {
    out.push(decor.backgroundBase ?? "", decor.background(light.theme, scopeLight));
    const b = decor.background(dark.theme, scopeAutoDark);
    if (b) out.push(`@media (prefers-color-scheme:dark){${b}}`, decor.background(dark.theme, scopeManualDark));
  }
  return out.join("");
}

/** La feuille complète : jetons, halo et fond, puis la feuille de style du skin. */
export function renderSheet(c: Composed, decor: Decor = {}): string {
  const id = c.skinId;
  const [first, second] = c.modes;
  const tokens = c.modes.length === 2 ? dualSheet(id, first!.mode === "light" ? first! : second!, first!.mode === "light" ? second! : first!, c, decor) : monoSheet(id, first!, c, decor);
  return tokens + (c.css ?? "");
}
