import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

const L = (fr: string, en: string) => ({ fr, en });
const opt = (value: string, fr: string, en: string) => ({ value, label: L(fr, en) });

export const manifest: ParsedManifest = {
  apiVersion: 2,
  id: "blocks",
  name: L("Blocs de page", "Page blocks"),
  version: "1.0.0",
  description: L(
    "Fabriquez des morceaux de page d'accueil : texte et images, onglets, chiffres clés, appel à l'action ou texte sur une vidéo. Ajoutez un bloc par morceau, puis placez-le où vous voulez sur l'accueil.",
    "Build home page pieces: text and images, tabs, key figures, call to action, or text over a video. Add one block per piece, then place it anywhere on the home page.",
  ),
  author: "Helldog136",
  license: "Curiosa License 1.0",
  icon: "🧱",
  instances: "multiple",
  // Pas de page publique : un bloc n'existe que comme section de l'accueil. Ses entrées sont les onglets ou les chiffres.
  page: false,
  // « links » = ordre de saisie par défaut (on range les onglets comme on veut) ; réglable avec le tri de l'instance.
  content: { display: "links", clickAction: "detail", features: ["cover", "summary", "body"], basePath: "", showInNav: false },
  sections: [{ id: "block", label: L("Bloc de page", "Page block"), size: "full" }],
  consumes: [],
  provides: [],
  permissions: ["sections"],
  settings: [
    { key: "kind", type: "select", default: "media", label: L("Type de bloc", "Block type"),
      options: [opt("media", "Texte et images", "Text and images"), opt("tabs", "Onglets", "Tabs"), opt("stats", "Chiffres clés", "Key figures"), opt("cta", "Appel à l'action", "Call to action"), opt("video", "Texte sur une vidéo", "Text over a video")],
      help: L("Onglets et chiffres clés se remplissent avec les entrées de ce bloc : une entrée par onglet (titre = nom de l'onglet, résumé = titre du texte, contenu = texte, image = illustration) ou par chiffre (titre = le nombre, résumé = sa légende).", "Tabs and key figures are filled with this block's entries: one entry per tab (title = tab name, summary = text heading, content = text, image = picture) or per figure (title = the number, summary = its caption).") },
    { key: "eyebrow", type: "text", translatable: true, label: L("Petite ligne au-dessus du titre", "Small line above the title") },
    { key: "title", type: "text", translatable: true, label: L("Titre", "Title") },
    { key: "text", type: "textarea", translatable: true, label: L("Texte", "Text"), help: L("Markdown simple : **gras**, listes, liens.", "Simple Markdown: **bold**, lists, links.") },
    { key: "buttonLabel", type: "text", translatable: true, label: L("Texte du bouton", "Button text"), help: L("Vide = pas de bouton.", "Empty = no button.") },
    { key: "buttonUrl", type: "text", label: L("Lien du bouton", "Button link"), help: L("Une page du site (/contact) ou une adresse https://…", "A page of the site (/contact) or an https://… address") },
    { key: "image1", type: "image", label: L("Image 1", "Image 1"), help: L("Jusqu'à trois images, disposées en collage décalé. Pour les onglets : image commune, remplacée par l'image d'un onglet s'il en a une.", "Up to three images, laid out as an offset collage. For tabs: shared image, replaced by a tab's own image if it has one.") },
    { key: "image2", type: "image", label: L("Image 2", "Image 2") },
    { key: "image3", type: "image", label: L("Image 3", "Image 3") },
    { key: "imageSide", type: "select", default: "right", label: L("Côté des images", "Image side"), options: [opt("right", "À droite", "Right"), opt("left", "À gauche", "Left")] },
    { key: "video", type: "video", label: L("Vidéo (type « texte sur une vidéo »)", "Video (\"text over a video\" type)") },
    { key: "poster", type: "image", label: L("Image avant lecture de la vidéo", "Image shown before the video plays") },
    { key: "videoSound", type: "boolean", default: false, label: L("Permettre d'activer le son", "Let visitors turn the sound on") },
    { key: "tone", type: "select", default: "plain", group: "appearance", label: L("Fond du bloc", "Block background"), options: [opt("plain", "Aucun", "None"), opt("surface", "Carte (couleur de surface du site)", "Card (site surface color)"), opt("accent", "Couleur d'accent du site", "Site accent color")] },
    { key: "bgImage", type: "image", group: "appearance", label: L("Image de fond du bloc", "Block background image"),
      help: L("Placée derrière le contenu du bloc. Astuce : une image de la taille du bloc, préparée avec vos propres éléments, vous permet de placer un visuel exactement où vous voulez.", "Placed behind the block's content. Tip: an image sized like the block, prepared with your own elements, lets you put a visual exactly where you want.") },
    { key: "bgSize", type: "select", default: "cover", group: "appearance", label: L("Taille de l'image de fond", "Background image size"), options: [opt("cover", "Remplir le bloc", "Fill the block"), opt("contain", "Entière dans le bloc", "Whole image inside the block"), opt("auto", "Taille réelle", "Actual size")] },
    { key: "bgPosition", type: "select", default: "center", group: "appearance", label: L("Position de l'image de fond", "Background image position"),
      options: [opt("center", "Centre", "Center"), opt("top", "Haut", "Top"), opt("bottom", "Bas", "Bottom"), opt("left", "Gauche", "Left"), opt("right", "Droite", "Right"), opt("top-left", "Haut gauche", "Top left"), opt("top-right", "Haut droite", "Top right"), opt("bottom-left", "Bas gauche", "Bottom left"), opt("bottom-right", "Bas droite", "Bottom right")] },
    { key: "bgVeil", type: "select", default: "none", group: "appearance", label: L("Voile sur l'image de fond", "Veil over the background image"), help: L("Pour garder le texte lisible.", "To keep the text readable."), options: [opt("none", "Aucun", "None"), opt("light", "Clair", "Light"), opt("dark", "Sombre (texte blanc)", "Dark (white text)")] },
  ],
};

