/**
 * Blocs déclaratifs : c'est ce qu'un module renvoie pour modifier le site ou
 * remplir son panneau d'admin. Le cœur se charge du rendu, des thèmes et des
 * langues ; le module ne manipule jamais React directement.
 */
export type HeadTag =
  | { tag: "meta"; name?: string; property?: string; content: string }
  | { tag: "link"; rel: string; href: string; type?: string; title?: string }
  | { tag: "script"; src?: string; inline?: string; defer?: boolean };

export type AdminField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "email" | "url" | "number" | "date" | "select" | "hidden" | "image";
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
  | { type: "hero"; title: string; text?: string; image?: string; video?: string; videoPoster?: string; videoSound?: boolean }
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
      labels?: { width?: string; height?: string; fillAll?: string; border?: string; reset?: string; hint?: string };
    }
  | { type: "heading"; text: string }
  /** Pastilles de couleur avec code copiable. `hex` : #RRGGBB. */
  | { type: "swatches"; items: { name: string; hex: string; role?: string }[] }
  /** Fichiers (images) proposés au téléchargement, avec aperçu. */
  | { type: "downloads"; items: { src: string; label: string; detail?: string }[] }
  /** Texte à copier d'un clic (description courte, formule de présentation…). */
  | { type: "copy"; label?: string; text: string }
  | { type: "head"; tags: HeadTag[] };

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
