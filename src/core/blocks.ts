/**
 * Blocs déclaratifs : c'est ce qu'un module renvoie pour modifier le site ou
 * remplir son panneau d'admin. Le cœur se charge du rendu, des thèmes et des
 * langues ; le module ne manipule jamais React directement.
 */
export type HeadTag =
  | { tag: "meta"; name?: string; property?: string; content: string }
  | { tag: "link"; rel: string; href: string; type?: string; title?: string }
  /** `jsonLd` : données structurées schema.org (objet) — le cœur écrit la balise `application/ld+json` et échappe tout ; à obtenir par `ctx.api.seo.jsonLd(…)`. */
  | { tag: "script"; src?: string; inline?: string; defer?: boolean; jsonLd?: Record<string, unknown> };

export type AdminField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "email" | "url" | "number" | "date" | "select" | "hidden" | "image" | "checkbox"
    /** (cœur 0.2.0) Fichier TEXTE (UTF-8) de 5 Mo au plus, lu par le cœur et transmis à l'action en texte dans `values[name]`. Un cœur plus ancien l'ignore (exigez `minCore` 0.2.0). */
    | "file";
  /** `kind: "file"` : types acceptés (comme l'attribut HTML `accept`, par exemple « .csv,.txt »). Le cœur n'accepte de toute façon que du texte (csv, tsv, txt, json, vcf). */
  accept?: string;
  /** `kind: "file"` : taille maximale en octets (5 242 880 au plus, valeur par défaut). */
  maxBytes?: number;
  value?: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
};

