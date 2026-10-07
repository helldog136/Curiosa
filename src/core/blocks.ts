/**
 * Blocs déclaratifs : c'est ce qu'un module renvoie pour modifier le site ou
 * remplir son panneau d'admin. Le cœur se charge du rendu, des thèmes et des
 * langues ; le module ne manipule jamais React directement.
 */
export type HeadTag =
  | { tag: "meta"; name?: string; property?: string; content: string }
  | { tag: "link"; rel: string; href: string; type?: string; title?: string }
  | { tag: "script"; src?: string; inline?: string; defer?: boolean };

export type Block =
  | { type: "markdown"; text: string }
  /** HTML brut : le module est un code de confiance (voir docs/MODULES.md). */
  | { type: "html"; html: string }
  | { type: "banner"; text: string; href?: string; tone?: "info" | "success" | "warning" }
  | { type: "links"; items: { label: string; href: string; icon?: string }[] }
  | { type: "entries"; instance: string; limit?: number; title?: string; link?: boolean }
  | { type: "hero"; title: string; text?: string; image?: string }
  | { type: "embed"; src: string; title: string; ratio?: string }
  | {
      type: "form";
      /** Chemin relatif à la route du module : posté sur /m/<id>/<action>. */
      action: string;
      fields: { name: string; label: string; kind?: "text" | "email" | "textarea"; required?: boolean }[];
      submitLabel: string;
      successText: string;
    }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "heading"; text: string }
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
