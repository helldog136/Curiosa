import { z } from "zod";
import { MODULE_API_VERSION } from "../config";
import { COLOR_TOKENS } from "../color";
import { groupIssues } from "./groups";
import { siteDefaultRef } from "./settingValues";
import { PLATFORM_PATTERN } from "./platform";
import { MAX_MODULE_RIGHTS, OPEN, RIGHT_ID_RE } from "../auth/rights";
import { SERVICE_RE } from "./serviceVersions";
import { NO_CREATE_REFERS, REFERS_TO } from "./choiceValues";
import { MAX_TAB_ENTRIES, TAB_ID_RE, TAB_LABEL_MAX, tabIssues } from "./tabs";

const localized = z.union([z.string().max(500), z.record(z.string(), z.string().max(500))]);
const methodName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/);
/** Source des options d'un réglage `choice` (cœur 0.2.0 ; un cœur plus ancien refuse `type: "choice"` : d'où `minCore: "0.2.0"`). */
const choiceSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("providers"), service: z.string().regex(SERVICE_RE), min: z.number().int().min(1).max(1000).optional() }),
  z.object({ kind: z.literal("service"), service: z.string().regex(SERVICE_RE), list: methodName, get: methodName, create: methodName.optional() }),
]);

export const settingField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  label: localized,
  type: z.enum(["text", "textarea", "url", "link", "number", "boolean", "select", "color", "secret", "image", "video", "choice"]),
  help: localized.optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: localized })).max(50).optional(),
  translatable: z.boolean().optional(),
  advanced: z.boolean().optional(),
  /** Réglage facultatif : le laisser vide ne met pas l'extension « à configurer » (sinon, un texte, une adresse ou un secret vide sans valeur par défaut est à remplir). */
  optional: z.boolean().optional(),
  /** « appearance » : réglage d'apparence du module (couleurs, textures…), regroupé à part dans l'admin. */
  group: z.enum(["appearance"]).optional(),
  /** `choice` (0.2.0) : d'où viennent les options (obligatoire pour ce type, interdit ailleurs). */
  source: choiceSource.optional(),
  /** `choice` de source `service` avec `create` : création à la volée par le module propriétaire de la donnée. */
  allowCreate: z.boolean().optional(),
  /** `choice` qui remplace un ancien réglage texte de même clé. */
  fromText: z.boolean().optional(),
  /** Ce que désigne le réglage (règle de kit) ; un cœur ancien ignore la clé. */
  refersTo: z.enum(REFERS_TO).optional(),
  /** (0.2.2) Onglet de la page d'admin où s'affiche ce réglage : « settings » (défaut), « sources », « general » ou l'id d'un onglet de `tabs`. Un cœur ancien ignore la clé. */
  tab: z.string().regex(TAB_ID_RE).optional(),
}).superRefine((f, ctx) => {
  // Réglage « choix parmi » : une source, ni défaut ni traduction (la valeur est un identifiant), création seulement par le service propriétaire.
  if (f.type === "choice") {
    if (!f.source) ctx.addIssue({ code: "custom", message: "a choice setting needs a source ({ kind: \"providers\" | \"service\", … })" });
    if (f.default !== undefined) ctx.addIssue({ code: "custom", message: "a choice setting cannot have a default (with a single option, the core uses it without storing it)" });
    if (f.translatable) ctx.addIssue({ code: "custom", message: "a choice setting cannot be translatable" });
    if (f.allowCreate) {
      if (f.source?.kind !== "service" || !f.source.create) ctx.addIssue({ code: "custom", message: "allowCreate needs a source of kind \"service\" with a create method" });
      if (f.refersTo && (NO_CREATE_REFERS as readonly string[]).includes(f.refersTo)) ctx.addIssue({ code: "custom", message: `allowCreate is not allowed for a setting that refers to a ${f.refersTo}` });
    }
  } else {
    for (const k of ["source", "allowCreate", "fromText"] as const) if (f[k] !== undefined) ctx.addIssue({ code: "custom", message: `${k} is only for a choice setting` });
  }
  // Une couleur peut suivre le thème du site : default "theme:<jeton>". Rien d'autre n'est permis comme référence.
  if (typeof f.default === "string" && f.default.startsWith("theme:")) {
    if (f.type !== "color") ctx.addIssue({ code: "custom", message: "only a color setting can default to a theme token" });
    else if (!(COLOR_TOKENS as readonly string[]).includes(f.default.slice(6))) ctx.addIssue({ code: "custom", message: `unknown theme token "${f.default.slice(6)}"` });
  }
  // Un texte peut suivre le site : default "site:name" ou "site:tagline" (seulement pour text / textarea).
  if (typeof f.default === "string" && f.default.startsWith("site:")) {
    if (f.type !== "text" && f.type !== "textarea") ctx.addIssue({ code: "custom", message: "only a text or textarea setting can default to a site value" });
    else if (!siteDefaultRef(f.default)) ctx.addIssue({ code: "custom", message: `unknown site value "${f.default.slice(5)}" (use site:name or site:tagline)` });
  }
});