export type Block =
  | { type: "markdown"; text: string }
  /** HTML brut : le module est un code de confiance (voir docs/MODULES.md). */
  | { type: "html"; html: string }
  | { type: "banner"; text: string; href?: string; tone?: "info" | "success" | "warning" }
  | { type: "links"; items: { label: string; href: string; icon?: string }[] }
  | { type: "entries"; instance: string; limit?: number; title?: string; link?: boolean; /** "random" : `limit` entrées tirées au hasard (au lieu des plus récentes). */ pick?: "random" }
  | { type: "hero"; title: string; text?: string; image?: string; /** Petite ligne au-dessus du titre. */ eyebrow?: string; /** Bouton d'appel à l'action (libellé + page du site ou adresse https). */ button?: { label: string; href: string }; video?: string; videoPoster?: string; videoSound?: boolean }
  /**
   * Morceau de page (module « Blocs de page ») : `media` (texte + images), `tabs` (onglets), `stats` (chiffres clés), `cta` (appel à l'action) ou `video` (texte sur une vidéo).
   * `items` : onglets ou chiffres (`title` = libellé ou nombre, `heading` = titre du texte ou légende, `text` = texte Markdown, `image`). `bg` : image de fond du bloc.
   */
  | {
      type: "panel";
      kind: "media" | "tabs" | "stats" | "cta" | "video";
      eyebrow?: string; title?: string; text?: string;
      button?: { label: string; href: string };
      images?: string[]; imageSide?: "left" | "right";
      tone?: "plain" | "surface" | "accent";
      bg?: { src: string; size: "cover" | "contain" | "auto"; position: string; veil: "none" | "light" | "dark" };
      items?: { title: string; heading?: string; text?: string; image?: string }[];
      video?: string; videoPoster?: string; videoSound?: boolean;
    }
  | { type: "embed"; src: string; title: string; ratio?: string }
  | {
      type: "form";
      /** Chemin relatif à la route du module : posté sur /m/<clé de l'instance>/<route>. */
      action: string;
      fields: { name: string; label: string; kind?: "text" | "email" | "textarea"; required?: boolean }[];
      submitLabel: string;
      successText: string;
    }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
      /** Identifiants des lignes (même ordre que `rows`), requis si `rowActions` est utilisé. */
      rowIds?: string[];
      /** Boutons par ligne : `action` exécute une adminAction du module, `href` navigue ({id} est remplacé). */
      rowActions?: { label: string; action?: string; href?: string; confirm?: string; danger?: boolean }[];
    }
  /** Formulaire d'admin : poste sur une adminAction du module (administrateurs seulement, panneau d'admin uniquement). */
  | {
      type: "adminForm";
      action: string;
      title?: string;
      submitLabel: string;
      fields: AdminField[];
      /** Lien « Annuler » (par exemple retour à la liste après une modification). */
      cancelHref?: string;
    }
  /**
   * Éditeur de GRILLE (panneau d'admin uniquement) : on choisit un pinceau dans la palette puis on peint les cases à la souris ou au doigt ;
   * on peut redimensionner. Poste sur une adminAction `width`, `height` et `cells` (un caractère par case, ligne après ligne ; chaque
   * caractère est la `value` d'un élément de la palette). `labels` : textes de l'éditeur (par défaut en anglais).
   *
   * Deux options (absentes = comportement d'avant) :
   * - `generateAction` + `generateLabel` : bouton « générer » qui appelle l'adminAction `generateAction` (elle RENVOIE `{ grid: { width, height, cells } }`
   *   sans rien enregistrer) et charge le résultat dans l'éditeur ; rien n'est persisté avant « Enregistrer ».
   * - `autoLabel` (+ `autoNotice`, `autoActive`) : bouton qui bascule l'éditeur en mode « automatique » (grille atténuée, message `autoNotice`) ;
   *   enregistrer envoie alors `auto=true` à `action` au lieu de la grille. `autoActive` : l'éditeur démarre dans ce mode.
   * « Annuler les modifications » défait aussi la génération et le mode automatique.
   */
  | {
      type: "gridEditor";
      action: string;
      title?: string;
      submitLabel: string;
      width: number;
      height: number;
      cells: string;
      palette: { value: string; label: string; color: string }[];
      minSize?: number;
      maxSize?: number;
      cancelHref?: string;
      generateAction?: string;
      generateLabel?: string;
      autoLabel?: string;
      autoNotice?: string;
      autoActive?: boolean;
      labels?: { width?: string; height?: string; fillAll?: string; border?: string; reset?: string; hint?: string; generateError?: string };
    }
  | { type: "heading"; text: string }
  /** Pastilles de couleur avec code copiable. `hex` : #RRGGBB. */
  | { type: "swatches"; items: { name: string; hex: string; role?: string }[] }
  /** Fichiers (images) proposés au téléchargement, avec aperçu. */
  | { type: "downloads"; items: { src: string; label: string; detail?: string }[] }
  /**
   * (cœur 0.2.0, panneau d'admin SEULEMENT, ignoré ailleurs) Bouton qui télécharge un fichier produit par `adminDownloads.<name>` du module. Le droit, l'audit et les
   * limites sont ceux du cœur ; `params` est transmis au module (valeurs courtes en texte, à valider). Un cœur plus ancien ignore ce bloc.
   */
  | { type: "download"; name: string; label: string; params?: Record<string, string> }
  /** Texte à copier d'un clic (description courte, formule de présentation…). */
  | { type: "copy"; label?: string; text: string }
  | { type: "head"; tags: HeadTag[] }
  /**
   * Santé des services externes (panneau d'admin uniquement ; ignoré sur le site public). Pour chaque hôte appelé via `ctx.api.net`, le cœur écrit une
   * phrase simple en FR/EN d'après son état réel : « Service répond normalement », « … répond lentement depuis 10 h 42 », « Trop de demandes : pause
   * jusqu'à 11 h 00 », « Quota du jour épuisé, reprise à 9 h 00 », « … ne répond pas ; le site affiche les dernières données connues ».
   * `label` : nom lisible donné par le module (le cœur ne connaît aucun fournisseur) ; `lastGoodAt` (ISO 8601) : date des données affichées.
   */
  | { type: "netHealth"; items: { host: string; label: string; lastGoodAt?: string }[] }
  /**
   * Suggestion d'installation (cœur 0.2.0, panneau d'admin d'une instance SEULEMENT, ignoré ailleurs) : « il manque un module qui offre `service` ».
   * Le cœur cherche lui-même dans le catalogue qui l'offre (version ≥ `min`) ; le propriétaire installe d'un clic ou dit « Ne plus proposer » ;
   * les autres lisent « Demandez au propriétaire du site d'installer un module qui <reason> ». Rien n'est montré si un fournisseur actif existe.
   * `reason` : fin de phrase, mots simples (« affiche vos prochains lives »). Un cœur plus ancien ignore ce bloc.
   */
  | { type: "suggestInstall"; service: string; min?: number; reason: string };

/**
 * Emplacements où un module peut ajouter des blocs. La page d'accueil n'en a
 * pas : elle est un assemblage de *sections* (voir ModuleDefinition.sections).
 */
export type Slot =
  | "layout.head"
  | "layout.banner"
  | "layout.footer"
  | "nav.items"
  | "page.top"
  | "page.bottom"
  | "entry.top"
  | "entry.bottom";

export const SLOTS: Slot[] = [
  "layout.head",
  "layout.banner",
  "layout.footer",
  "nav.items",
  "page.top",
  "page.bottom",
  "entry.top",
  "entry.bottom",
];
