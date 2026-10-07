import type { Theme } from "../color";
import type { Block, Slot } from "../blocks";

// Les modules typent leurs blocs avec ce ré-export : ils n'importent rien d'autre du cœur.
export type { Block, Slot };

export type LocalizedString = string | Record<string, string>;

export type SettingField = {
  key: string;
  label: LocalizedString;
  type: "text" | "textarea" | "url" | "number" | "boolean" | "select" | "color" | "secret" | "image";
  help?: LocalizedString;
  default?: string | number | boolean;
  options?: { value: string; label: LocalizedString }[];
  /** Une valeur par langue du site (sinon une seule valeur globale). */
  translatable?: boolean;
  /** Réglage technique : masqué dans la version simplifiée de l'admin (sa valeur par défaut s'applique). */
  advanced?: boolean;
  /** « appearance » : réglage d'apparence, regroupé à part dans l'admin. Une couleur peut avoir pour défaut `"theme:accent"` (ou bg, fg, surface, muted, line, accentFg) : elle suit alors le thème du site. */
  group?: "appearance";
};

/** Un module qui déclare `content` gère des entrées (articles, liens, codes…) via l'éditeur du cœur. */
export type ContentConfig = {
  display: "cards" | "list" | "links" | "codes";
  clickAction: "detail" | "external";
  features: string[];
  fieldSchema?: { key: string; label: string; type: "text" | "url" | "number" | "boolean" | "ref"; topic?: string }[];
  allowGoLinks?: boolean;
  fallbackToDefault?: boolean;
  /** Chemin public proposé à la création d'une instance. */
  basePath?: string;
  showInNav?: boolean;
};

/** Taille naturelle d'un morceau de l'accueil : la page s'écoule, ces tailles disent seulement la place qu'il aime prendre. */
export const SECTION_SIZES = ["small", "medium", "large", "full"] as const;
export type SectionSize = (typeof SECTION_SIZES)[number];

export type SectionDecl = {
  id: string;
  label: LocalizedString;
  /** Options réglées à chaque placement de la section sur l'accueil. */
  options?: SettingField[];
  /** Taille naturelle recommandée sur l'accueil (l'administrateur peut la changer). Absent = pleine largeur. */
  size?: SectionSize;
};

/** Catégorie d'un module : décide où il apparaît dans l'admin et comment ses instances sont exposées. */
export const MODULE_TYPES = ["content", "overlay", "widget", "integration", "utility"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** Champ d'un sujet : le consommateur déclare ce qu'il sait digérer. */
export type TopicField = { key: string; type: "string" | "url" | "number" | "boolean" | "string[]"; required?: boolean };

/** Information qu'un module sait recevoir. Il en publie le format ; les autres modules s'y conforment. */
export type ConsumeDecl = {
  topic: string;
  label: LocalizedString;
  /** Format attendu. Absent pour les sujets du cœur (core.entry). */
  schema?: TopicField[];
  /** L'admin peut restreindre les sources par étiquette. */
  tags?: boolean;
};

export type ProvideDecl = { topic: string; label?: LocalizedString };

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
  /** Catégorie. Défaut : "content" si `content` est déclaré, sinon "widget". */
  type?: ModuleType;
  /** "multiple" : autant d'instances que l'on veut (ex. plusieurs blogs). "single" : une seule. */
  instances: "single" | "multiple";
  content?: ContentConfig;
  /** Une instance de ce module a une page publique (montée sur un chemin). Défaut : oui si `content`. */
  page?: boolean;
  /** Chemin public proposé à la création d'une instance d'un module à page (défaut : la clé de l'instance). */
  basePath?: string;
  /** Morceaux que les instances proposent à la page d'accueil. */
  sections: SectionDecl[];
  /** Informations que ce module digère (ses instances s'abonnent à des sources dans l'admin). */
  consumes?: ConsumeDecl[];
  /** Informations que ce module expose aux consommateurs (`exports.<sujet>` dans son code). */
  provides?: ProvideDecl[];
  /** Réglages propres à chaque instance. */
  settings: SettingField[];
  /** Actions proposées à l'API MCP du cœur (désactivable). */
  mcp?: McpDecl[];
  /** Proposé à l'assistant de première installation (cases à cocher « que voulez-vous publier ? »). */
  starter?: boolean;
  /** Comment ce module participe à la première installation. Le cœur n'a aucune connaissance d'un module en particulier : tout est déclaré ici. */
  onboarding?: {
    /** Créé d'office, sans question (ex. le bandeau d'accueil). */
    always?: boolean;
    /** Coché par défaut dans l'assistant. */
    preselected?: boolean;
    /** Section placée sur l'accueil à la création (`count` = nombre d'entrées pour « latest »). */
    home?: { section: string; count?: number };
    /** Entrée d'exemple créée à la première installation, pour que le site ne soit pas vide. */
    sample?: { title: LocalizedString; summary?: LocalizedString; body?: LocalizedString };
    /** L'assistant demande à l'utilisateur ses liens (Twitch, YouTube…) et les range dans ce module. */
    collectsLinks?: boolean;
  };
  /** Modules livrés avec le cœur : activés dès le départ (défaut : oui). */
  defaultEnabled?: boolean;
  /** Déclaratif et informatif : affiché à l'administrateur avant activation. */
  permissions: ("slots" | "routes" | "storage" | "filters" | "sections" | "pages" | "topics" | "overlay" | "mcp" | "admin" | "mail")[];
};

