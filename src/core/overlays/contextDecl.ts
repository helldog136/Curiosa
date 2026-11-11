import { z } from "zod";

/**
 * OPTIONAL KEY `overlayContexts` OF module.json (core 0.8.0): the GENERIC "overlay context" contract.
 *
 * A module may offer named context values (the current game, the scene, a mood, an event…). The core never imports a module: it asks the active instances
 * that declare a context, through the functions in `index.mjs` (`overlayContexts.<id>.current` / `.values`), and maps a value to an overlay skin with the
 * rules of each overlay page. A module that declares nothing changes nothing; a module that disappears leaves the default skin.
 */
export const OVERLAY_CONTEXTS_MIN_CORE = "0.8.0";
export const MAX_CONTEXTS_PER_MODULE = 5;
export const CONTEXT_ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
const localized = z.union([z.string().trim().min(1).max(120), z.record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), z.string().trim().min(1).max(120)).refine((r) => { const n = Object.keys(r).length; return n >= 1 && n <= 12; }, "1 to 12 languages")]);

export const overlayContextSchema = z.object({
  id: z.string().regex(CONTEXT_ID_RE, "context id: lowercase letters, digits and dashes (31 characters at most, starting with a letter)"),
  /** What the value is, as a noun: "Game". Column title of the rules table and name of the picker. */
  label: localized,
  /** The switch of the overlay page editor: "Skin per game". */
  switchLabel: localized,
  /** A concrete example value for the empty state: "a racing game". */
  example: localized.optional(),
}).strict();
export type OverlayContextDecl = z.infer<typeof overlayContextSchema>;
export const overlayContextsSchema = z.array(overlayContextSchema).min(1).max(MAX_CONTEXTS_PER_MODULE);

export function overlayContextIssues(list: readonly OverlayContextDecl[] | undefined, minCore: string | undefined): { path: (string | number)[]; message: string }[] {
  if (!list) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const ids = list.map((c) => c.id);
  if (new Set(ids).size < ids.length) out.push({ path: [], message: "duplicate context id" });
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(minCore ?? "");
  if (!(m && (Number(m[1]) > 0 || Number(m[2]) >= 8))) out.push({ path: [], message: `overlayContexts needs minCore ${OVERLAY_CONTEXTS_MIN_CORE} or later (an older core ignores the key)` });
  return out;
}