const topicField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/),
  type: z.enum(["string", "url", "number", "boolean", "string[]", "datetime"]),
  required: z.boolean().optional(),
});
const topicId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/);
const serviceVersion = z.number().int().min(1).max(1000);

const jsonSchemaLite = z.object({
  type: z.literal("object"),
  properties: z
    .record(
      z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
      z.object({
        type: z.enum(["string", "number", "integer", "boolean", "array"]),
        description: z.string().max(500).optional(),
        enum: z.array(z.string()).max(50).optional(),
        maxLength: z.number().int().max(20000).optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        items: z.object({ type: z.literal("string") }).optional(),
      }),
    )
    .optional(),
  required: z.array(z.string()).optional(),
});

const content = z.object({
  display: z.enum(["cards", "list", "links", "codes"]),
  clickAction: z.enum(["detail", "external"]),
  features: z.array(z.enum(["cover", "icon", "summary", "body", "url", "code", "expiresAt", "featured", "tags"])).max(9),
  fieldSchema: z
    .array(z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/), label: z.string().max(100), type: z.enum(["text", "url", "number", "boolean", "ref"]), topic: topicId.optional() }))
    .max(20)
    .optional(),
  allowGoLinks: z.boolean().optional(),
  fallbackToDefault: z.boolean().optional(),
  basePath: z.string().regex(/^[a-z0-9-]*$/).optional(),
  showInNav: z.boolean().optional(),
});

/** Nom d'onglet : court (limite dure ; le kit conseille moins), en français ET en anglais de préférence. */
const tabLabel = z.union([
  z.string().trim().min(1).max(TAB_LABEL_MAX),
  z.record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), z.string().trim().min(1).max(TAB_LABEL_MAX)).refine((r) => { const n = Object.keys(r).length; return n >= 1 && n <= 12; }, "a tab label needs 1 to 12 languages"),
]);

