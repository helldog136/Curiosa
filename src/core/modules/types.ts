import type { Block, Slot } from "../blocks";

export type LocalizedString = string | Record<string, string>;

export type SettingField = {
  key: string;
  label: LocalizedString;
  type: "text" | "textarea" | "url" | "number" | "boolean" | "select" | "color" | "secret";
  help?: LocalizedString;
  default?: string | number | boolean;
  options?: { value: string; label: LocalizedString }[];
  /** Une valeur par langue du site (sinon une seule valeur globale). */
  translatable?: boolean;
};

export type ModuleManifest = {
  apiVersion: number;
  id: string;
  name: LocalizedString;
  version: string;
  description?: LocalizedString;
  author?: string;
  homepage?: string;
  license?: string;
  /** Fichier ES module du module, relatif à la racine du dépôt. Absent = module sans code. */
  main?: string;
  /** Icône (emoji) de l'entrée d'admin du module. */
  icon?: string;
  /** Activé automatiquement à l'installation (modules livrés avec le cœur seulement). */
  defaultEnabled?: boolean;
  settings: SettingField[];
  /** Déclaratif et informatif : affiché à l'administrateur avant activation. */
  permissions: ("slots" | "routes" | "storage" | "collections" | "filters")[];
};

export type ModuleApi = {
  siteUrl: string;
  entries: {
    list(opts: { collection: string; locale?: string; limit?: number }): Promise<
      { title: string; summary: string; url: string | null; code: string | null; path: string; publishedAt: Date | null }[]
    >;
  };
  collections: {
    list(locale?: string): Promise<{ key: string; basePath: string; name: string }[]>;
  };
  /** Stockage privé du module (messages reçus, compteurs…). */
  store: {
    add(collection: string, data: Record<string, unknown>): Promise<string>;
    list(
      collection: string,
      opts?: { limit?: number },
    ): Promise<{ id: string; createdAt: Date; data: Record<string, unknown> }[]>;
    remove(id: string): Promise<void>;
    count(collection: string): Promise<number>;
  };
};

export type ModuleContext = {
  moduleId: string;
  /** Langue du visiteur (ou de l'admin, dans le panneau d'admin). */
  locale: string;
  defaultLocale: string;
  locales: string[];
  /** Réglage du module, résolu pour la langue courante, avec sa valeur par défaut. */
  setting<T = string>(key: string): T | undefined;
  /** Traduction depuis locales/<langue>.json du module (repli : langue par défaut puis clé). */
  t(key: string, vars?: Record<string, string | number>): string;
  api: ModuleApi;
};

export type SlotContext = ModuleContext & {
  /** Présent pour collection.* et entry.* */
  collection?: { key: string; basePath: string };
  /** Présent pour entry.* */
  entry?: { id: string; title: string; slug: string };
};

export type RouteHandler = (request: Request, ctx: ModuleContext) => Response | Promise<Response>;

export type CollectionSeed = {
  key: string;
  basePath: string;
  names: Record<string, string>;
  display?: "cards" | "list" | "links" | "codes";
  clickAction?: "detail" | "external";
  features?: string[];
  showInNav?: boolean;
};

export type ModuleDefinition = {
  /** Contribue des blocs à un emplacement du site. Renvoyer null/[] = rien. */
  slots?: Partial<Record<Slot, (ctx: SlotContext) => Block[] | null | undefined | Promise<Block[] | null | undefined>>>;
  /** Routes exposées sous /m/<id>/<clé> (GET et POST). */
  routes?: Record<string, RouteHandler>;
  /** Transforme le corps markdown d'une entrée avant son rendu (ex. shortcodes). */
  filters?: { entryBody?: (body: string, ctx: SlotContext) => string | Promise<string> };
  /** Contenu du panneau d'admin du module, sous ses réglages. */
  adminPanel?: (ctx: ModuleContext) => Block[] | Promise<Block[]>;
  /** Collections créées si absentes à l'activation du module. */
  collections?: CollectionSeed[];
  hooks?: {
    onEnable?(ctx: ModuleContext): void | Promise<void>;
    onDisable?(ctx: ModuleContext): void | Promise<void>;
  };
};

/** Aide de typage : `export default defineModule({...})`. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

export function localized(value: LocalizedString | undefined, locale: string, defaultLocale: string): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value[defaultLocale] ?? value.en ?? Object.values(value)[0] ?? "";
}
