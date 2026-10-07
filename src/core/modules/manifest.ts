import { z } from "zod";
import { MODULE_API_VERSION } from "../config";

const localized = z.union([z.string().max(500), z.record(z.string(), z.string().max(500))]);

export const settingField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  label: localized,
  type: z.enum(["text", "textarea", "url", "number", "boolean", "select", "color", "secret", "image"]),
  help: localized.optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: localized })).max(50).optional(),
  translatable: z.boolean().optional(),
  advanced: z.boolean().optional(),
});

const topicField = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/),
  type: z.enum(["string", "url", "number", "boolean", "string[]"]),
  required: z.boolean().optional(),
});
const topicId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/);

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
  description: localized.optional(),
  author: z.string().max(200).optional(),
  homepage: z.string().url().optional(),
  license: z.string().max(60).optional(),
  main: z
    .string()
    .regex(/^[\w./-]+\.(mjs|js)$/)
    .refine((p) => !p.includes("..") && !p.startsWith("/"), "main must stay inside the module")
    .optional(),
  icon: z.string().max(8).optional(),
  type: z.enum(["content", "overlay", "widget", "integration", "utility"]).optional(),
  instances: z.enum(["single", "multiple"]).default("multiple"),
  consumes: z.array(z.object({ topic: topicId, label: localized, schema: z.array(topicField).max(20).optional(), tags: z.boolean().optional() })).max(10).default([]),
  provides: z.array(z.object({ topic: topicId, label: localized.optional() })).max(10).default([]),
  mcp: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), description: z.string().max(1000), readOnly: z.boolean().optional(), input: jsonSchemaLite.optional() })).max(40).optional(),
  content: content.optional(),
  page: z.boolean().optional(),
  sections: z
    .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), label: localized, options: z.array(settingField).max(10).optional() }))
    .max(20)
    .default([]),
  settings: z.array(settingField).max(60).default([]),
  starter: z.boolean().optional(),
  defaultEnabled: z.boolean().optional(),
  permissions: z.array(z.enum(["slots", "routes", "storage", "filters", "sections", "pages", "topics", "overlay", "mcp", "admin"])).default([]),
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
