import { z } from "zod";
import { MODULE_API_VERSION } from "../config";
import { COLOR_TOKENS } from "../color";
import { groupIssues } from "./groups";
import { siteDefaultRef } from "./settingValues";
import { PLATFORM_PATTERN } from "./platform";

const localized = z.union([z.string().max(500), z.record(z.string(), z.string().max(500))]);

export const settingField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  label: localized,
  type: z.enum(["text", "textarea", "url", "link", "number", "boolean", "select", "color", "secret", "image", "video"]),
  help: localized.optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: localized })).max(50).optional(),
  translatable: z.boolean().optional(),
  advanced: z.boolean().optional(),
  /** Réglage facultatif : le laisser vide ne met pas l'extension « à configurer » (sinon, un texte, une adresse ou un secret vide sans valeur par défaut est à remplir). */
  optional: z.boolean().optional(),
  /** « appearance » : réglage d'apparence du module (couleurs, textures…), regroupé à part dans l'admin. */
  group: z.enum(["appearance"]).optional(),
}).superRefine((f, ctx) => {
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
  offers: z.array(z.object({ service: topicId, label: localized.optional(), /** Version de l'interface du service (entier ≥ 1, défaut 1) : à augmenter quand le service gagne une capacité. */ version: serviceVersion.optional(), /** Méthodes qui ne font que lire : elles ne sont pas répliquées sur les fournisseurs secondaires. */ readOnly: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/)).max(20).optional(), /** « Chaque instance de ce module répond pour elle-même » (ex. une chaîne par instance) : pas de maître à choisir, `ctx.api.services.callAll` les interroge toutes. Défaut : false. */ each: z.boolean().optional() })).max(10).optional(),
  requires: z.array(z.object({ service: topicId, label: localized.optional(), /** Version minimale du service exigée (entier ≥ 1, défaut 1). */ min: serviceVersion.optional() })).max(10).optional(),
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
  basePath: z.string().regex(/^[a-z0-9-]*$/).optional(),
  sections: z
    .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), label: localized, options: z.array(settingField).max(10).optional(), size: z.enum(["small", "medium", "large", "full"]).optional() }))
    .max(20)
    .default([]),
  settings: z.array(settingField).max(60).default([]),
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
  onboarding: z
    .object({
      home: z.object({ section: z.string(), count: z.number().int().min(1).max(50).optional() }).optional(),
      sample: z.object({ title: localized, summary: localized.optional(), body: localized.optional() }).optional(),
      collectsLinks: z.boolean().optional(),
    })
    .optional(),
  defaultEnabled: z.boolean().optional(),
  permissions: z.array(z.enum(["slots", "routes", "storage", "filters", "sections", "pages", "topics", "overlay", "mcp", "admin", "mail", "rawg"])).default([]),
}).superRefine((m, ctx) => {
  for (const [i, seed] of (m.seeds ?? []).entries()) {
    if (seed.module === m.id) ctx.addIssue({ code: "custom", path: ["seeds", i, "module"], message: "a module cannot seed itself" });
    if (!m.requires?.length && !m.consumes.length) ctx.addIssue({ code: "custom", path: ["seeds", i, "module"], message: "seeds needs a matching `requires` or `consumes` (the target must offer a service this module requires, or provide a topic this module consumes)" });
  }
  if (new Set((m.seeds ?? []).map((x) => x.module)).size < (m.seeds ?? []).length) ctx.addIssue({ code: "custom", path: ["seeds"], message: "duplicate seed target" });
  for (const message of groupIssues(m.optionalGroups ?? [], m.settings)) ctx.addIssue({ code: "custom", path: ["optionalGroups"], message });
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
