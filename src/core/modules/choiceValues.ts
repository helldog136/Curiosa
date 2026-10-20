import type { ChoiceItem, ChoiceResolution } from "./types";

/**
 * Réglage `choice` (« choix parmi ») : règles PURES (ni base ni réseau), partagées par le manifeste, le serveur, l'admin et les tests.
 * La partie qui interroge les fournisseurs est dans choice.ts.
 */

/** Valeurs de `refersTo` (règle de kit « un réglage qui désigne un existant n'est jamais du texte libre »). */
export const REFERS_TO = ["category", "contact", "organisation", "channel", "connector", "instance", "module", "calendar", "game", "page", "user", "role", "theme", "external"] as const;
/** Ce qu'on ne crée JAMAIS depuis un sélecteur : un rôle, un connecteur, un module, une instance, un compte (gestes réservés, avec leurs propres écrans). */
export const NO_CREATE_REFERS = ["role", "connector", "module", "instance", "user"] as const;

/** Bornes du contrat (docs/V2-CONTRACTS.md, contrat 1). */
export const CHOICE_LIMITS = {
  /** `list` : au plus 50 éléments par page (défaut 20). */
  listMax: 50,
  listDefault: 20,
  /** `get` : au plus 50 identifiants par appel. */
  getMax: 50,
  /** Texte cherché, étiquette à créer : 100 caractères au plus. */
  qMax: 100,
  labelMax: 100,
  /** Curseur opaque d'une page suivante : au-delà de 500 caractères, ignoré (fin de liste). */
  cursorMax: 500,
  /** Identifiant stocké : 200 caractères au plus (un cuid en fait 25). */
  idMax: 200,
  /** Délai dur d'une vérification par champ, puis pour tout le formulaire. */
  fieldMs: 3000,
  formMs: 5000,
  /** Anti-rebond de la recherche, côté navigateur. */
  debounceMs: 250,
} as const;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);

/** Un identifiant acceptable (texte non vide, borné, sans retour à la ligne). */
export function isChoiceId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= CHOICE_LIMITS.idMax && !/[\r\n]/.test(v);
}

/** Recoupe la réponse de `list` d'un fournisseur : 50 éléments au plus, champs bornés, `next` ignoré s'il dépasse 500 caractères. Ne lève jamais. */
export function sanitizeList(raw: unknown, limit: number = CHOICE_LIMITS.listMax): { items: ChoiceItem[]; next: string | null } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { items?: unknown; next?: unknown };
  const max = Math.max(1, Math.min(CHOICE_LIMITS.listMax, Math.trunc(limit) || CHOICE_LIMITS.listMax));
  const items: ChoiceItem[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (items.length >= max) break;
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const label = str(o.label, 200);
    if (!isChoiceId(o.id) || !label || seen.has(o.id)) continue;
    seen.add(o.id);
    const item: ChoiceItem = { id: o.id, label };
    if (Array.isArray(o.aliases)) {
      const aliases = o.aliases.map((a) => str(a, 200)).filter((a): a is string => a !== null).slice(0, 10);
      if (aliases.length) item.aliases = aliases;
    }
    const hint = str(o.hint, 200);
    if (hint) item.hint = hint;
    items.push(item);
  }
  const next = typeof r.next === "string" && r.next !== "" && r.next.length <= CHOICE_LIMITS.cursorMax ? r.next : null;
  return { items, next };
}

/** Recoupe la réponse de `get` : éléments connus, fusions (`moved`), identifiants disparus. Un id demandé que la réponse ne mentionne pas compte comme disparu. */
export function sanitizeGet(raw: unknown, asked: readonly string[]): { items: { id: string; label: string }[]; moved: Record<string, string>; missing: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { items?: unknown; moved?: unknown; missing?: unknown };
  const wanted = new Set(asked);
  const items: { id: string; label: string }[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const label = str(o.label, 200);
    if (isChoiceId(o.id) && wanted.has(o.id) && label && !items.some((x) => x.id === o.id)) items.push({ id: o.id, label });
  }
  const moved: Record<string, string> = {};
  if (r.moved && typeof r.moved === "object" && !Array.isArray(r.moved)) {
    for (const [from, to] of Object.entries(r.moved as Record<string, unknown>)) if (wanted.has(from) && isChoiceId(to) && to !== from) moved[from] = to;
  }
  const missing = asked.filter((id) => !items.some((x) => x.id === id) && !(id in moved));
  return { items, moved, missing };
}

