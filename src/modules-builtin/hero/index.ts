import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

export const manifest: ParsedManifest = {
  apiVersion: 2,
  id: "hero",
  name: { en: "Home banner", fr: "Bandeau d'accueil" },
  version: "1.0.0",
  description: { en: "Big title and intro for the top of the home page. Place its section where you want it.", fr: "Grand titre et introduction pour le haut de l'accueil. Placez sa section où vous voulez." },
  author: "Helldog136",
  license: "Curiosa License 1.0",
  icon: "🏁",
  onboarding: { always: true, home: { section: "hero" } },
  consumes: [],
  provides: [],
  instances: "multiple",
  sections: [{ id: "hero", label: { en: "Banner", fr: "Bandeau" } }],
  permissions: ["sections"],
  settings: [
    { key: "title", type: "text", translatable: true, label: { en: "Title", fr: "Titre" }, help: { en: "Empty = the site name.", fr: "Vide = le nom du site." } },
    { key: "text", type: "textarea", translatable: true, label: { en: "Intro", fr: "Introduction" }, help: { en: "Empty = the site tagline.", fr: "Vide = l'accroche du site." } },
    { key: "video", type: "video", label: { en: "Background video", fr: "Vidéo de fond" }, help: { en: "MP4 or WebM, 50 MB at most. It only plays while it is on screen. Keep it short and light (a few seconds in a loop).", fr: "MP4 ou WebM, 50 Mo au plus. Elle ne joue que lorsqu'elle est à l'écran. Préférez une vidéo courte et légère (quelques secondes en boucle)." } },
    { key: "poster", type: "image", label: { en: "Image shown before playing", fr: "Image affichée avant la lecture" }, help: { en: "Also shown if the video cannot play.", fr: "Aussi affichée si la vidéo ne peut pas se lancer." } },
    { key: "videoSound", type: "boolean", default: false, label: { en: "Let visitors turn the sound on", fr: "Permettre aux visiteurs d'activer le son" }, help: { en: "The video always starts muted (browsers require it); a button lets visitors unmute it.", fr: "La vidéo démarre toujours sans son (les navigateurs l'imposent) ; un bouton permet de l'activer." } },
    { key: "showLogo", type: "boolean", default: true, label: { en: "Show the logo", fr: "Afficher le logo" } },
  ],
};

export const locales: BuiltinModule["locales"] = {};

export const definition = defineModule({
  sections: {
    async hero(ctx) {
      const site = await ctx.api.site(ctx.locale);
      // Vidéo : seulement une vidéo envoyée sur ce site, jamais d'adresse externe.
      const video = ctx.setting("video") ?? "";
      const poster = ctx.setting("poster") ?? "";
      const withVideo = /^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/.test(video)
        ? { video, videoSound: ctx.setting<boolean>("videoSound") === true, ...(/^(https:\/\/|\/uploads\/)/.test(poster) ? { videoPoster: poster } : {}) }
        : {};
      return [
        {
          type: "hero",
          title: ctx.setting("title") || site.name,
          text: ctx.setting("text") || site.tagline || undefined,
          image: ctx.setting<boolean>("showLogo") && site.logo ? site.logo : undefined,
          ...withVideo,
        },
      ];
    },
  },
});
