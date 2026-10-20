import type { Theme } from "../color";
import type { Block, Slot } from "../blocks";
import type { StorePage, StoreRecord } from "../services/store";
import type { NetHealthItem, NetRequest, NetResult } from "../services/net";

// Les modules typent leurs blocs avec ce ré-export : ils n'importent rien d'autre du cœur.
export type { Block, Slot };
export type { NetHealthItem, NetRequest, NetResult };

export type LocalizedString = string | Record<string, string>;

export type SettingField = {
  key: string;
  label: LocalizedString;
  type: "text" | "textarea" | "url" | "link" | "number" | "boolean" | "select" | "color" | "secret" | "image" | "video";
  help?: LocalizedString;
  /** Valeur par défaut. Pour `text` / `textarea` : `"site:name"` (nom du site) ou `"site:tagline"` (accroche), dans la langue du champ. */
  default?: string | number | boolean;
  options?: { value: string; label: LocalizedString }[];
  /** Une valeur par langue du site (sinon une seule valeur globale). */
  translatable?: boolean;
  /** Réglage technique : masqué dans la version simplifiée de l'admin (sa valeur par défaut s'applique). */
  advanced?: boolean;
  /** Réglage facultatif : vide, il ne met pas l'extension « à configurer ». */
  optional?: boolean;
  /** « appearance » : réglage d'apparence, regroupé à part dans l'admin. Une couleur peut avoir pour défaut `"theme:accent"` (ou accent2, bg, fg, surface, muted, line, accentFg) : elle suit alors le thème du site. */
  group?: "appearance";
};

/**
 * Groupe de réglages FACULTATIF : tant qu'aucun de ses champs n'a de valeur, l'admin ne montre qu'un bouton « Ajouter… » ;
 * une fois ouvert, les champs `required` doivent être remplis pour enregistrer, et « Retirer » efface toutes les valeurs du groupe.
 */
