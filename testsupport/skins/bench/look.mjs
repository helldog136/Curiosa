// Le « look » d'un skin sur le site de démonstration : mêmes étapes que `resolveLook` (src/core/skins/render.ts), sans base de données ni retouches.
// Skin → composition (`composeSkin`) → feuille (`renderSheet`) ; halo, fond et mise en page d'en-tête de départ viennent des valeurs du skin (`defaults`).
const lib = async (name) => import(`../../../src/core/skins/${name}.ts`);

/**
 * @param skin     SkinDefinition (ou null = basic)
 * @param layer    couche des pièces de modules (jetons, paires) ou null
 * @param opts     { options?: {id: valeur}, retouches? }
 */
export async function buildLook(skin, layer, opts = {}) {
  const { composeSkin } = await lib("compose");
  const { renderSheet } = await lib("sheet");
  const { BASIC } = await lib("basic/index");
  const glow = await import("../../../src/core/glow.ts");
  const bgLib = await import("../../../src/core/background.ts");
  const active = skin ?? BASIC;
  const isBasic = active === BASIC;
  const composed = composeSkin({ skin: isBasic ? null : active, options: opts.options, retouches: opts.retouches, moduleTokens: layer?.tokens, modulePairs: layer?.pairs });
  const glowLevel = (!isBasic && active.defaults.glow) || "none";
  let preset = "none", custom = "";
  const d = !isBasic ? active.defaults.background : undefined;
  if (d !== undefined && d !== "none") { if (Array.isArray(d)) { preset = "custom"; custom = JSON.stringify(d); } else preset = d; }
  const layers = bgLib.effectiveLayers(preset, custom, null, undefined);
  const sheet = renderSheet(composed, {
    glow: (theme, scope) => glow.glowCss(glowLevel, glow.normalizeTuning(undefined), theme.accent, scope),
    background: layers.length ? (theme, scope) => bgLib.backgroundRules(layers, theme, scope) : undefined,
    backgroundBase: layers.length ? bgLib.BACKGROUND_BASE_CSS : undefined,
  });
  const first = composed.modes[0];
  return {
    composed, sheet, layers, isBasic,
    headerLayout: (!isBasic && active.defaults.headerLayout) || "classic",
    switchAvailable: composed.switchAvailable,
    dark: composed.modes.length === 1 ? first.darkBackground : false,
  };
}
