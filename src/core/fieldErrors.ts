/**
 * Erreurs PAR CHAMP renvoyées par une action : `errors: { <nom du champ ou chemin>: message }`. Additif : une action qui ne renvoie qu'un `error` global
 * continue d'afficher le bandeau ; une action qui renvoie `errors` voit chaque message affiché juste sous son champ (voir components/admin/FieldErrors.tsx).
 * Les chemins des éditeurs répétables sont `items.2.href` (ligne 3 de la liste `items`, champ `href`) ; les groupes `items.1.items.0.href`.
 */
export type FieldErrorMap = Record<string, string>;

const KEY_RE = /^[A-Za-z0-9_.[\]-]{1,80}$/;
const MAX_ERRORS = 20;

/** Nettoie ce qu'un module (ou une action) renvoie : au plus 20 entrées, clés sûres, messages courts sur une ligne. Rien d'exploitable → `undefined`. */
export function sanitizeFieldErrors(input: unknown): FieldErrorMap | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: FieldErrorMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ERRORS) break;
    if (!KEY_RE.test(key) || typeof value !== "string") continue;
    const message = value.replace(/\s+/g, " ").trim().slice(0, 300);
    if (message) out[key] = message;
  }
  return Object.keys(out).length ? out : undefined;
}