export const manifestSchema = z.object({
  apiVersion: z.number().int(),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: localized,
  version: z.string().regex(/^\d+\.\d+\.\d+([-+][\w.]+)?$/),
  /**
   * Version MINIMALE du cœur qui fait fonctionner ce module (« 0.1.10 », rien d'autre : pas de pré-version). Absent = aucune exigence. Vérifié à l'installation
   * et à la mise à jour (jamais à l'exécution : un module déjà installé n'est pas désactivé pour cela). Voir compat.ts. (Pas `requires` : ce nom désigne déjà les services.)
   */
  minCore: z.string().regex(/^\d+\.\d+\.\d+$/, "minCore must be a plain version like 0.1.10 (X.Y.Z, numbers only)").optional(),
  description: localized.optional(),
  author: z.string().max(200).optional(),
  homepage: z.string().url().optional(),
  /** Ce que le module collecte comme données personnelles et pourquoi : repris tel quel dans la page de confidentialité du site (voir core/privacy.ts). */
  privacy: localized.optional(),
  license: z.string().max(60).optional(),
  main: z
    .string()
    .regex(/^[\w./-]+\.(mjs|js)$/)
    .refine((p) => !p.includes("..") && !p.startsWith("/"), "main must stay inside the module")
    .optional(),
  icon: z.string().max(8).optional(),
  type: z.enum(["content", "social", "overlay", "widget", "integration", "utility"]).optional(),
  /**
   * Plateforme concernée (« twitch », « discord », « youtube »…), facultative : l'admin regroupe sous une même plateforme les instances qui la partagent (Intégrations, liste des modules).
   * Purement visuel, aucune dépendance. Absent = aucune plateforme. Un ancien cœur ignore ce champ. Voir platform.ts.
   */
  platform: z.string().regex(PLATFORM_PATTERN, "platform must be a lowercase identifier like twitch or discord (a-z, 0-9 and dashes, 31 characters at most, starting with a letter)").optional(),
  instances: z.enum(["single", "multiple"]).default("multiple"),
  consumes: z.array(z.object({ topic: topicId, label: localized, schema: z.array(topicField).max(20).optional(), tags: z.boolean().optional() })).max(10).default([]),
  provides: z.array(z.object({ topic: topicId, label: localized.optional() })).max(10).default([]),
  /**
   * DÉPENDANCES ENTRE MODULES. Un module `offers` un SERVICE (un nom, comme `contact.store`) que d'autres peuvent appeler ; un module qui
   * `requires` un service ne peut être activé que si un module qui l'offre est actif (installé et activé
   * automatiquement). On dépend d'un service, jamais d'un module précis : n'importe quel module qui l'offre convient.
   */
  offers: z.array(z.object({ service: topicId, label: localized.optional(), /** Version de l'interface du service (entier ≥ 1, défaut 1) : à augmenter quand le service gagne une capacité. */ version: serviceVersion.optional(), /** Méthodes qui ne font que lire : elles ne sont pas répliquées sur les fournisseurs secondaires. */ readOnly: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/)).max(20).optional(), /** « Chaque instance de ce module répond pour elle-même » (ex. une chaîne par instance) : pas de maître à choisir, `ctx.api.services.callAll` les interroge toutes. Défaut : false. */ each: z.boolean().optional(), /** Méthodes (écritures) qui acceptent les droits de la personne connectée quand un autre module les appelle depuis une de SES actions d'administration avec `{ asCaller: true }` (cœur 0.2.4 ; un cœur plus ancien ignore la clé et le fournisseur répond « denied »). Le fournisseur vérifie lui-même le droit (`ctx.can`). */ callerRights: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/)).max(10).optional() })).max(10).optional(),
  requires: z.array(z.object({ service: topicId, label: localized.optional(), /** Version minimale du service exigée (entier ≥ 1, défaut 1). */ min: serviceVersion.optional(), /** Besoin FACULTATIF (cœur 0.2.0) : le module fonctionne sans, en mieux avec ; jamais installé d'office, n'empêche ni l'installation ni la désinstallation du fournisseur. Un cœur ancien ignore la clé (besoin dur). */ optional: z.boolean().optional() })).max(10).optional(),
  /**
   * SECTIONS AJOUTÉES À L'ÉDITEUR D'ENTRÉE D'UN AUTRE MODULE (voir entryPanels.ts). `for` désigne les entrées concernées SANS nommer un module précis : un sujet
   * (`topic` : toute instance dont le module le fournit via `provides`) ou, à défaut, un module (`module`). La section n'apparaît que si ce module est installé et actif.
   */
  entryPanels: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
    for: z.object({ topic: topicId.optional(), module: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional() }).refine((f) => Number(!!f.topic) + Number(!!f.module) === 1, "for needs exactly one of topic or module"),
    title: localized,
    help: localized.optional(),
  })).max(5).optional(),
  mcp: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), description: z.string().max(1000), readOnly: z.boolean().optional(), default: z.boolean().optional(), destructive: z.boolean().optional(), input: jsonSchemaLite.optional() }).refine((a) => !a.destructive || a.default !== true, "a destructive action cannot be enabled by default").refine((a) => !(a.readOnly && a.destructive), "a read-only action cannot be destructive")).max(60).optional(),
  content: content.optional(),
  page: z.boolean().optional(),
  /** (prochaine version) « Je suggère d'être au menu du site » : la page de l'instance est proposée à la personne dans « Pages qui ne sont pas dans le menu », jamais ajoutée d'office. Défaut : `content.showInNav`, sinon non. Un cœur ancien ignore la clé. */
  suggestInMenu: z.boolean().optional(),
  basePath: z.string().regex(/^[a-z0-9-]*$/).optional(),
  sections: z
    .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), label: localized, options: z.array(settingField).max(10).optional(), size: z.enum(["small", "medium", "large", "full"]).optional() }))
    .max(20)
    .default([]),
  settings: z.array(settingField).max(60).default([]),
  /**
   * (0.2.2) Onglets de la page d'admin d'une instance (voir core/modules/tabs.ts). Absent : les quatre onglets par défaut (Utiliser · Réglages · Sources · Général).
   * Une entrée AJOUTE un onglet (`{ id, label }`), RENOMME un onglet par défaut (`{ id: "use", label }`) ou en RETIRE un (`{ id: "use", hidden: true }` : son contenu
   * rejoint un autre onglet, rien n'est perdu). Un cœur ancien ignore la clé : déclarez `minCore: "0.2.2"`.
   */
  tabs: z.array(z.object({ id: z.string().regex(TAB_ID_RE), label: tabLabel.optional(), hidden: z.literal(true).optional(), panel: z.literal(true).optional() }).strict()).max(MAX_TAB_ENTRIES).optional(),
  /** Réglages facultatifs regroupés derrière un bouton « Ajouter… » (voir `groupIssues` pour les règles). */
  optionalGroups: z
    .array(z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
      label: localized,
      addLabel: localized,
      removeLabel: localized.optional(),
      fields: z.array(z.string()).min(1).max(20),
      required: z.array(z.string()).max(20).optional(),
    }))
    .max(6)
    .optional(),
  /**
   * GRAINES : modules dans lesquels une MIGRATION DE DONNÉES de ce module pourra créer UNE instance (`ctx.seedInstance`), une seule fois, avec des réglages initiaux.
   * Déclaration explicite (affichée à l'administrateur) ; le cœur exige en plus que le module cible soit relié à celui-ci : il offre un service que celui-ci `requires`, ou il fournit
   * un sujet que celui-ci `consumes` (lien souple : aucune dépendance, le module semeur fonctionne sans la cible). Voir seeding.ts.
   */
  seeds: z.array(z.object({ module: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/), reason: localized })).max(3).optional(),
  /** Version de la STRUCTURE des données du module (stockage, réglages). À augmenter quand elle change : voir `migrations`. */
  dataVersion: z.number().int().min(1).max(10000).optional(),
  /**
   * (0.2.0) Plus petite version des données que cette version du module sait encore convertir. Une instance plus ancienne est mise à l'écart
   * (« passez d'abord par une version intermédiaire ») au lieu d'être déclarée à jour. ≤ dataVersion. Un cœur ancien ignore la clé.
   */
  dataFloor: z.number().int().min(1).max(10000).optional(),
  /**
   * (0.2.0) Réglages qu'une version précédente déclarait et que le module reprend lui-même (`ctx.legacy`). JAMAIS affichés, même en mode avancé ;
   * `secret` : la valeur ne doit jamais sortir de la mémoire. Une clé ici n'est pas dans `settings`. Un cœur ancien ignore la clé.
   */
  legacySettings: z.array(z.object({ key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/), secret: z.boolean().optional() })).max(20).optional(),
  /** (0.2.0) Collections du stockage qu'une version précédente remplissait et que le module vide après reprise : comptées par le rapport d'entretien, jamais lues par le cœur. */
  legacyCollections: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,60}$/)).max(10).optional(),
  onboarding: z
    .object({
      home: z.object({ section: z.string(), count: z.number().int().min(1).max(50).optional() }).optional(),
      sample: z.object({ title: localized, summary: localized.optional(), body: localized.optional() }).optional(),
      collectsLinks: z.boolean().optional(),
    })
    .optional(),
  defaultEnabled: z.boolean().optional(),
  permissions: z.array(z.enum(["slots", "routes", "storage", "filters", "sections", "pages", "topics", "overlay", "mcp", "admin", "mail", "rawg", "privacy", "visitor.geolocation"])).default([]),
  /**
   * Droits du module (0.2.0), proposés dans les rôles de la page Équipe. Identifiant LOCAL (« email.view ») : le cœur le préfixe par l'identifiant du module
   * (« <module>:email.view »), un module ne peut donc pas déclarer le droit d'un autre. `open` (ouvrir la page d'admin du module) est implicite.
   * `default` : ce que reçoivent les rôles prédéfinis (administrateur : oui sauf `admin: false` ; éditeur : non sauf `editor: true`). Un cœur ancien ignore cette clé.
   */
  rights: z.array(z.object({
    id: z.string().regex(RIGHT_ID_RE, "right id must be lowercase segments like email.view (no colon: the core adds the module prefix)").refine((id) => id !== OPEN, "open is implicit: do not declare it"),
    label: localized,
    help: localized.optional(),
    sensitive: z.boolean().optional(),
    default: z.object({ admin: z.boolean().optional(), editor: z.boolean().optional() }).optional(),
  })).max(MAX_MODULE_RIGHTS).optional(),
}).superRefine((m, ctx) => {
  if (new Set((m.rights ?? []).map((r) => r.id)).size < (m.rights ?? []).length) ctx.addIssue({ code: "custom", path: ["rights"], message: "duplicate right id" });
  for (const [i, seed] of (m.seeds ?? []).entries()) {
    if (seed.module === m.id) ctx.addIssue({ code: "custom", path: ["seeds", i, "module"], message: "a module cannot seed itself" });
    if (!m.requires?.length && !m.consumes.length) ctx.addIssue({ code: "custom", path: ["seeds", i, "module"], message: "seeds needs a matching `requires` or `consumes` (the target must offer a service this module requires, or provide a topic this module consumes)" });
  }
  if (new Set((m.seeds ?? []).map((x) => x.module)).size < (m.seeds ?? []).length) ctx.addIssue({ code: "custom", path: ["seeds"], message: "duplicate seed target" });
  for (const message of groupIssues(m.optionalGroups ?? [], m.settings)) ctx.addIssue({ code: "custom", path: ["optionalGroups"], message });
  // Héritage (0.2.0) : une clé reprise n'est pas un réglage affiché ; plancher ≤ version des données.
  const declared = new Set(m.settings.map((f) => f.key));
  const legacy = m.legacySettings ?? [];
  for (const [i, l] of legacy.entries()) if (declared.has(l.key)) ctx.addIssue({ code: "custom", path: ["legacySettings", i, "key"], message: `"${l.key}" is both a setting and a legacy setting` });
  if (new Set(legacy.map((l) => l.key)).size < legacy.length) ctx.addIssue({ code: "custom", path: ["legacySettings"], message: "duplicate legacy setting" });
  if (m.dataFloor !== undefined && m.dataFloor > (m.dataVersion ?? 1)) ctx.addIssue({ code: "custom", path: ["dataFloor"], message: "dataFloor must be ≤ dataVersion" });
  // Un `choice` interroge le service AU NOM de l'instance : le service doit être déclaré dans `requires` (sinon le cœur ne peut pas l'appeler).
  const required = new Set((m.requires ?? []).map((r) => r.service));
  for (const [i, f] of m.settings.entries()) {
    if (f.type === "choice" && f.source && !required.has(f.source.service)) ctx.addIssue({ code: "custom", path: ["settings", i, "source", "service"], message: `the choice source "${f.source.service}" must be declared in requires` });
  }
  for (const message of tabIssues(m.tabs, m.settings, m.optionalGroups ?? [])) ctx.addIssue({ code: "custom", path: ["tabs"], message });
  for (const [i, sec] of m.sections.entries()) {
    for (const [j, o] of (sec.options ?? []).entries()) if (o.tab !== undefined) ctx.addIssue({ code: "custom", path: ["sections", i, "options", j, "tab"], message: "tab is only for instance settings, not for section options" });
    for (const [j, o] of (sec.options ?? []).entries()) if (o.type === "choice") ctx.addIssue({ code: "custom", path: ["sections", i, "options", j, "type"], message: "a choice is only for instance settings, not for section options" });
  }
});

export type ParsedManifest = z.infer<typeof manifestSchema>;

/** Catégorie effective d'un module. */
export function effectiveType(m: Pick<ParsedManifest, "type" | "content">): NonNullable<ParsedManifest["type"]> {
  return m.type ?? (m.content ? "content" : "widget");
}

/** Une instance de ce module a-t-elle une page publique ? */
export function hasPage(m: Pick<ParsedManifest, "page" | "content" | "type">): boolean {
  return m.page ?? (!!m.content && m.type !== "overlay");
}

export function parseManifest(raw: unknown): { ok: true; manifest: ParsedManifest } | { ok: false; error: string } {
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `module.json: ${issue?.path.join(".") || "root"} — ${issue?.message ?? "invalid"}` };
  }
  if (result.data.apiVersion !== MODULE_API_VERSION) {
    return {
      ok: false,
      error: `module.json: apiVersion ${result.data.apiVersion} is not supported (core speaks ${MODULE_API_VERSION})`,
    };
  }
  return { ok: true, manifest: result.data };
}
