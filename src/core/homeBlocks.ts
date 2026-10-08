import type { Block } from "./blocks";

/**
 * BLOCS DE PAGE D'ACCUEIL (fonction du cœur). Un bloc est un morceau de page fabriqué directement dans Page d'accueil → Ajouter un bloc, sans module :
 *  - `media`  : texte (petite ligne, titre, paragraphe, bouton) et jusqu'à 3 images à côté ;
 *  - `tabs`   : des onglets (un nom, un titre, un texte, une image par onglet) ;
 *  - `stats`  : des chiffres clés (un nombre et sa légende) ;
 *  - `cta`    : un appel à l'action (titre, phrase, bouton) ;
 *  - `video`  : du texte posé sur une vidéo de fond envoyée sur le site.
 * Tout est une DONNÉE validée champ par champ : aucune valeur libre n'atteint la page (listes fermées, images du site ou https, textes bornés).
 * Les textes sont traduisibles : `{ fr: "…", en: "…" }`. Stocké dans une ligne de l'accueil : { instance: "core", section: "block", options: { block } }.
 */
export const BLOCK_KINDS = ["media", "tabs", "stats", "cta", "video"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const isBlockKind = (v: unknown): v is BlockKind => (BLOCK_KINDS as readonly unknown[]).includes(v);

export const CORE_INSTANCE = "core";
export const CORE_SECTION = "block";

export type L = Record<string, string>;
export type BlockItem = { title: L; heading: L; text: L; image: string };
export type BlockBg = { src: string; size: "cover" | "contain" | "auto"; position: string; veil: "none" | "light" | "dark" };
export type BlockDef = {
  kind: BlockKind;
  eyebrow: L; title: L; text: L; buttonLabel: L; buttonUrl: string;
  images: string[]; imageSide: "left" | "right"; tone: "plain" | "surface" | "accent";
  bg: BlockBg | null;
  video: string; poster: string; videoSound: boolean;
  items: BlockItem[];
};

export const BG_POSITIONS = ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"] as const;
const MAX_ITEMS = 24;
const IMAGE_RE = /^(\/uploads\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)|https:\/\/[^\s"'()<>\\]+)$/;
const VIDEO_RE = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/;
const LINK_RE = /^(\/(?!\/)|https?:\/\/|mailto:)/;

export const isBlockImage = (v: unknown): v is string => typeof v === "string" && IMAGE_RE.test(v);
export const isBlockVideo = (v: unknown): v is string => typeof v === "string" && VIDEO_RE.test(v);
export const isBlockLink = (v: unknown): v is string => typeof v === "string" && LINK_RE.test(v.trim());
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Textes par langue : seules les langues du site, bornées, vides ignorées. */
function texts(raw: unknown, locales: string[], max: number, multiline = false): L {
  const out: L = {};
  if (!raw || typeof raw !== "object") return out;
  for (const l of locales) {
    let v = String((raw as Record<string, unknown>)[l] ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "");
    v = (multiline ? v.replace(/\r\n?/g, "\n") : v.replace(/\s+/g, " ")).trim().slice(0, max);
    if (v) out[l] = v;
  }
  return out;
}

export function emptyBlock(kind: BlockKind): BlockDef {
  return { kind, eyebrow: {}, title: {}, text: {}, buttonLabel: {}, buttonUrl: "", images: [], imageSide: "right", tone: "plain", bg: null, video: "", poster: "", videoSound: false, items: [] };
}

/** Une définition reçue du navigateur → une définition sûre (ou un bloc vide du type demandé). Ne lève jamais d'exception. */
export function normalizeBlockDef(raw: unknown, locales: string[]): BlockDef {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = pick(r.kind, BLOCK_KINDS, "media");
  const bgRaw = r.bg && typeof r.bg === "object" ? (r.bg as Record<string, unknown>) : null;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_ITEMS * 4).map((it) => {
    const i = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    return { title: texts(i.title, locales, 80), heading: texts(i.heading, locales, 160), text: texts(i.text, locales, 4000, true), image: isBlockImage(i.image) ? i.image : "" };
  }).filter((i) => Object.keys(i.title).length > 0).slice(0, MAX_ITEMS);
  return {
    kind,
    eyebrow: texts(r.eyebrow, locales, 120), title: texts(r.title, locales, 160), text: texts(r.text, locales, 6000, true), buttonLabel: texts(r.buttonLabel, locales, 60),
    buttonUrl: isBlockLink(r.buttonUrl) ? String(r.buttonUrl).trim().slice(0, 500) : "",
    images: (Array.isArray(r.images) ? r.images : []).filter(isBlockImage).slice(0, 3),
    imageSide: pick(r.imageSide, ["left", "right"] as const, "right"),
    tone: pick(r.tone, ["plain", "surface", "accent"] as const, "plain"),
    bg: bgRaw && isBlockImage(bgRaw.src) ? { src: bgRaw.src, size: pick(bgRaw.size, ["cover", "contain", "auto"] as const, "cover"), position: pick(bgRaw.position, BG_POSITIONS, "center"), veil: pick(bgRaw.veil, ["none", "light", "dark"] as const, "none") } : null,
    video: isBlockVideo(r.video) ? r.video : "", poster: isBlockImage(r.poster) ? r.poster : "", videoSound: r.videoSound === true,
    items,
  };
}

/** Le texte d'une langue, sinon la langue par défaut, sinon n'importe laquelle. */
export const pickText = (l: L, locale: string, defaultLocale: string): string => l[locale] ?? l[defaultLocale] ?? Object.values(l)[0] ?? "";

/** Le bloc de page à afficher (rendu par le composant Panel). Un bloc sans rien à montrer ne donne rien. */
export function blockToBlocks(def: BlockDef, locale: string, defaultLocale: string): Block[] {
  const t = (l: L) => pickText(l, locale, defaultLocale);
  const label = t(def.buttonLabel);
  const items = def.kind === "tabs" || def.kind === "stats"
    ? def.items.map((i) => ({ title: t(i.title), heading: t(i.heading) || undefined, text: t(i.text) || undefined, image: i.image || undefined })).filter((i) => i.title)
    : undefined;
  const hasText = !!(t(def.title) || t(def.text) || t(def.eyebrow));
  if (!hasText && !items?.length && !def.images.length && !(def.kind === "video" && def.video)) return [];
  return [{
    type: "panel",
    kind: def.kind,
    eyebrow: t(def.eyebrow) || undefined, title: t(def.title) || undefined, text: t(def.text) || undefined,
    button: label && def.buttonUrl ? { label, href: def.buttonUrl } : undefined,
    images: def.images, imageSide: def.imageSide, tone: def.tone,
    bg: def.bg ?? undefined,
    items,
    ...(def.kind === "video" && def.video ? { video: def.video, videoSound: def.videoSound, videoPoster: def.poster || undefined } : {}),
  }];
}
