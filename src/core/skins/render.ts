/**
 * Le skin du SITE PUBLIC, côté serveur (docs/SKINS.md §3, §12) : lit les réglages, compose les couches (`composeSkin`), écrit la feuille de jetons
 * (`renderSheet`) et la met en cache. Aucune requête réseau, aucun minuteur : le cache est une petite table bornée dont la clé contient TOUT ce qui compte
 * (skin et empreinte de ses fichiers, retouches, options, halo, fond, pièces de modules) ; changer un réglage ou un fichier change la clé, donc invalide.
 * Utilisé par `src/app/(site)/layout.tsx` seulement : l'administration, les overlays et les pages autonomes n'ont jamais de skin.
 */
import { createHash } from "node:crypto";
import { backgroundRules, BACKGROUND_BASE_CSS, effectiveLayers, type Layer } from "../background";
import { glowCss, isGlowLevel, type GlowLevel } from "../glow";
import { isHeaderLayout, type HeaderLayout } from "../header";
import { isDarkBackground } from "../logos";
import { getSetting, type SiteConfig } from "../settings";
import { BASIC } from "./basic";
import { composeSkin, type Composed } from "./compose";
import { toSkinDefinition } from "./folder";
import { invalidateSkinCache, skinCacheGeneration } from "./invalidate";
import { getModuleSkinLayer } from "./moduleParts";
import { MODE_SCRIPT_URL } from "./modeScript";
import { retouchesFrom, RETOUCH_KEYS } from "./retouch";
import { loadInstalledSkin } from "./service";
import { renderSheet } from "./sheet";
import type { SkinDefinition } from "./types";

export type SkinLook = {
  composed: Composed;
  /** Feuille à mettre dans le `<head>` : jetons, halo, fond, puis la feuille assainie du skin. */
  sheet: string;
  layers: Layer[];
  headerLayout: HeaderLayout;
  /** Pour l'en-tête : fond effectif sombre (logo) et bascule clair/sombre. */
  appearance: { dark: boolean; modeSwitch: boolean };
  /** Adresse du script de bascule (avec empreinte), présente seulement si la bascule existe. */
  modeScriptUrl: string | null;
};

/**
 * Le skin actif (`skin.active`, absent = basic) tel qu'il est installé ; basic si absent, introuvable, modifié depuis son installation ou inutilisable.
 * Un site sans skin choisi ne lit ni base ni disque en plus. `moduleParts` : les pièces des modules installés (voir `loadInstalledSkin`).
 */
export async function activeSkin(moduleParts?: Readonly<Record<string, readonly string[]>>): Promise<{ skin: SkinDefinition; serial: string }> {
  const id = await getSetting<string>("skin.active");
  if (typeof id !== "string" || id === "" || id === BASIC.id) return { skin: BASIC, serial: "basic" };
  const loaded = await loadInstalledSkin(id, { moduleParts });
  if (!loaded.ok) return { skin: BASIC, serial: "basic" };
  // l'empreinte du contenu installé fait partie de la clé : une réinstallation ou une mise à jour donne une autre feuille
  const skin = toSkinDefinition(loaded);
  return { skin, serial: `${skin.id}@${skin.version}:${loaded.fingerprint}` };
}

type Cached = Omit<SkinLook, "modeScriptUrl">;
const CACHE = new Map<string, Cached>();
const MAX_ENTRIES = 24;

export { invalidateSkinCache };

/** Le rendu du skin pour la configuration localisée du site. */
export async function resolveLook(localized: SiteConfig): Promise<SkinLook> {
  const moduleLayer = await getModuleSkinLayer();
  const { skin, serial } = await activeSkin(moduleLayer.byModule);
  const isBasic = skin === BASIC;
  const raw = new Map<string, unknown>();
  for (const key of RETOUCH_KEYS) raw.set(key, await getSetting(key));
  const retouches = retouchesFrom((k) => raw.get(k));
  const optionsSetting = await getSetting<Record<string, string>>("skin.options");
  const options = optionsSetting && typeof optionsSetting === "object" && !Array.isArray(optionsSetting) ? optionsSetting : {};

  // halo, fond, en-tête : la valeur de la personne, sinon le départ du skin, sinon l'absence (comportement d'avant les skins)
  const glowRaw = await getSetting("theme.glow");
  const bgRaw = await getSetting("theme.bgPreset");
  const layoutRaw = await getSetting("header.layout");
  const glowLevel: GlowLevel = isGlowLevel(glowRaw) ? glowRaw : (!isBasic && skin.defaults.glow) || localized.glow.level;
  let bg = localized.bg;
  if (!isBasic && bgRaw === undefined && skin.defaults.background !== undefined && skin.defaults.background !== "none") {
    const d = skin.defaults.background;
    bg = Array.isArray(d) ? { ...bg, preset: "custom", custom: JSON.stringify(d) } : { ...bg, preset: d as "dusk" | "grid" };
  }
  const headerLayout: HeaderLayout = isHeaderLayout(layoutRaw) ? layoutRaw : (!isBasic && skin.defaults.headerLayout) || localized.header.layout;

  const key = createHash("sha1").update(JSON.stringify([skinCacheGeneration(), serial, retouches, options, moduleLayer.version, glowLevel, localized.glow.custom, bg, headerLayout])).digest("hex");
  let hit = CACHE.get(key);
  if (!hit) {
    const composed = composeSkin({ skin, retouches, options, moduleTokens: moduleLayer.tokens, modulePairs: moduleLayer.pairs });
    const layers = effectiveLayers(bg.preset, bg.custom, bg.image, bg.svg);
    const sheet = renderSheet(composed, {
      glow: (theme, scope) => glowCss(glowLevel, localized.glow.custom, theme.accent, scope),
      background: layers.length ? (theme, scope) => backgroundRules(layers, theme, scope) : undefined,
      backgroundBase: layers.length ? BACKGROUND_BASE_CSS : undefined,
    });
    const first = composed.modes[0]!;
    hit = {
      composed, sheet, layers, headerLayout,
      // le fond sombre : celui du mode unique ; avec la bascule, la variante de logo est choisie par le CSS du cœur (le mode « clair » sert de valeur de base)
      appearance: { dark: isBasic ? isDarkBackground(localized.background) : composed.modes.length === 1 ? first.darkBackground : false, modeSwitch: composed.switchAvailable },
    };
    CACHE.set(key, hit);
    while (CACHE.size > MAX_ENTRIES) CACHE.delete(CACHE.keys().next().value as string);
  }
  return { ...hit, modeScriptUrl: hit.composed.switchAvailable ? MODE_SCRIPT_URL : null };
}
