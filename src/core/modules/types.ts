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

/** Un module qui déclare `content` gère des entrées (articles, liens, codes…) via l'éditeur du cœur. */
export type ContentConfig = {
  display: "cards" | "list" | "links" | "codes";
  clickAction: "detail" | "external";
  features: string[];
  fieldSchema?: { key: string; label: string; type: "text" | "url" | "number" | "boolean" }[];
  allowGoLinks?: boolean;
  fallbackToDefault?: boolean;
  /** Chemin public proposé à la création d'une instance. */
  basePath?: string;
  showInNav?: boolean;
};

export type SectionDecl = {
  id: string;
  label: LocalizedString;
  /** Options réglées à chaque placement de la section sur l'accueil. */
  options?: SettingField[];
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
  /** Icône (emoji) du module dans l'admin. */
  icon?: string;
  /** "multiple" : autant d'instances que l'on veut (ex. plusieurs blogs). "single" : une seule. */
  instances: "single" | "multiple";
  content?: ContentConfig;
  /** Une instance de ce module a une page publique (montée sur un chemin). Défaut : oui si `content`. */
  page?: boolean;
  /** Morceaux que les instances proposent à la page d'accueil. */
  sections: SectionDecl[];
  /** Réglages propres à chaque instance. */
  settings: SettingField[];
  /** Livré avec le cœur et proposé à l'assistant de première installation. */
  starter?: boolean;
  /** Modules livrés avec le cœur : activés dès le départ (défaut : oui). */
  defaultEnabled?: boolean;
  /** Déclaratif et informatif : affiché à l'administrateur avant activation. */
  permissions: ("slots" | "routes" | "storage" | "filters" | "sections" | "pages")[];
};

export type EntrySummary = {
  title: string;
  summary: string;
  url: string | null;
  code: string | null;
  path: string;
  publishedAt: Date | null;
};

export type ModuleApi = {
  siteUrl: string;
  entries: {
    /** Entrées publiées d'une instance (par défaut : la sienne). */
    list(opts?: { instance?: string; locale?: string; limit?: number }): Promise<EntrySummary[]>;
  };
  site(locale?: string): Promise<{ name: string; tagline: string; logo: string | null }>;
  instances: {
    list(opts?: { locale?: string; module?: string }): Promise<{ key: string; module: string; basePath: string | null; name: string }[]>;
  };
  /** Stockage privé de l'instance (messages reçus, compteurs…). */
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
  /** L'instance pour laquelle le module s'exécute : un module tourne une fois par instance. */
  instance: { id: string; key: string; basePath: string | null; name: string };
  /** Langue du visiteur (ou de l'admin, dans le panneau d'admin). */
  locale: string;
  defaultLocale: string;
  locales: string[];
  /** Réglage de l'instance, résolu pour la langue courante, avec sa valeur par défaut. */
  setting<T = string>(key: string): T | undefined;
  /** Traduction depuis locales/<langue>.json du module (repli : langue par défaut puis clé). */
  t(key: string, vars?: Record<string, string | number>): string;
  api: ModuleApi;
};

export type SlotContext = ModuleContext & {
  /** Présent pour page.* et entry.* : l'instance dont on affiche la page (pas forcément celle du module). */
  page?: { key: string; basePath: string | null };
  /** Présent pour entry.* */
  entry?: { id: string; title: string; slug: string };
};

export type RouteHandler = (request: Request, ctx: ModuleContext) => Response | Promise<Response>;

export type PageResult = {
  title?: string;
  description?: string;
  blocks: Block[];
  /** Affiche la page d'erreur 404. */
  notFound?: boolean;
};

export type ModuleDefinition = {
  /** Contribue des blocs à un emplacement du site (une fois par instance active). */
  slots?: Partial<Record<Slot, (ctx: SlotContext) => Block[] | null | undefined | Promise<Block[] | null | undefined>>>;
  /** Morceaux placés sur la page d'accueil. `options` = réglages du placement. Les modules à contenu ont déjà la section "latest". */
  sections?: Record<string, (ctx: ModuleContext, options: Record<string, unknown>) => Block[] | null | undefined | Promise<Block[] | null | undefined>>;
  /** Page publique de l'instance, montée sur son chemin. `segments` = ce qui suit le chemin. Absent = rendu par défaut du cœur (liste + entrées) pour les modules à contenu. */
  page?: (ctx: ModuleContext, request: { segments: string[] }) => PageResult | null | Promise<PageResult | null>;
  /** Routes exposées sous /m/<clé d'instance>/<route> (GET et POST). */
  routes?: Record<string, RouteHandler>;
  /** Transforme le corps markdown d'une entrée avant son rendu (ex. shortcodes). */
  filters?: { entryBody?: (body: string, ctx: SlotContext) => string | Promise<string> };
  /** Contenu du panneau d'admin de l'instance, sous ses réglages. */
  adminPanel?: (ctx: ModuleContext) => Block[] | Promise<Block[]>;
  hooks?: {
    onInstanceCreate?(ctx: ModuleContext): void | Promise<void>;
    onInstanceDelete?(ctx: ModuleContext): void | Promise<void>;
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
