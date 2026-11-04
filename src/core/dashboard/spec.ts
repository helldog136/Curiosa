/**
 * TABLEAU DE BORD — l'API déclarative des modules, la partie PURE (ni base, ni React, ni Next) : bornes, schéma du manifeste (clé facultative `dashboard`),
 * validation de ce que le module répond, adresses, mise en forme du texte. Rien ici ne lit le site.
 *
 * Le module DÉCLARE dans `module.json` (`dashboard`) ce qu'il propose au tableau de bord :
 *  - `tasks`        « ce qui attend une action » : un libellé avec `{n}`, un lien d'administration, un droit ; le nombre vient de `dashboard.tasks.<id>(ctx)` ;
 *  - `quickActions` des boutons « Créer… » : un libellé, un lien, un droit (aucun code) ;
 *  - `cards`        des cartes d'information de types FERMÉS : `counter` (un chiffre et une ligne) ou `list` (5 lignes au plus) ; le contenu vient de `dashboard.cards.<id>(ctx)`.
 * Le cœur lit, valide (tout est strict), décide de l'ordre et de la place. Jamais de HTML, de style ni de script venant d'un module : du texte, des nombres, des adresses d'administration.
 * Un cœur plus ancien ignore la clé : un module qui la déclare marche comme avant (le tableau de bord n'affichera rien de lui).
 */
import { pickText } from "../i18n/audit.mjs";
import { z } from "zod";
import { cleanText } from "../journal/events";
import { RIGHT_ID_RE, HISTORY, OPEN } from "../auth/rights";

/** Toutes les bornes en un seul endroit. Aucune n'est réglable par un module. */
export const DASHBOARD_LIMITS = {
  /** Éléments déclarés au plus par module et par sorte. */
  tasks: 6,
  quickActions: 3,
  cards: 2,
  /** Lignes d'une carte « liste ». */
  rows: 5,
  /** Instances d'un même module interrogées au plus. */
  instances: 5,
  /** Appels de code de module au plus pour un affichage (toutes sortes confondues). */
  calls: 40,
  /** Délai laissé à un module pour répondre à UNE demande ; passé ce délai, ce module disparaît du bloc (les autres s'affichent). */
  timeoutMs: 1500,
  /** Durée pendant laquelle une réponse est gardée en mémoire (un rechargement de la page ne redemande rien). */
  cacheMs: 20_000,
  /** Après un échec ou un délai dépassé, ce module n'est pas réinterrogé avant ce délai. */
  failMs: 30_000,
  /** Entrées gardées en mémoire au plus. */
  cacheEntries: 400,
  /** Ce que le tableau de bord montre au plus, tous modules confondus. */
  shownTasks: 12,
  shownActions: 6,
  shownCards: 4,
  /** Longueurs. */
  labelChars: 80,
  titleChars: 80,
  detailChars: 120,
  valueChars: 24,
  hrefChars: 200,
  /** Plus grand nombre affiché pour une tâche (au-delà : « 99999 »). */
  maxCount: 99999,
} as const;

export const ITEM_ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const PLACEHOLDER_RE = /\{(\w+)\}/g;
const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!))].sort();

/** Un texte par langue : le français ET l'anglais sont exigés (parité), 12 langues au plus. */
function words(max: number) {
  return z.record(z.string().regex(LANG_RE), z.string().trim().min(1).max(max)).refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 12, "a text needs 1 to 12 languages");
}

const right = z.string().regex(RIGHT_ID_RE, "right is a local right id like moderate (no colon: the core adds the module prefix), or open / history");
const href = z.string().max(DASHBOARD_LIMITS.hrefChars);
const id = z.string().regex(ITEM_ID_RE, "id is lowercase letters, digits and dashes (31 characters at most)");

export const dashboardSchema = z.object({
  tasks: z.array(z.object({ id, label: words(DASHBOARD_LIMITS.labelChars), href, right: right.optional() }).strict()).max(DASHBOARD_LIMITS.tasks).optional(),
  quickActions: z.array(z.object({ id, label: words(DASHBOARD_LIMITS.labelChars), href, right: right.optional(), icon: z.string().max(8).optional() }).strict()).max(DASHBOARD_LIMITS.quickActions).optional(),
  cards: z.array(z.object({ id, type: z.enum(["counter", "list"]), title: words(DASHBOARD_LIMITS.titleChars), href: href.optional(), right: right.optional(), empty: words(DASHBOARD_LIMITS.detailChars).optional() }).strict()).max(DASHBOARD_LIMITS.cards).optional(),
}).strict();

