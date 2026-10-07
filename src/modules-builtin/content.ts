import type { ParsedManifest } from "@/core/modules/manifest";
import type { BuiltinModule } from ".";

/**
 * Les modules « à contenu » livrés avec le cœur. Ils ne contiennent pas de code :
 * ils déclarent seulement *comment* leurs entrées se présentent. L'éditeur, les
 * langues, les pages publiques, le flux de nouveautés et la section d'accueil
 * « dernières entrées » viennent du cœur. Un blog, une liste de réseaux sociaux
 * et une liste de codes promo sont donc trois réglages différents d'une même
 * mécanique — et chacun peut avoir autant d'instances qu'on veut.
 */
const base = {
  apiVersion: 2,
  author: "Vitrine",
  license: "MIT",
  instances: "multiple" as const,
  sections: [],
  consumes: [],
  provides: [],
  settings: [],
  permissions: ["pages", "sections"] as ParsedManifest["permissions"],
};

const make = (manifest: ParsedManifest): BuiltinModule => ({ manifest, definition: {} });

export const blog = make({
  ...base,
  id: "blog",
  name: { en: "Blog", fr: "Blog" },
  version: "1.0.0",
  icon: "📰",
  starter: true,
  description: { en: "Articles with cover, summary and Markdown content. Add as many blogs as you like.", fr: "Des articles avec image, résumé et contenu Markdown. Ajoutez autant de blogs que vous voulez." },
  content: { display: "cards", clickAction: "detail", features: ["cover", "summary", "body", "featured", "tags"], basePath: "blog", showInNav: true },
  onboarding: {
    preselected: true,
    home: { section: "latest", count: 3 },
    sample: {
      title: { en: "Welcome to your new site", fr: "Bienvenue sur votre nouveau site" },
      summary: { en: "This first article was created for you. Edit or delete it from the admin.", fr: "Ce premier article a été créé pour vous. Modifiez-le ou supprimez-le depuis l'admin." },
      body: {
        en: "Everything on this site — texts, links, colors, languages — is editable from the admin.\n\n- Add articles, promo codes or any entries to your collections\n- Create redirects such as /twitch\n- Install modules to add features",
        fr: "Tout ce qui s'affiche ici — textes, liens, couleurs, langues — se modifie depuis l'admin.\n\n- Ajoutez des articles, des codes promo ou n'importe quelles entrées à vos collections\n- Créez des redirections comme /twitch\n- Installez des modules pour ajouter des fonctionnalités",
      },
    },
  },
});

export const links = make({
  ...base,
  id: "links",
  name: { en: "Social links", fr: "Réseaux sociaux" },
  version: "1.0.0",
  icon: "🔗",
  starter: true,
  description: { en: "A list of links with icons — your social networks, your channels. Add one list per channel if you have several.", fr: "Une liste de liens avec icônes — vos réseaux, vos chaînes. Ajoutez une liste par chaîne si vous en avez plusieurs." },
  content: { display: "links", clickAction: "external", features: ["icon", "summary", "url", "tags"], basePath: "links", showInNav: false, allowGoLinks: true },
  onboarding: { preselected: true, collectsLinks: true, home: { section: "latest", count: 20 } },
});

export const codes = make({
  ...base,
  id: "codes",
  name: { en: "Promo codes", fr: "Codes promo" },
  version: "1.0.0",
  icon: "🏷️",
  starter: true,
  description: { en: "Partner offers with a code, a link and an expiry date.", fr: "Les offres de vos partenaires : code, lien et date d'expiration." },
  content: { display: "codes", clickAction: "external", features: ["icon", "cover", "summary", "body", "url", "code", "expiresAt", "tags"], basePath: "codes", showInNav: true, allowGoLinks: true },
  onboarding: { home: { section: "latest", count: 3 } },
});

export const pages = make({
  ...base,
  id: "pages",
  name: { en: "Pages", fr: "Pages" },
  version: "1.0.0",
  icon: "📄",
  starter: true,
  description: { en: "Free-form pages at the site root (/about, /contact…).", fr: "Des pages libres à la racine du site (/a-propos, /contact…)." },
  instances: "single",
  content: { display: "list", clickAction: "detail", features: ["cover", "summary", "body"], basePath: "", showInNav: false },
});

export const collection = make({
  ...base,
  id: "collection",
  name: { en: "Custom collection", fr: "Collection personnalisée" },
  version: "1.0.0",
  icon: "🗂️",
  description: { en: "A blank content module: choose its display, fields and behavior yourself.", fr: "Un module de contenu vierge : choisissez vous-même affichage, champs et comportement." },
  content: { display: "cards", clickAction: "detail", features: ["summary", "body"], showInNav: true },
});
