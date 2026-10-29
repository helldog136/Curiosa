/**
 * Pont entre un skin INSTALLÉ et la composition (docs/SKINS.md §3, §21). Le skin est lu, contrôlé et assaini UNE seule fois, par `validate.ts` (appelé par
 * `service.loadInstalledSkin`, qui vérifie aussi l'empreinte du contenu installé et garde le résultat en mémoire) ; ce fichier ne fait que le mettre sous la forme
 * que `composeSkin` attend (`SkinDefinition`). Il ne lit ni fichier ni base et n'a aucun cache : le cache des skins lus est celui du service, celui des feuilles
 * composées est celui de `render.ts`.
 */
import { isGlowLevel } from "../glow";
import { isHeaderLayout } from "../header";
import type { SkinManifest } from "./manifest";
import type { SkinDefaults, SkinDefinition, SkinOption } from "./types";
import type { SkinTokens } from "./validate";

/** Un skin installé, contrôlé et assaini (voir `LoadedSkin` dans service.ts : la variante `ok: true`). */
export type InstalledSkinData = { id: string; version: string; manifest: SkinManifest; css: string; tokens: SkinTokens };

function defaultsOf(d: SkinManifest["defaults"]): SkinDefaults {
  const o = d ?? {};
  const out: SkinDefaults = {};
  if (isHeaderLayout(o.headerLayout)) out.headerLayout = o.headerLayout;
  if (o.font === "sans" || o.font === "serif" || o.font === "mono" || o.font === "skin") out.font = o.font;
  if (isGlowLevel(o.glow)) out.glow = o.glow;
  if (o.background === "none" || o.background === "dusk" || o.background === "grid") out.background = o.background;
  else if (Array.isArray(o.background)) out.background = o.background;
  return out;
}

/** Le skin tel que la composition le lit. Basic n'est jamais passé ici (il est embarqué). */
export function toSkinDefinition(s: InstalledSkinData): SkinDefinition {
  const m = s.manifest;
  const options: SkinOption[] = (m.options ?? []).map((o) => ({ id: o.id, label: o.label, default: o.default, values: o.values.map((v) => ({ id: v.id, label: v.label, tokens: v.tokens })) }));
  return {
    id: s.id,
    version: s.version,
    name: m.name,
    modes: [...m.modes],
    tokens: { light: s.tokens.light, dark: s.tokens.dark, common: s.tokens.common, modules: s.tokens.modules },
    css: s.css,
    defaults: defaultsOf(m.defaults),
    options,
    deriveFromBackground: false,
    colorScheme: true,
  };
}
