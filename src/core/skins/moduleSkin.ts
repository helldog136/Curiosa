/**
 * PIÈCES DES MODULES, partie PURE (docs/SKINS.md §8) : à partir des déclarations `skin` des `module.json`, valide chaque jeton avec les MÊMES règles que les jetons
 * d'un skin (`validateTokenValue`, donc `sanitizeTokenValue` : sûreté de la valeur, forme du type, bornes), et construit la couche 2 de la composition :
 * jetons par défaut, paires de lisibilité, pièces ciblables. Ni Next, ni base de données, ni disque, ni réseau, ni minuteur : la lecture des modules installés est dans
 * `moduleParts.ts`, le kit de conformité des modules (`testsupport/`) et le banc d'essai réutilisent cette même fonction.
 *
 * Règles, toutes en faveur du principe fondateur (un skin ne définit que de l'apparence) :
 *  - un jeton invalide est RETIRÉ (avec un message), jamais corrigé ni deviné : le module garde sa valeur de repli écrite dans son propre CSS, donc son rendu ne change pas ;
 *  - un jeton ne peut référencer qu'un jeton COMMUN (`--sk-*`, `--v-*`) ou un jeton du MÊME module : un module ne lit pas les jetons d'un autre ;
 *  - le nom d'un jeton commence par `--sk-m-<id du module>-` et ne peut pas empiéter sur le préfixe d'un autre module installé (`thanks` ≠ `thanks-wall`) ;
 *  - une pièce est `<id du module>.<pièce>` ; elle n'existe que si le module est installé.
 */
import { createHash } from "node:crypto";
import { MODULE_PART_RE } from "./allowlist";
import { makeIssue, type SkinIssue, type Text } from "./messages";
import { TOKEN_BY_NAME, validateTokenValue, type TokenType } from "./tokens";
import type { ModulePairDecl, ModuleTokenDecl } from "./types";
import { MODULE_SKIN_TOKEN_PREFIX, moduleSkinSchema, type ModuleSkinDecl } from "../modules/skinDecl";

export type ModulePartInfo = {
  /** `<module>.<pièce>` = valeur de `data-skin-part`. */
  id: string;
  moduleId: string;
  piece: string;
  kind?: string;
  name: Text;
  description: Text;
  /** Noms des jetons de la pièce qui ont passé le contrôle. */
  tokens: string[];
};

export type ModuleSkinLayer = {
  /** Jetons déclarés par les pièces (nom, type, valeur par défaut) : émis AVANT les valeurs du skin. */
  tokens: readonly ModuleTokenDecl[];
  /** Paires texte / fond à contrôler (paire 11 de la lisibilité). */
  pairs: readonly ModulePairDecl[];
  /** Change quand la liste des pièces ou des jetons change (clé de cache). `"0"` : aucune pièce. */
  version: string;
  /** Les pièces des modules installés, par ordre d'identifiant. */
  parts: readonly ModulePartInfo[];
  /** `{ idDuModule: ["pièce", …] }` : l'option `moduleParts` de l'assainisseur (sélecteurs `[data-skin-part="module.pièce"]`). */
  byModule: Readonly<Record<string, readonly string[]>>;
};

export const EMPTY_MODULE_LAYER: ModuleSkinLayer = { tokens: [], pairs: [], version: "0", parts: [], byModule: {} };

export type ModuleSkinInput = { id: string; skin: unknown };

export type ModuleSkinReport = {
  layer: ModuleSkinLayer;
  /** Problèmes trouvés, avec le module concerné. Un problème n'empêche jamais le module de fonctionner. */
  issues: { moduleId: string; issue: SkinIssue }[];
};

// ---------------------------------------------------------------------------------------------------------------------

const VAR_REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

/** Noms de variables lus par une valeur (`var(--x, …)`), repli compris. */
export function referencedVars(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(VAR_REF_RE)) out.push(m[1]!);
  return out;
}

/**
 * Valide UNE déclaration `skin` (déjà passée par le schéma du manifeste ou non : elle est relue ici) et renvoie ce qui est utilisable. Sert au kit de conformité
 * (rapport lisible) comme à la couche de composition.
 */