export type EntrySummary = {
  id: string;
  title: string;
  cover: string | null;
  icon: string | null;
  tags: string[];
  /** Valeurs des champs personnalisés de l'instance (les champs « ref » contiennent l'identifiant référencé). */
  fields: Record<string, unknown>;
  slug: string;
  summary: string;
  url: string | null;
  code: string | null;
  path: string;
  publishedAt: Date | null;
};

/** Un élément reçu d'un fournisseur : champs du schéma du consommateur + sa provenance. */
export type TopicItem = Record<string, unknown> & { source: { instance: string; module: string; name: string } };

/** Identité visuelle du site, lue depuis les réglages du cœur (voir src/core/brand.ts). Lecture seule. */
export type ModuleBrand = {
  name: string;
  tagline: string;
  about: string;
  logo: string | null;
  contactEmail: string;
  colors: { key: string; name: string; hex: string; role: string }[];
  font: { key: string; name: string; stack: string };
  defaultLocale: string;
  locales: string[];
};

export type ModuleApi = {
  topics: {
    /**
     * Récupère les informations des sources auxquelles CETTE instance est abonnée
     * (réglé dans l'admin). Le sujet doit être déclaré dans `consumes`.
     */
    collect(topic: string, opts?: { limit?: number }): Promise<TopicItem[]>;
  };
  siteUrl: string;
  entries: {
    /** Entrées publiées d'une instance (par défaut : la sienne). */
    list(opts?: { instance?: string; locale?: string; limit?: number }): Promise<EntrySummary[]>;
  };
  site(locale?: string): Promise<{ name: string; tagline: string; logo: string | null }>;
  /** Identité visuelle (nom, présentation, logo, palette, police) : exactement ce que le site utilise. */
  brand(locale?: string): Promise<ModuleBrand>;
  instances: {
    list(opts?: { locale?: string; module?: string }): Promise<{ key: string; module: string; basePath: string | null; name: string }[]>;
  };
  /** Génère un QR code (SVG, fond transparent) pour un texte ou une URL. */
  qr(text: string): Promise<string>;
  /**
   * Rend une image PNG (`Response`) depuis une arborescence de boîtes `{ type: "div" | "span" | "p" | "b" | "img", props: { style, children, src } }`
   * (flexbox, styles en ligne). Une `img` n'accepte qu'un chemin du site ou une adresse https publique. Lève une erreur si la description est invalide.
   */
  png(spec: { width: number; height: number; tree: unknown }): Promise<Response>;
  /** Envoi d'e-mails au nom du site (nécessite la permission « mail »). Ne lève jamais : renvoie `{ ok, reason }`. */
  mail: {
    /** Le site a-t-il un serveur d'e-mail configuré ? */
    configured(): Promise<boolean>;
    /** `to` : « owner » (le contact du site) ou une adresse. Texte brut ; l'expéditeur est celui du site. */
    send(message: { to: "owner" | string; subject: string; text: string; replyTo?: string }): Promise<{ ok: true } | { ok: false; reason: "not_configured" | "no_recipient" | "invalid" | "rate_limited" | "failed" }>;
  };
  /** Stockage privé de l'instance (messages reçus, compteurs…). */
  store: {
    add(collection: string, data: Record<string, unknown>): Promise<string>;
    get(id: string): Promise<{ id: string; createdAt: Date; data: Record<string, unknown> } | null>;
    update(id: string, data: Record<string, unknown>): Promise<boolean>;
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
  /** Le thème réglé dans l'admin (couleurs dérivées, police) : exactement ce que le site utilise. Pour que l'apparence d'un module suive le site. */
  theme: Theme;
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

export type TopicQuery = { locale: string; limit: number; tags: string[] };

/** Rendu d'un overlay (source navigateur OBS) : page nue, fond transparent, sous /overlays/<clé>. */
export type OverlayResult = { html: string; css?: string; script?: string; title?: string };

export type PageResult = {
  title?: string;
  description?: string;
  blocks: Block[];
  /** Affiche la page d'erreur 404. */
  notFound?: boolean;
};

/** Un fichier texte ajouté à la sauvegarde ; `path` est relatif au dossier de l'instance (`modules/<instance>/<path>`). */
export type BackupFile = { path: string; content: string };

export type ModuleDefinition = {
  /** Contribue des blocs à un emplacement du site (une fois par instance active). */
  slots?: Partial<Record<Slot, (ctx: SlotContext) => Block[] | null | undefined | Promise<Block[] | null | undefined>>>;
  /** Morceaux placés sur la page d'accueil. `options` = réglages du placement. Les modules à contenu ont déjà la section "latest". */
  sections?: Record<string, (ctx: ModuleContext, options: Record<string, unknown>) => Block[] | null | undefined | Promise<Block[] | null | undefined>>;
  /** Page publique de l'instance, montée sur son chemin. `segments` = ce qui suit le chemin. Absent = rendu par défaut du cœur (liste + entrées) pour les modules à contenu. */
  page?: (ctx: ModuleContext, request: { segments: string[] }) => PageResult | null | Promise<PageResult | null>;
  /** Overlay : rendu de la page /overlays/<clé de l'instance> (modules de type "overlay"). */
  overlay?: (ctx: ModuleContext, request: { query: URLSearchParams }) => OverlayResult | Promise<OverlayResult>;
  /** Informations exposées aux consommateurs, par sujet déclaré dans `provides`. Exécuté pour chaque instance fournisseuse. */
  exports?: Record<string, (ctx: ModuleContext, query: TopicQuery) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>>;
  /** Routes exposées sous /m/<clé d'instance>/<route> (GET et POST). */
  routes?: Record<string, RouteHandler>;
  /** Transforme le corps markdown d'une entrée avant son rendu (ex. shortcodes). */
  filters?: { entryBody?: (body: string, ctx: SlotContext) => string | Promise<string> };
  /** Contenu du panneau d'admin de l'instance, sous ses réglages. `query` = paramètres de l'URL d'admin. */
  adminPanel?: (ctx: ModuleContext, request: { query: Record<string, string> }) => Block[] | Promise<Block[]>;
  /** Actions déclenchées par les blocs `adminForm` et les boutons de ligne des `table` du panneau d'admin. */
  adminActions?: Record<string, AdminActionHandler>;
  /** Implémentation des actions MCP déclarées dans `mcp` du manifeste. */
  mcp?: Record<string, McpHandler>;
  /**
   * Migrations de données. `migrations[N](ctx)` fait passer les données d'UNE instance de la version N-1 à la version N
   * (`dataVersion` du manifeste). Le cœur les exécute, dans l'ordre, après une mise à jour du module et après une restauration
   * de sauvegarde, pour chaque instance qui est en retard. Voir src/core/modules/dataMigrations.ts.
   */
  migrations?: Record<number, (ctx: ModuleContext) => void | Promise<void>>;
  /**
   * Sauvegarde. Le cœur sauvegarde déjà, pour tout module, ses réglages, son stockage (`ctx.api.store`) et les entrées de ses
   * instances. `readable` ajoute à la sauvegarde des fichiers LISIBLES SANS LE FRAMEWORK (CSV, Markdown, texte…) pour les
   * données que le module juge importantes : si le framework disparaît, l'utilisateur les relit avec n'importe quel éditeur.
   */
  backup?: {
    readable?(ctx: ModuleContext): BackupFile[] | Promise<BackupFile[]>;
  };
  /**
   * Tâches planifiées. Le cœur les exécute en arrière-plan (un passage par minute) pour chaque instance ACTIVE : jamais deux fois en même temps,
   * une erreur n'arrête ni les autres tâches ni le serveur, le dernier résultat est mémorisé. Voir src/core/services/scheduler.ts.
   */
  tasks?: Record<string, ModuleTask>;
  hooks?: {
    onInstanceCreate?(ctx: ModuleContext): void | Promise<void>;
    onInstanceDelete?(ctx: ModuleContext): void | Promise<void>;
  };
};

export type ModuleTask = {
  /** Intervalle minimal entre deux exécutions (≥ 1 minute ; le cœur ne passe qu'une fois par minute). */
  everyMinutes: number;
  run(ctx: ModuleContext): void | Promise<void>;
};

/** Sous-ensemble de JSON Schema accepté pour décrire les arguments d'une action MCP. */
export type JsonSchemaLite = {
  type: "object";
  properties?: Record<string, { type: "string" | "number" | "integer" | "boolean" | "array"; description?: string; enum?: string[]; maxLength?: number; minimum?: number; maximum?: number; items?: { type: "string" } }>;
  required?: string[];
};

/** Action exposée par le module à l'API MCP du cœur (voir docs/MODULES.md). */
export type McpDecl = {
  name: string;
  description: string;
  /** Lecture seule (défaut : non). Les jetons « lecture » n'ont accès qu'aux actions en lecture seule. */
  readOnly?: boolean;
  /**
   * Accordée par défaut aux nouveaux jetons ? Un module peut implémenter plus d'actions qu'il n'en active
   * d'office : l'administrateur accorde les autres à la main, jeton par jeton, action par action.
   * Défaut : oui pour une lecture seule, NON pour une action qui écrit.
   */
  default?: boolean;
  /** Action irréversible (suppression…) : signalée comme telle, confirmation avant de l'accorder. Doit être `default: false`. */
  destructive?: boolean;
  input?: JsonSchemaLite;
};

/** `actor` : le jeton MCP qui appelle (à reporter dans les champs « modifié par » des données). */
export type McpHandler = (ctx: ModuleContext, args: Record<string, unknown>, actor: { name: string }) => unknown | Promise<unknown>;
export type AdminActionResult = { ok?: string; error?: string; redirect?: string };
export type AdminActionHandler = (ctx: ModuleContext, values: Record<string, string>) => AdminActionResult | Promise<AdminActionResult>;

/** Aide de typage : `export default defineModule({...})`. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

export function localized(value: LocalizedString | undefined, locale: string, defaultLocale: string): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value[defaultLocale] ?? value.en ?? Object.values(value)[0] ?? "";
}