export const locales: BuiltinModule["locales"] = {};

const KINDS = ["media", "tabs", "stats", "cta", "video"] as const;
const IMAGE_RE = /^(\/uploads\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)|https:\/\/[^\s"'()<>\\]+)$/;
const VIDEO_RE = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const image = (v: unknown) => (typeof v === "string" && IMAGE_RE.test(v) ? v : undefined);

export const definition = defineModule({
  sections: {
    async block(ctx) {
      const kind = pick(ctx.setting("kind"), KINDS, "media");
      const href = (ctx.setting("buttonUrl") ?? "").trim();
      const label = (ctx.setting("buttonLabel") ?? "").trim();
      const bgSrc = image(ctx.setting("bgImage"));
      const items = kind === "tabs" || kind === "stats"
        ? (await ctx.api.entries.list({ limit: 24, locale: ctx.locale })).map((e) => ({ title: e.title, heading: e.summary || undefined, text: e.body || undefined, image: image(e.cover) }))
        : undefined;
      const video = ctx.setting("video") ?? "";
      return [{
        type: "panel",
        kind,
        eyebrow: ctx.setting("eyebrow") || undefined,
        title: ctx.setting("title") || undefined,
        text: ctx.setting("text") || undefined,
        // Un lien de bouton : une page du site ou une adresse https (le rendu le revérifie).
        button: label && /^(\/(?!\/)|https?:\/\/|mailto:)/.test(href) ? { label, href } : undefined,
        images: ["image1", "image2", "image3"].map((k) => image(ctx.setting(k))).filter((x): x is string => !!x),
        imageSide: pick(ctx.setting("imageSide"), ["left", "right"] as const, "right"),
        tone: pick(ctx.setting("tone"), ["plain", "surface", "accent"] as const, "plain"),
        bg: bgSrc ? { src: bgSrc, size: pick(ctx.setting("bgSize"), ["cover", "contain", "auto"] as const, "cover"), position: ctx.setting("bgPosition") ?? "center", veil: pick(ctx.setting("bgVeil"), ["none", "light", "dark"] as const, "none") } : undefined,
        items,
        ...(kind === "video" && VIDEO_RE.test(video) ? { video, videoSound: ctx.setting<boolean>("videoSound") === true, videoPoster: image(ctx.setting("poster")) } : {}),
      }];
    },
  },
});