export type DashboardDecl = z.infer<typeof dashboardSchema>;
export type DashboardTaskDecl = NonNullable<DashboardDecl["tasks"]>[number];
export type DashboardActionDecl = NonNullable<DashboardDecl["quickActions"]>[number];
export type DashboardCardDecl = NonNullable<DashboardDecl["cards"]>[number];

// ── Adresses ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Une adresse d'un module est TOUJOURS dans l'administration : « ?onglet=… » (la page d'administration de l'instance) ou « /admin/… » (une page du cœur).
 * Seuls `{id}` et `{key}` (l'instance) peuvent s'y trouver. Jamais de domaine, de « // », de « .. », de schéma ni de caractère de contrôle.
 */
export function hrefIssue(value: string): string | null {
  if (value.length > DASHBOARD_LIMITS.hrefChars) return "the link is too long";
  const bare = value.replaceAll("{id}", "x").replaceAll("{key}", "x");
  if (/[{}]/.test(bare)) return "only {id} and {key} may appear in a link";
  if (!/^[A-Za-z0-9_\-./?=&%:+,~#]*$/.test(bare)) return "a link holds letters, digits and the characters - _ . / ? = & % : + , ~ #";
  if (bare.includes("//") || bare.includes("..") || /[\\]/.test(bare)) return "a link cannot hold // or ..";
  if (bare.startsWith("?")) return null;
  if (bare === "/admin" || bare.startsWith("/admin/") || bare.startsWith("/admin?")) return null;
  return "a link starts with ? (the page of this extension) or /admin/ (a page of the administration)";
}

/** L'adresse complète (« /admin/instances/<id>?tab=… »), ou null si elle n'est pas permise. */
export function resolveHref(value: unknown, instance: { id: string; key: string }): string | null {
  if (typeof value !== "string" || hrefIssue(value)) return null;
  const filled = value.replaceAll("{id}", encodeURIComponent(instance.id)).replaceAll("{key}", encodeURIComponent(instance.key));
  if (filled.startsWith("?")) return `/admin/instances/${encodeURIComponent(instance.id)}${filled === "?" ? "" : filled}`;
  return filled;
}

// ── Problèmes du manifeste ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Words = Record<string, string>;
function wordsIssues(where: string, text: Words, allowed: readonly string[]): string[] {
  const out: string[] = [];
  if (typeof text.fr !== "string" || typeof text.en !== "string") out.push(`${where}: the text needs both fr and en`);
  let reference: string[] | null = null;
  for (const [lang, value] of Object.entries(text)) {
    const used = placeholdersOf(value);
    for (const p of used) if (!allowed.includes(p)) out.push(`${where}: the ${lang} text uses {${p}}, which is not available here${allowed.length ? ` (only ${allowed.map((a) => `{${a}}`).join(", ")})` : ""}`);
    if (reference && reference.join() !== used.join()) out.push(`${where}: the texts do not use the same {variables} in every language`);
    reference ??= used;
  }
  return out;
}

/** Problèmes d'une déclaration `dashboard` (liste vide = valide). `rights` : les identifiants locaux des droits du module. Messages en anglais, comme les autres erreurs du manifeste. */
export function dashboardIssues(decl: DashboardDecl | undefined, rights: readonly string[] = []): string[] {
  if (!decl) return [];
  const out: string[] = [];
  const known = new Set<string>([OPEN, HISTORY, ...rights]);
  const check = (kind: string, items: readonly { id: string; right?: string | undefined; href?: string | undefined }[] | undefined) => {
    const seen = new Set<string>();
    for (const item of items ?? []) {
      if (seen.has(item.id)) out.push(`duplicate ${kind} "${item.id}"`);
      seen.add(item.id);
      if (item.right !== undefined && !known.has(item.right)) out.push(`${kind} "${item.id}": the right "${item.right}" is not declared in rights (nor open or history)`);
      if (item.href !== undefined) { const issue = hrefIssue(item.href); if (issue) out.push(`${kind} "${item.id}": ${issue}`); }
    }
  };
  check("task", decl.tasks);
  check("quick action", decl.quickActions);
  check("card", decl.cards);
  for (const task of decl.tasks ?? []) out.push(...wordsIssues(`task "${task.id}"`, task.label, ["n"]));
  for (const action of decl.quickActions ?? []) out.push(...wordsIssues(`quick action "${action.id}"`, action.label, []));
  for (const card of decl.cards ?? []) {
    out.push(...wordsIssues(`card "${card.id}"`, card.title, []));
    if (card.empty) out.push(...wordsIssues(`card "${card.id}" (empty)`, card.empty, []));
  }
  return out;
}

/** Le droit complet d'un élément (« <module>:moderate »), `<module>:open` par défaut. Un identifiant invalide donne null : l'élément n'est jamais montré. */
export function itemRight(moduleId: string, local: string | undefined): string | null {
  const l = local ?? OPEN;
  return RIGHT_ID_RE.test(l) ? `${moduleId}:${l}` : null;
}

/** Texte du manifeste dans la langue de la personne : sa langue, puis la langue du site, puis l'anglais, puis la première. */
export function pickWords(text: Words | undefined, locale: string, defaultLocale: string): string {
  return pickText(text, locale, defaultLocale);
}

/** Remplace `{n}` par le nombre. Le libellé doit se lire au singulier comme au pluriel (« {n} avis à valider »). */
export function fillCount(label: string, n: number): string {
  return label.replaceAll("{n}", String(n));
}

// ── Ce que le module répond ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un nombre de tâches : un entier ≥ 0 (les décimales sont arrondies vers le bas, au-delà du maximum on garde le maximum). Autre chose : null (rien n'est montré). */
export function parseTaskCount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(DASHBOARD_LIMITS.maxCount, Math.floor(n));
}

export type CardRow = { title: string; detail?: string; href?: string };
export type CardData =
  | { type: "counter"; value: number | string; detail?: string }
  | { type: "list"; rows: CardRow[] };

const plainText = (max: number) => z.string().transform((s) => cleanText(s, max));
const counter = z.object({ value: z.union([z.number().finite().min(0).max(1_000_000_000), plainText(DASHBOARD_LIMITS.valueChars)]), detail: plainText(DASHBOARD_LIMITS.detailChars).optional() }).strict();
const listing = z.object({ rows: z.array(z.object({ title: plainText(DASHBOARD_LIMITS.titleChars), detail: plainText(DASHBOARD_LIMITS.detailChars).optional(), href: href.optional() }).strict()).max(DASHBOARD_LIMITS.rows) }).strict();

/**
 * Ce que `dashboard.cards.<id>` a répondu, selon le type déclaré : valide ou null. Texte nettoyé (sans caractères de contrôle, 120 caractères au plus, rien qui ressemble à un secret),
 * jamais de HTML interprété (le cœur échappe). Une clé inconnue, trop de lignes ou une ligne sans titre : la carte entière est écartée (un module qui répond mal ne montre rien, il ne montre pas de travers).
 * `instance` sert à compléter les adresses des lignes (« ?tab=… »).
 */
export function parseCard(type: "counter" | "list", raw: unknown, instance: { id: string; key: string }): CardData | null {
  if (type === "counter") {
    const r = counter.safeParse(raw);
    if (!r.success) return null;
    const value = r.data.value;
    if (value === null) return null;
    return { type, value: typeof value === "number" ? Math.floor(value) : value, ...(r.data.detail ? { detail: r.data.detail } : {}) };
  }
  const r = listing.safeParse(raw);
  if (!r.success) return null;
  const rows: CardRow[] = [];
  for (const row of r.data.rows) {
    if (!row.title) return null;
    const link = row.href === undefined ? null : resolveHref(row.href, instance);
    if (row.href !== undefined && !link) return null;
    rows.push({ title: row.title, ...(row.detail ? { detail: row.detail } : {}), ...(link ? { href: link } : {}) });
  }
  return { type, rows };
}
