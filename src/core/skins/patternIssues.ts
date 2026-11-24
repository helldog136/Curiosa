// The skin's own mosaic pieces (core 0.48.0): turns what the pure checkers say about a pattern file (animate/pattern.ts) and about the `patterns` words of the recipe
// (animate/recipe.ts) into the typed skin issues of the message catalogue. Pure and synchronous, like the other skin checkers.
import type { PatternCheck } from "../animate/pattern";
import type { RecipeIssue } from "../animate/recipe";
import { makeIssue, type SkinIssue } from "./messages";

const KB = (bytes: number) => Math.ceil(bytes / 1024);

/** The file could not be read as JSON at all. */
export function patternUnreadable(file: string): SkinIssue { return makeIssue("pattern-unreadable", { file }); }

/** A pattern named by the recipe that is absent, undeclared or unusable. */
export function patternMissing(file: string): SkinIssue { return makeIssue("pattern-missing", { file }); }

/** What the checker found in one pattern file, as skin issues (errors stay errors, warnings stay warnings). */
export function patternFileIssues(file: string, check: PatternCheck, bytes: number, maxBytes: number, limit = 8): SkinIssue[] {
  const out: SkinIssue[] = [];
  // errors first, then the cap: a run of warnings never hides an error
  const ordered = [...check.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  for (const i of ordered) {
    const detail = i.path;
    switch (i.code) {
      case "pattern-too-large": out.push(makeIssue("pattern-too-large", { file, size: KB(bytes), max: KB(maxBytes) })); break;
      case "pattern-invalid": out.push(makeIssue("pattern-invalid", { file, detail })); break;
      case "pattern-cells": out.push(makeIssue("pattern-cells", { file, detail })); break;
      case "pattern-cells-cap": out.push(makeIssue("pattern-cells-cap", { file })); break;
      case "pattern-polygon": out.push(makeIssue("pattern-polygon", { file, detail })); break;
      case "pattern-angle": out.push(makeIssue("pattern-angle", { file, detail })); break;
      case "pattern-overlap": out.push(makeIssue("pattern-overlap", { file, detail })); break;
      case "pattern-coverage": out.push(makeIssue("pattern-coverage", { file, detail })); break;
      case "pattern-contract-newer": out.push(makeIssue("pattern-contract-newer", { file })); break;
      case "pattern-ignored": out.push(makeIssue("pattern-ignored", { file, detail })); break;
      case "pattern-loop": out.push(makeIssue("pattern-loop", { file, detail })); break;
    }
  }
  return out.slice(0, limit);
}

/**
 * The recipe words about patterns (`patterns` table, mosaic `source`), as skin issues; null for any other recipe issue (the caller maps those as before).
 * `pattern-newer` is silent: a variant written for a newer pattern contract is skipped, and its own file already carries the warning.
 */
export function recipePatternIssue(i: RecipeIssue): SkinIssue | null {
  switch (i.code) {
    case "patterns": return makeIssue("patterns-shape", { detail: i.path }, i.severity);
    case "pattern-source": return makeIssue("pattern-source", { detail: i.path });
    case "pattern-missing": return patternMissing(i.path);
    case "pattern-stretch": return makeIssue("pattern-stretch", { detail: i.path });
    default: return null;
  }
}