/** Comparaison d'une étiquette : sans casse, espaces réduits (contrat : `fromText`). */
export function normalizeLabel(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * `fromText` : l'élément dont l'étiquette ou un alias est EXACTEMENT ce texte (sans casse, espaces réduits). Un seul → son id ;
 * aucun → « none » ; plusieurs → « ambiguous » (rien n'est décidé à la place de la personne).
 */
export function matchText(items: readonly ChoiceItem[], text: string): { status: "match"; id: string; label: string } | { status: "none" | "ambiguous" } {
  const want = normalizeLabel(text);
  if (!want) return { status: "none" };
  const hits = items.filter((it) => [it.label, ...(it.aliases ?? [])].some((l) => normalizeLabel(l) === want));
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 1) return { status: "match", id: ids[0]!, label: hits[0]!.label };
  return { status: ids.length ? "ambiguous" : "none" };
}

/** Filtre local (source `providers`, déjà bornée à 50) : le texte cherché apparaît dans l'étiquette ou un alias. */
export function filterItems(items: readonly ChoiceItem[], q: string | undefined): ChoiceItem[] {
  const want = normalizeLabel(q ?? "");
  if (!want) return [...items];
  return items.filter((it) => [it.label, ...(it.aliases ?? [])].some((l) => normalizeLabel(l).includes(want)));
}

/** Page d'une liste locale : curseur = position (texte de chiffres). */
export function pageOf(items: readonly ChoiceItem[], cursor: string | null | undefined, limit: number): { items: ChoiceItem[]; next: string | null } {
  const start = typeof cursor === "string" && /^\d{1,4}$/.test(cursor) ? Number(cursor) : 0;
  const size = Math.max(1, Math.min(CHOICE_LIMITS.listMax, Math.trunc(limit) || CHOICE_LIMITS.listDefault));
  const slice = items.slice(start, start + size);
  return { items: slice, next: start + size < items.length ? String(start + size) : null };
}

/** Arguments de recherche venus du navigateur : bornés et nettoyés (texte ≤ 100, curseur ≤ 500 sinon ignoré, limite ≤ 50). */
export function searchArgs(q: unknown, cursor: unknown, limit?: unknown): { q: string; cursor: string | null; limit: number } {
  const text = typeof q === "string" ? q.replace(/\s+/g, " ").trim().slice(0, CHOICE_LIMITS.qMax) : "";
  const cur = typeof cursor === "string" && cursor !== "" && cursor.length <= CHOICE_LIMITS.cursorMax ? cursor : null;
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.trunc(limit) : CHOICE_LIMITS.listDefault;
  return { q: text, cursor: cur, limit: Math.max(1, Math.min(CHOICE_LIMITS.listMax, n)) };
}

/** Étiquette proposée à la création : 1 à 100 caractères, espaces réduits. */
export function createLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.replace(/\s+/g, " ").trim();
  return label && label.length <= CHOICE_LIMITS.labelMax ? label : null;
}

/**
 * Décision de résolution (pure) à partir de ce que les fournisseurs ont répondu.
 *   stored     valeur enregistrée (vide = rien) ;
 *   known      l'élément enregistré : trouvé (avec sa nouvelle étiquette / son id s'il a été fusionné), disparu, ou inconnu faute de réponse ;
 *   options    les premières options (au plus 2 suffisent) et s'il en existe d'autres, ou null si la liste n'a pas répondu.
 */
export function decideChoice(input: {
  stored: string;
  known?: { state: "found"; id: string; label: string } | { state: "missing" } | { state: "unverified" };
  options: { items: { id: string; label: string }[]; more: boolean } | null;
}): ChoiceResolution {
  const { stored, known, options } = input;
  const count = options ? (options.more ? Math.max(2, options.items.length) : options.items.length) : null;
  if (stored !== "") {
    if (!known || known.state === "unverified") return { status: "unverified" };
    if (known.state === "found") return { status: "chosen", id: known.id, label: known.label };
    // Élément disparu : s'il ne reste qu'une option, le module peut l'utiliser (l'admin le signale) ; sinon, à configurer.
    if (count === 1) return { status: "missing", id: options!.items[0]!.id, label: options!.items[0]!.label };
    return { status: "missing" };
  }
  if (count === null) return { status: "unverified" };
  if (count === 0) return { status: "none" };
  if (count === 1) return { status: "only", id: options!.items[0]!.id, label: options!.items[0]!.label };
  return { status: "ambiguous" };
}

/**
 * Pour la règle « à configurer » (`missingSettings`, qui reste pure) : un `choice` compte comme REMPLI s'il est choisi, s'il n'a qu'une option,
 * si l'élément disparu a un remplaçant unique, ou si le fournisseur n'a pas répondu alors qu'une valeur est enregistrée (on ne crie pas « à configurer »
 * pour une panne). `none`, `ambiguous`, `missing` sans remplaçant comptent comme vides.
 */
export function choiceCountsAsFilled(r: ChoiceResolution, stored: string): boolean {
  switch (r.status) {
    case "chosen": case "only": return true;
    case "missing": return r.id !== undefined;
    case "unverified": return stored !== "";
    default: return false;
  }
}

/** Valeur « remplie » ou vide à passer à `missingSettings` pour un `choice` (voir `choiceCountsAsFilled`). */
export const FILLED_MARK = "\u0001choice";
export function fillStored(r: ChoiceResolution, stored: string): Record<string, unknown> {
  return choiceCountsAsFilled(r, stored) ? { "": FILLED_MARK } : {};
}

/** Délai dur sur une attente : au-delà de `ms`, on rend `{ ok: false }` sans attendre la suite (la promesse abandonnée n'est jamais partagée). */
export async function bounded<T>(work: Promise<T> | (() => Promise<T>), ms: number): Promise<{ ok: true; value: T } | { ok: false; timeout: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false; timeout: true }>((resolve) => { timer = setTimeout(() => resolve({ ok: false, timeout: true }), Math.max(0, ms)); });
  try {
    const p = typeof work === "function" ? Promise.resolve().then(work) : work;
    return await Promise.race([p.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const, timeout: false })), late]);
  } finally {
    clearTimeout(timer);
  }
}
