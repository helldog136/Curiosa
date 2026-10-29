/**
 * Manifeste d'un skin (`skin.json`, docs/SKINS.md §5.2) : schéma zod et lecture. PUR (aucun accès aux fichiers, à la base ou au réseau).
 *
 * Ce schéma contrôle la FORME. Ce qui demande de lire d'autres fichiers (ressources, licences, jetons, feuille, lisibilité) est dans `validate.ts`.
 * Une clé inconnue n'est jamais une erreur (un contrat qui s'enrichit ne casse pas les skins déjà écrits) : elle est ignorée avec un avertissement.
 */
import { z } from "zod";
import { SKIN_ID_RE } from "./allowlist";
import { HEADER_LAYOUTS, SKIN_CONTRACT, TAG_VOCABULARY } from "./constants";
import { makeIssue, type SkinIssue } from "./messages";
import { SEMVER_RE } from "./semver";

const localized = (max: number) => z.object({ fr: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) });
const OPTION_ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
const TOKEN_NAME_RE = /^--(sk|v)-[a-z0-9][a-z0-9-]{0,60}$/;

const asset = z.object({
  file: z.string().min(1).max(100),
  kind: z.enum(["font", "image"]),
  license: z.string().max(40).optional(),
  licenseFile: z.string().max(100).optional(),
  author: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(300).optional(),
  family: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$/).optional(),
  weight: z.string().regex(/^(\d{3}( \d{3})?|normal|bold)$/).optional(),
  style: z.enum(["normal", "italic"]).optional(),
});

const optionValue = z.object({
  id: z.string().regex(OPTION_ID_RE),
  label: localized(40),
  tokens: z.record(z.string().regex(TOKEN_NAME_RE), z.string().max(300)).refine((t) => Object.keys(t).length <= 40, "too many tokens"),
});
const option = z.object({
  id: z.string().regex(OPTION_ID_RE),
  label: localized(40),
  default: z.string().regex(OPTION_ID_RE),
  values: z.array(optionValue).min(2).max(8),
}).superRefine((o, ctx) => {
  const ids = o.values.map((v) => v.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate value id", path: ["values"] });
  if (!ids.includes(o.default)) ctx.addIssue({ code: "custom", message: "default is not one of the values", path: ["default"] });
});

const preview = z.object({
  file: z.string().min(1).max(100),
  mode: z.enum(["light", "dark"]).optional(),
  width: z.number().int().min(100).max(4000).optional(),
  alt: localized(120),
});

export const skinManifestSchema = z.object({
  skinContract: z.number().int().min(1).max(1000),
  id: z.string().regex(SKIN_ID_RE),
  name: localized(40),
  description: localized(200),
  version: z.string().regex(SEMVER_RE),
  minCore: z.string().regex(SEMVER_RE).optional(),
  author: z.union([z.string().trim().min(1).max(120), z.object({ name: z.string().trim().min(1).max(120), url: z.string().max(300).optional() })]).optional(),
  license: z.string().min(1).max(40),
  tags: z.array(z.string().max(30)).max(12).optional(),
  modes: z.array(z.enum(["light", "dark"])).min(1).max(2).refine((m) => new Set(m).size === m.length, "duplicate mode"),
  tokens: z.string().min(1).max(100),
  stylesheet: z.string().min(1).max(100).optional(),
  previews: z.array(preview).max(40).optional(),
  assets: z.array(asset).max(200).optional(),
  defaults: z.object({
    headerLayout: z.enum(HEADER_LAYOUTS as [string, ...string[]]).optional(),
    font: z.enum(["sans", "serif", "mono", "skin"]).optional(),
    glow: z.enum(["none", "soft", "strong"]).optional(),
    background: z.union([z.string().max(40), z.array(z.record(z.string(), z.unknown())).max(6)]).optional(),
  }).optional(),
  options: z.array(option).max(6).optional(),
  breakpoints: z.array(z.number().int().min(320).max(2560)).max(4).optional(),
  supports: z.object({ reducedMotion: z.boolean().optional() }).optional(),
});

export type SkinAssetDecl = z.infer<typeof asset>;
export type SkinManifest = Omit<z.infer<typeof skinManifestSchema>, "author" | "tags" | "assets"> & { author?: { name: string; url?: string }; tags: string[]; assets: SkinAssetDecl[] };

const KNOWN_KEYS = new Set(Object.keys(skinManifestSchema.shape));

export type ManifestParse = { ok: true; manifest: SkinManifest; warnings: SkinIssue[] } | { ok: false; issues: SkinIssue[] };

/** Texte propre d'un chemin d'erreur zod (`options.0.values`) : jamais de contenu d'auteur dedans. */
const where = (path: readonly PropertyKey[]): string => path.filter((p) => typeof p === "string" || typeof p === "number").map(String).join(".").slice(0, 50) || "skin.json";

/** Valide le JSON déjà lu de `skin.json`. Le contrat plus récent que celui du cœur est signalé à part (même si la forme est valide). */
export function parseSkinManifest(json: unknown): ManifestParse {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, issues: [makeIssue("manifest-field", { field: "skin.json" })] };
  const raw = json as Record<string, unknown>;
  const issues: SkinIssue[] = [];
  const contract = raw.skinContract;
  if (Number.isInteger(contract) && (contract as number) > SKIN_CONTRACT) {
    return { ok: false, issues: [makeIssue("manifest-contract-newer", { max: SKIN_CONTRACT })] };
  }
  const parsed = skinManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const seen = new Set<string>();
    for (const i of parsed.error.issues) {
      const field = where(i.path);
      if (seen.has(field)) continue;
      seen.add(field);
      issues.push(makeIssue("manifest-field", { field }));
      if (issues.length >= 20) break;
    }
    return { ok: false, issues };
  }
  const warnings: SkinIssue[] = [];
  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.has(key)) warnings.push(makeIssue("manifest-unknown-key", { field: key }));
  const m = parsed.data;
  const tags = (m.tags ?? []).filter((t) => TAG_VOCABULARY.includes(t));
  if (tags.length < (m.tags ?? []).length || tags.length > 6) warnings.push(makeIssue("manifest-unknown-key", { field: "tags" }));
  if (tags.length > 6) tags.length = 6;
  const author = typeof m.author === "string" ? { name: m.author } : m.author;
  return { ok: true, manifest: { ...m, author, tags, assets: m.assets ?? [] }, warnings };
}