export function analyzeModuleSkin(moduleId: string, raw: unknown): {
  ok: boolean;
  decl: ModuleSkinDecl | null;
  parts: ModulePartInfo[];
  tokens: ModuleTokenDecl[];
  pairs: ModulePairDecl[];
  issues: SkinIssue[];
} {
  const issues: SkinIssue[] = [];
  const parsed = moduleSkinSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(makeIssue("module-skin-invalid", { module: moduleId }, "error"));
    return { ok: false, decl: null, parts: [], tokens: [], pairs: [], issues };
  }
  const decl = parsed.data;
  const prefix = MODULE_SKIN_TOKEN_PREFIX(moduleId);
  const types = new Map<string, TokenType>();
  for (const part of decl.parts) for (const t of part.tokens) types.set(t.name, t.type as TokenType);
  const accepted = new Map<string, ModuleTokenDecl>();
  const parts: ModulePartInfo[] = [];
  for (const part of decl.parts) {
    const [mod, piece] = part.id.split(".") as [string, string];
    if (mod !== moduleId || !MODULE_PART_RE.test(part.id)) {
      issues.push(makeIssue("module-skin-invalid", { module: moduleId }, "error"));
      continue;
    }
    const kept: string[] = [];
    for (const t of part.tokens) {
      if (!t.name.startsWith(prefix)) {
        issues.push(makeIssue("module-token-invalid", { module: moduleId, token: t.name }, "error"));
        continue;
      }
      // Le jeton ne lit que des jetons communs ou les siens (jamais ceux d'un autre module).
      const foreign = referencedVars(t.default).find((n) => !(n.startsWith("--v-") || TOKEN_BY_NAME.has(n) || types.has(n)));
      if (foreign) {
        issues.push(makeIssue("module-token-reference", { module: moduleId, token: t.name }, "error"));
        continue;
      }
      // Mêmes règles que les jetons d'un skin : sûreté, forme du type, bornes.
      const r = validateTokenValue(t.name, t.default, { skinId: "module-check", extra: types });
      if (!r.ok) {
        issues.push(makeIssue("module-token-invalid", { module: moduleId, token: t.name }, "error"));
        continue;
      }
      accepted.set(t.name, { name: t.name, type: t.type as TokenType, default: r.value, moduleId });
      kept.push(t.name);
    }
    parts.push({ id: part.id, moduleId, piece, kind: part.kind, name: part.name, description: part.description, tokens: kept });
  }
  const pairs: ModulePairDecl[] = [];
  for (const part of decl.parts) {
    for (const t of part.tokens) {
      if (t.on === undefined || !accepted.has(t.name)) continue;
      if (accepted.has(t.on)) pairs.push({ fg: t.name, bg: t.on });
      else issues.push(makeIssue("module-pair-ignored", { module: moduleId, token: t.name, on: t.on }, "warning"));
    }
  }
  return { ok: !issues.some((i) => i.severity === "error"), decl, parts, tokens: [...accepted.values()], pairs, issues };
}

/**
 * La couche 2 pour un ensemble de modules INSTALLÉS (ordre d'identifiant : le résultat ne dépend pas de l'ordre d'installation). Ne lève jamais. Aucun module
 * qui déclare `skin` : `EMPTY_MODULE_LAYER` (la composition ne change alors en rien).
 */
export function buildModuleSkinLayer(modules: readonly ModuleSkinInput[]): ModuleSkinReport {
  const issues: ModuleSkinReport["issues"] = [];
  const declared = modules.filter((m) => m && typeof m.id === "string" && m.skin !== undefined && m.skin !== null).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (declared.length === 0) return { layer: EMPTY_MODULE_LAYER, issues };
  const installedIds = modules.map((m) => m.id);
  const tokens: ModuleTokenDecl[] = [];
  const pairs: ModulePairDecl[] = [];
  const parts: ModulePartInfo[] = [];
  const seen = new Set<string>();
  const seenParts = new Set<string>();
  for (const m of declared) {
    let a: ReturnType<typeof analyzeModuleSkin>;
    try { a = analyzeModuleSkin(m.id, m.skin); } catch { continue; }
    for (const i of a.issues) issues.push({ moduleId: m.id, issue: i });
    // Un module dont l'id est plus long et commence par « <cet id>- » : ses jetons commencent aussi par notre préfixe ; ils sont à lui, pas à nous.
    const longer = installedIds.filter((o) => o !== m.id && o.startsWith(`${m.id}-`));
    const mine = (name: string) => !longer.some((o) => name.startsWith(MODULE_SKIN_TOKEN_PREFIX(o)));
    const kept = new Set<string>();
    for (const t of a.tokens) {
      if (!mine(t.name) || seen.has(t.name)) {
        issues.push({ moduleId: m.id, issue: makeIssue("module-token-clash", { token: t.name }) });
        continue;
      }
      seen.add(t.name);
      kept.add(t.name);
      tokens.push(t);
    }
    for (const p of a.pairs) if (kept.has(p.fg) && kept.has(p.bg)) pairs.push(p);
    for (const p of a.parts) {
      if (seenParts.has(p.id)) continue;
      seenParts.add(p.id);
      parts.push({ ...p, tokens: p.tokens.filter((n) => kept.has(n)) });
    }
  }
  const byModule: Record<string, string[]> = {};
  for (const p of parts) (byModule[p.moduleId] ??= []).push(p.piece);
  if (tokens.length === 0 && parts.length === 0) return { layer: EMPTY_MODULE_LAYER, issues };
  const version = createHash("sha1").update(JSON.stringify([tokens, pairs, parts.map((p) => p.id)])).digest("hex").slice(0, 12);
  return { layer: { tokens, pairs, version, parts, byModule }, issues };
}

/** Empreinte stable des pièces par module, pour la clé de cache d'une feuille de skin assainie avec `moduleParts`. */
export function partsSignature(byModule: Readonly<Record<string, readonly string[]>>): string {
  const keys = Object.keys(byModule).sort();
  if (keys.length === 0) return "";
  return createHash("sha1").update(JSON.stringify(keys.map((k) => [k, [...byModule[k]!].sort()]))).digest("hex").slice(0, 12);
}