export type OptionalGroupDecl = {
  id: string;
  label: LocalizedString;
  /** Texte du bouton qui ouvre le groupe (« Ajouter un bouton »). */
  addLabel: LocalizedString;
  /** Texte du bouton qui referme le groupe et efface ses valeurs (défaut : « Retirer »). */
  removeLabel?: LocalizedString;
  /** Clés des réglages du groupe (le groupe s'affiche à la place du premier d'entre eux). */
  fields: string[];
  /** Sous-ensemble de `fields` à remplir obligatoirement dès que le groupe est ouvert. */
  required?: string[];
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
export const MODULE_TYPES = ["content", "social", "overlay", "widget", "integration", "utility"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** Champ d'un sujet : le consommateur déclare ce qu'il sait digérer. */
export type TopicField = { key: string; type: "string" | "url" | "number" | "boolean" | "string[]" | "datetime"; required?: boolean };

/** Information qu'un module sait recevoir. Il en publie le format ; les autres modules s'y conforment. */
export type ConsumeDecl = {
  topic: string;
  label: LocalizedString;
  /** Format attendu. Absent pour les sujets du cœur (core.entry). */
  schema?: TopicField[];
  /** L'admin peut restreindre les sources par étiquette. */
  tags?: boolean;
};

/** Demande de semis : voir `ctx.seedInstance`. */
export type SeedRequest = {
  /** Surnom d'admin de l'instance créée (rendu unique parmi les instances du module cible : « Agenda », « Agenda 2 »…). */
  nickname: string;
  /** Noms publics par langue ; absent = le surnom, dans chaque langue du site. */
  names?: Record<string, string>;
  /** Réglages initiaux, validés par le manifeste du module cible (secrets compris). Réglage traduisible : une chaîne (toutes les langues) ou une valeur par langue. */
  settings: Record<string, string | number | boolean | Record<string, string>>;
  /** Identifiant stable de CETTE graine (« ical-url ») : une graine déjà semée, même si l'instance a été supprimée depuis, n'est jamais semée de nouveau. */
  seedKey: string;
};
export type SeedResult = { created: boolean; instanceKey: string };

export type ProvideDecl = { topic: string; label?: LocalizedString };

/**
 * Une section que ce module ajoute à l'éditeur d'entrée d'un AUTRE module. `for` : les entrées concernées, par sujet (`topic`, recommandé : toute instance dont le module
 * le fournit via `provides`) ou par module (`module`). Le module hôte ne sait rien de cette section ; elle n'apparaît que si ce module est installé et actif.
 */
export type EntryPanelDecl = { id: string; for: { topic?: string; module?: string }; title: LocalizedString; help?: LocalizedString };

export type ModuleManifest = {
  apiVersion: number;
  id: string;
  name: LocalizedString;
  version: string;
  /** Version minimale du cœur (« 0.1.10 »), vérifiée à l'installation et à la mise à jour ; absent = aucune exigence. Voir compat.ts. */
  minCore?: string;
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
  /** Plateforme concernée (« twitch », « discord »…) : regroupe à l'écran les instances d'une même plateforme. Facultatif, purement visuel. Voir platform.ts. */
  platform?: string;
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
  /** Modules dans lesquels une migration de données de ce module peut semer UNE instance (`ctx.seedInstance`). Le module cible doit offrir un service que celui-ci `requires`. */
  seeds?: SeedDecl[];
  /** Groupes de réglages facultatifs (un bouton « Ajouter… » les ouvre). */
  optionalGroups?: OptionalGroupDecl[];
  /** Sections ajoutées à l'éditeur d'entrée d'un autre module (`entryPanels` dans le code). */
  entryPanels?: EntryPanelDecl[];
  /** Actions proposées à l'API MCP du cœur (désactivable). */
  mcp?: McpDecl[];
  /** Ce qui se passe si l'utilisateur choisit ce module pendant l'assistant de première installation. Le cœur n'a aucune connaissance d'un module en particulier : tout est déclaré ici. */
  onboarding?: {
    /** Section placée sur l'accueil à la création (`count` = nombre d'entrées pour « latest »). */
    home?: { section: string; count?: number };
    /** Entrée d'exemple créée à la première installation, pour que le site ne soit pas vide. */
    sample?: { title: LocalizedString; summary?: LocalizedString; body?: LocalizedString };
    /** L'assistant demande à l'utilisateur ses liens (Twitch, YouTube…) et les range dans ce module. */
    collectsLinks?: boolean;
  };
  /** Modules activés dès le départ (défaut : oui). */
  defaultEnabled?: boolean;
  /** Déclaratif et informatif : affiché à l'administrateur avant activation. */
  permissions: ("slots" | "routes" | "storage" | "filters" | "sections" | "pages" | "topics" | "overlay" | "mcp" | "admin" | "mail" | "rawg")[];
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
  /** Contenu complet en Markdown. */
  body: string;
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
  /** Le visuel de marque principal (symbole, sinon logo horizontal). */
  logo: string | null;
  /** Tous les logos du jeu : `wide` (horizontal), `square` (icône), `wideDark` et `squareDark` (pour fond sombre). */
  logos: { kind: "wide" | "square" | "wideDark" | "squareDark"; src: string }[];
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
     * `from` / `to` (facultatifs) : période demandée, en `Date` ou chaîne ISO 8601 ; `from <= to`, 400 jours au plus ; sinon l'appel LÈVE une erreur.
     * Les fournisseurs les reçoivent en `Date` dans `exports`, et peuvent les ignorer.
     */
    collect(topic: string, opts?: { limit?: number; from?: Date | string; to?: Date | string }): Promise<TopicItem[]>;
    /**
     * Comme `collect`, page par page : `limit` (200 au plus par page) et `cursor` (celui du `next` précédent, opaque, à ne pas fabriquer).
     * `next: null` = fini. Seul `core.entry` est vraiment lu par curseur ; les autres sujets n'ont qu'une page. Un curseur illisible lève une erreur.
     */
    collectPage(topic: string, opts?: { limit?: number; cursor?: string; from?: Date | string; to?: Date | string }): Promise<{ items: TopicItem[]; next: string | null }>;
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
    /** `id` et `adminPath` (« /admin/instances/<id> ») : pour renvoyer l'administrateur vers les réglages d'une instance d'un autre module. */
    list(opts?: { locale?: string; module?: string }): Promise<{ id: string; key: string; module: string; basePath: string | null; name: string; adminPath: string }[]>;
  };
  /** Données structurées (schema.org) pour les moteurs de recherche et les assistants IA. */
  seo: {
    /**
     * Prépare un JSON-LD à renvoyer dans l'emplacement `layout.head` : `{ type: "head", tags: [ctx.api.seo.jsonLd({ "@type": "Event", … })] }`.
     * Le cœur ajoute `@context`, borne la taille et échappe `</script>`. Renvoie `null` si la donnée est inutilisable (pas de `@type`, trop grosse).
     */
    jsonLd(data: Record<string, unknown>): { tag: "script"; jsonLd: Record<string, unknown> } | null;
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
  /** Jaquettes de jeux (RAWG), avec la clé réglée une fois par le propriétaire (nécessite la permission « rawg »). Ne lève jamais ; la clé n'est jamais transmise. */
  rawg: {
    /** Une clé RAWG est-elle réglée (et ce module a-t-il la permission) ? */
    configured(): Promise<boolean>;
    /** Jaquette du jeu `title` : `found` (url https), `none` (aucun résultat), `no-key`, `refused` (RAWG refuse la clé), `unreachable`. */
    cover(title: string): Promise<{ status: "found" | "none" | "no-key" | "refused" | "unreachable"; url: string | null }>;
  };
  /**
   * Client réseau NEUTRE et BORNÉ du cœur (aucune permission à déclarer). À préférer à `fetch` pour toute API externe : délai dur (8 s par défaut,
   * 20 s au plus ; dans une page publique, jamais plus que le temps restant de la page), https seulement, pause automatique après un 429 ou un quota
   * épuisé (les demandes suivantes reçoivent `rate` / `quota` SANS appel réseau jusqu'à `retryAt`), disjoncteur par hôte, déduplication des GET
   * identiques en cours (`shared: true`), file bornée (au-delà : `busy` immédiatement), une seule reprise au plus. Ne lève jamais.
   * Une réponse HTTP reçue donne `ok: true` avec son `status` (à vous de le juger), avec `json` si le corps est du JSON lisible, sinon `text`.
   */
  net: {
    request(req: NetRequest): Promise<NetResult>;
    /** État des hôtes contactés depuis le démarrage : `ok`, `slow`, `rate` / `quota` (jusqu'à `retryAt`), `down`. */
    health(): Promise<NetHealthItem[]>;
    /** Temps restant (ms) de la page publique en cours, ou null hors page publique (tâche, route, administration). */
    budgetMs(): number | null;
  };
  /**
   * Stockage privé de l'instance (messages reçus, compteurs…). Plafonds : `list` 100 par défaut, 10 000 au plus (au-delà, utilisez `page`) ;
   * `page` / `listByKey` 100 par défaut, 1 000 au plus ; `addMany` 5 000 lignes au plus par appel ; `key` 200 caractères au plus.
   */
  store: {
    add(collection: string, data: Record<string, unknown>, opts?: { key?: string | null }): Promise<string>;
    get(id: string): Promise<StoreRecord | null>;
    /** `key` absent = inchangée ; `key: null` l'efface. */
    update(id: string, data: Record<string, unknown>, opts?: { key?: string | null }): Promise<boolean>;
    list(collection: string, opts?: { limit?: number }): Promise<StoreRecord[]>;
    /** Lecture par pages (curseur opaque `(createdAt, id)` : ni doublon ni trou, même si des lignes arrivent entre deux pages). `next` = null à la dernière page. */
    page(collection: string, opts?: { limit?: number; cursor?: string | null; order?: "desc" | "asc"; key?: string }): Promise<StorePage>;
    /** L'enregistrement le plus ancien portant cette clé (la clé n'est pas unique). */
    getByKey(collection: string, key: string): Promise<StoreRecord | null>;
    listByKey(collection: string, key: string, opts?: { limit?: number; cursor?: string | null }): Promise<StorePage>;
    /** Ajoute jusqu'à 5 000 lignes en une transaction (tout ou rien) ; renvoie les identifiants dans l'ordre. */
    addMany(collection: string, rows: { data: Record<string, unknown>; key?: string | null }[]): Promise<string[]>;
    /** Compteur propre à l'instance, augmenté par le cœur quand ses données sont remplacées de l'extérieur (restauration, annulation de migration, reprise de données gardées). Sert à invalider un index gardé en mémoire. */
    generation(): Promise<number>;
    remove(id: string): Promise<void>;
    count(collection: string): Promise<number>;
  };
  /** Appel d'un service offert par un autre module (voir `requires` / `offers`). Ne lève jamais. */
  services: {
    /** Y a-t-il un fournisseur actif de ce service ? */
    available(service: string): Promise<boolean>;
    /** Appelle `method` du service sur le fournisseur qui répond (le maître ; pour un service `each`, la première instance par ordre de création). Le service doit être déclaré dans `requires` du manifeste. */
    call(service: string, method: string, args?: unknown): Promise<{ ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" }>;
    /**
     * Appelle `method` sur TOUTES les instances actives d'un service offert avec `each: true` (chaque instance répond pour elle-même : plusieurs chaînes,
     * plusieurs comptes…), par ordre de création. Une entrée par instance ; `instance` = sa clé, `name` = son surnom lisible. Un fournisseur qui échoue
     * donne `{ ok: false, error }` (code court, jamais le message du fournisseur) sans gêner les autres. Service non-each : UNE entrée, la réponse du
     * maître (comme `call`). Service non déclaré dans `requires` ou sans fournisseur actif : `[]`. Ne lève jamais.
     */
    callAll(service: string, method: string, args?: unknown): Promise<Array<{ instance: string; name?: string; ok: true; value: unknown } | { instance: string; name?: string; ok: false; error: string }>>;
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
  /**
   * Présent UNIQUEMENT pendant une migration de données (`migrations[N]`) ; refuse tout module non déclaré dans `seeds`. Crée UNE instance d'un module cible déclaré
   * (réglages initiaux validés par son manifeste, secrets compris), une seule fois par `seedKey`, sans jamais écraser une instance existante.
   * Renvoie `{ created, instanceKey }` (`created: false` : déjà semée plus tôt). Lève une erreur si la graine est refusée : la migration échoue alors
   * entièrement (instance mise à l'écart, « Réessayer »), et tout ce qu'elle a créé est défait.
   */
  seedInstance?(targetModuleId: string, request: SeedRequest): Promise<SeedResult>;
  /**
   * Présent UNIQUEMENT pendant une migration de données : efface un réglage de CETTE instance (déclaré dans `settings` du manifeste du module, dans toutes les
   * langues). Refusé tant qu'aucun `seedInstance` n'a abouti dans cette migration ; si la migration échoue, le réglage est remis comme avant.
   */
  clearSetting?(key: string): Promise<void>;
  /** Le thème réglé dans l'admin (couleurs dérivées, police) : exactement ce que le site utilise. Pour que l'apparence d'un module suive le site. */
  theme: Theme;
  /**
   * Visite en cours. `lastVisit` = date du passage précédent du visiteur, tenue par le cœur dans un cookie (le 1er janvier 1970 s'il est inconnu).
   * Sert à savoir ce qui est nouveau pour lui, cf. `news`.
   */
  visit: { lastVisit: Date };
  /** Traduction depuis locales/<langue>.json du module (repli : langue par défaut puis clé). */
  t(key: string, vars?: Record<string, string | number>): string;
  api: ModuleApi;
  /**
   * (0.2.0) La personne qui regarde l'administration a-t-elle ce droit du module (identifiant LOCAL : « email.view », préfixé « <module>: » par le cœur) ?
   * Vrai seulement dans un contexte d'administration d'un humain (`adminPanel`, `adminActions`, `entryPanels`) ; toujours faux ailleurs (page publique,
   * route, overlay OBS, tâche, service, MCP). Absent sur un cœur plus ancien : traitez l'absence comme un refus.
   */
  can?(rightId: string): boolean;
};

export type SlotContext = ModuleContext & {
  /** Présent pour page.* et entry.* : l'instance dont on affiche la page (pas forcément celle du module). */
  page?: { key: string; basePath: string | null };
  /** Présent pour entry.* */
  entry?: { id: string; title: string; slug: string };
};

export type RouteHandler = (request: Request, ctx: ModuleContext) => Response | Promise<Response>;

export type TopicQuery = { locale: string; limit: number; tags: string[]; from?: Date; to?: Date };

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
  /**
   * Y a-t-il du nouveau dans cette instance depuis la dernière visite (`ctx.visit.lastVisit`) ? Le cœur affiche alors une pastille sur son lien
   * du menu. Absent = règle du cœur : des entrées publiées depuis cette date. Libre au module de compter autre chose (un message, un score…).
   * Un visiteur inconnu (1970) n'a rien manqué : le cœur n'affiche alors aucune pastille.
   */
  news?: (ctx: ModuleContext) => boolean | Promise<boolean>;
  /**
   * Pastille du menu d'admin : nombre d'éléments qui attendent l'équipe dans cette instance (messages à lire, fiches à vérifier…). 0 = pas de pastille.
   * Appelée à chaque affichage de l'admin : restez rapide. Une erreur n'affiche simplement pas de pastille.
   */
  adminBadge?: (ctx: ModuleContext) => number | Promise<number>;
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
  /**
   * Forme fonction : réservée aux administrateurs (comme avant). Forme objet (0.2.0) : `{ right: "phone.edit", run }` : le cœur vérifie `<module>:open`
   * ET ce droit (préfixé par le cœur) AVANT d'appeler `run` ; une personne d'un rôle personnalisé qui a ces droits peut alors l'exécuter.
   */
  adminActions?: Record<string, AdminActionHandler | AdminActionSpec>;
  /**
   * Sections ajoutées à l'éditeur d'entrée d'un autre module, par `id` (déclarées dans `entryPanels` du manifeste). `render` renvoie les blocs de la section pour CETTE entrée ;
   * `actions` : ce que ses blocs `adminForm` et boutons de ligne déclenchent (enregistrées sans quitter la page). Mêmes rôles que l'éditeur d'entrée (éditeur et plus).
   * Les données restent chez le module qui fournit la section (sa clé : `entry.id`) ; le module hôte n'en sait rien.
   */
  entryPanels?: Record<string, EntryPanel>;
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
  /**
   * Services offerts aux autres modules (déclarés dans `offers` du manifeste) : `services["contact.store"].add(ctx, args)`. `ctx` est celui de
   * l'instance qui FOURNIT le service. Un module qui `requires` ce service l'appelle par `ctx.api.services.call(…)`.
   */
  services?: Record<string, Record<string, (ctx: ModuleContext, args: unknown) => unknown | Promise<unknown>>>;
  hooks?: {
    onInstanceCreate?(ctx: ModuleContext): void | Promise<void>;
    onInstanceDelete?(ctx: ModuleContext): void | Promise<void>;
  };
};

/** L'entrée dont on édite la fiche, telle que le cœur la décrit à un module qui ajoute une section à l'éditeur (jamais lue du navigateur : le cœur la relit à chaque appel). */
export type EntryPanelTarget = {
  id: string;
  title: string;
  slug: string;
  /** Adresse publique de l'entrée (« /sponsors/mon-sponsor »). */
  path: string;
  /** Clé de l'instance qui contient l'entrée. */
  instance: string;
  /** L'entrée est-elle publiée ? (brouillon, programmée ou expirée : non) */
  published: boolean;
};
/** Qui regarde la fiche : mode avancé et rôle (« owner », « admin » ou « editor » ; une personne d'un rôle personnalisé qui modifie les contenus vaut « editor »). Pour un droit précis, utilisez `ctx.can`. */
export type EntryPanelView = { advanced: boolean; role: "owner" | "admin" | "editor" };
export type EntryPanelActionHandler = (ctx: ModuleContext, entry: EntryPanelTarget, values: Record<string, string>) => AdminActionResult | Promise<AdminActionResult>;
export type EntryPanel = {
  /**
   * `view.advanced` : la personne a choisi le mode avancé (options de technicien seulement dans ce cas). `view.role` : son rôle (un éditeur n'ouvre pas les pages d'administration
   * des modules : ne lui proposez pas de lien vers elles). Rendre `[]` masque la section.
   */
  render(ctx: ModuleContext, entry: EntryPanelTarget, view: EntryPanelView): Block[] | Promise<Block[]>;
  actions?: Record<string, EntryPanelActionHandler>;
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
/** `grid` : réponse d'une action de génération du bloc `gridEditor` (`generateAction`) — un tracé proposé, jamais enregistré par le cœur. */
export type AdminActionResult = { ok?: string; error?: string; redirect?: string; grid?: { width: number; height: number; cells: string } };
export type AdminActionHandler = (ctx: ModuleContext, values: Record<string, string>) => AdminActionResult | Promise<AdminActionResult>;
/** Action d'admin protégée par un droit du module (identifiant local, ou « <ce module>:<id> » ; le droit d'un autre module est toujours refusé). */
export type AdminActionSpec = { right: string; run: AdminActionHandler };

/** Aide de typage : `export default defineModule({...})`. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

export function localized(value: LocalizedString | undefined, locale: string, defaultLocale: string): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value[defaultLocale] ?? value.en ?? Object.values(value)[0] ?? "";
}

/** Autorisation de semer : le module cible, et pourquoi (affiché à l'administrateur). */
export type SeedDecl = { module: string; reason: LocalizedString };
