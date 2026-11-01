/**
 * MASQUAGE DES SECRETS dans tout ce que les outils de maintenance renvoient à une IA (journaux, messages d'erreur, adresses de dépôt, détails d'audit).
 * Le masquage est volontairement large : mieux vaut cacher un identifiant long et inoffensif que laisser passer un secret.
 * Logique pure (aucune dépendance) : testée telle quelle.
 */
const MASK = "[masked]";

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Jetons de ce site.
  [/\bvit_[A-Za-z0-9_-]{6,}/g, `vit_${MASK}`],
  // Jetons connus d'autres services (GitHub, clés « sk- », AWS, Slack, JWT).
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, MASK],
  // Blocs de clés privées.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  // Identifiants dans une adresse : https://utilisateur:mot-de-passe@hôte
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*(?::[^\s/@]*)?@/gi, "$1" + MASK + "@"],
  // Paramètres d'adresse sensibles : ?token=…&key=…
  [/([?&;](?:[a-z0-9_.-]*(?:token|key|secret|password|passwd|pwd|auth|signature|sig|session|code)[a-z0-9_.-]*)=)[^&\s"'<>]*/gi, "$1" + MASK],
  // « Authorization: Bearer … », « Bearer … », « Basic … ».
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 " + MASK],
  // « mot-de-passe = valeur », « "token": "valeur" », « SMTP_PASS=valeur », « api_key: valeur ».
  [/((?:[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|credential|authorization|cookie|pass|pwd)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi, "$1" + MASK],
  // Variables d'environnement qui ressemblent à des secrets.
  [/\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASS|PASSWORD|PWD)[A-Z0-9_]*=)\S+/g, "$1" + MASK],
  // Longues suites opaques (hexadécimal, base64) : presque toujours un secret ou une empreinte.
  [/\b[A-Fa-f0-9]{32,}\b/g, MASK],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, MASK],
];

/** Masque les secrets d'un texte, puis le borne à `max` caractères (« … » à la fin si coupé). */
export function redactSecrets(input: unknown, max = 500): string {
  let text = typeof input === "string" ? input : input instanceof Error ? input.message : (() => { try { return JSON.stringify(input) ?? ""; } catch { return String(input); } })();
  text = text.replace(/\u0000/g, "");
  for (const [re, to] of RULES) text = text.replace(re, to as string);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** Masque les secrets de toutes les chaînes d'une valeur JSON (en profondeur, bornée) et borne chaque chaîne. */
export function redactDeep<T>(value: T, maxString = 500, depth = 0): T {
  if (typeof value === "string") return redactSecrets(value, maxString) as T;
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactDeep(v, maxString, depth + 1)) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([k, v]) => [k, redactDeep(v, maxString, depth + 1)])) as T;
}

/** Dernières lignes d'un journal, masquées et bornées en nombre ET en taille (filtre facultatif). */
export function tailLines(text: string, opts: { lines?: number; maxLine?: number; filter?: RegExp } = {}): string[] {
  const { lines = 20, maxLine = 300, filter } = opts;
  return text.split("\n").map((l) => l.trimEnd()).filter((l) => l && (!filter || filter.test(l))).slice(-lines).map((l) => redactSecrets(l, maxLine));
}

/** Adresse de dépôt sans identifiants (jamais de jeton dans ce qu'on montre). */
export function publicRepo(url: string | null | undefined): string | null {
  if (!url) return null;
  return redactSecrets(url.replace(/\.git$/, ""), 200);
}
