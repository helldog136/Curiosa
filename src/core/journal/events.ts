/**
 * JOURNAL CENTRAL — la partie PURE (ni base ni React) : bornes, déclarations d'événements des modules, mise en forme des données et phrase affichée.
 *
 * Un module écrit au journal du cœur avec `ctx.api.log.write({ action, target?, level?, data? })` (voir write.ts). Il ne dit JAMAIS qui agit (le cœur le déduit) et
 * il DÉCLARE dans son manifeste (`logEvents`) chaque type d'événement : clé, libellé français et anglais, champs autorisés. Tout champ non déclaré est écarté,
 * chaque valeur tient en 200 caractères, aucun secret ni texte libre du public n'est conservé. Un module sans déclaration écrit des lignes génériques SANS données.
 */

/** Toutes les bornes du journal en un seul endroit (jamais de minuteur de fond : la purge se fait à l'écriture, par petites tranches). */
export const JOURNAL_LIMITS = {
  /** Une ligne rattachée à un module est supprimée après ce nombre de jours. */
  retentionDays: 90,
  /** Lignes gardées au plus par module (les plus anciennes partent d'abord). */
  maxPerModule: 500,
  /** Événements déclarés `frequent` : gardés ce nombre de jours au plus… */
  frequentDays: 7,
  /** … et ce nombre de lignes au plus par module. */
  frequentMax: 200,
  /** Lignes supprimées au plus par étape de purge (la purge ne ralentit jamais une écriture). */
  purgeSlice: 50,
  /** Caractères au plus par champ de données (et pour la cible). */
  fieldChars: 200,
  /** Champs déclarés au plus par événement. */
  maxFields: 5,
  /** Événements déclarés au plus par module. */
  maxEvents: 30,
  /** Caractères au plus du JSON de données enregistré. */
  dataChars: 1500,
  /** Caractères au plus du libellé d'un événement. */
  labelChars: 120,
} as const;

export const LEVELS = ["info", "warn", "error"] as const;
export type JournalLevel = (typeof LEVELS)[number];
export const ACTOR_KINDS = ["person", "module", "assistant", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export const isLevel = (v: unknown): v is JournalLevel => (LEVELS as readonly unknown[]).includes(v);
export const isActorKind = (v: unknown): v is ActorKind => (ACTOR_KINDS as readonly unknown[]).includes(v);

export type LogFieldType = "text" | "number" | "boolean";
export type LogFieldDecl = { key: string; type?: LogFieldType };
export type LogEventDecl = { key: string; label: Record<string, string>; level?: JournalLevel; frequent?: boolean; fields?: LogFieldDecl[] };

/** Clé d'un événement : 1 à 4 segments en minuscules (« command.run »), 48 caractères au plus. */
export const EVENT_KEY_RE = /^[a-z][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*){0,3}$/;
export const EVENT_KEY_MAX = 48;
/** Ce que `ctx.api.log.write` accepte comme `action` (même forme qu'une clé déclarée). */
export const ACTION_RE_FOR_MODULE = new RegExp(`^(?=.{1,${EVENT_KEY_MAX}}$)${EVENT_KEY_RE.source.slice(1)}`);
/** Premiers segments réservés aux lignes que le cœur écrit lui-même pour un module (actions d'administration, assistants, réglages) : un module ne s'en sert pas. */
export const RESERVED_ACTION_RE = /^(module|mcp|instance)(\.|$)/;
export const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,30}$/;
/** Un champ qui porterait un secret par son nom est refusé à la déclaration. */
export const SECRET_NAME_RE = /(secret|token|jeton|passw|passe|apikey|authorization|bearer|cookie|credential|session|oauth|private)|^(key|clef|cle)$/i;
/** Un champ qui porterait un texte libre du public (message de chat, commentaire…) est refusé à la déclaration. */
export const PUBLIC_TEXT_NAME_RE = /^(message|msg|comment|commentaire|chat|text|texte|body|corps|content|contenu|reply|reponse|whisper|input|query|bio)$/i;

/** Les trois façons de reconnaître une valeur qui ressemble à un secret : en-tête d'autorisation, préfixes connus, longue chaîne opaque. */
export function looksSecret(value: string): boolean {
  if (/^(bearer|basic)\s+\S{8,}/i.test(value)) return true;
  if (/(^|\s)(oauth:|sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\.|ghp_[A-Za-z0-9]{16,}|xox[abp]-|AKIA[0-9A-Z]{12,})/.test(value)) return true;
  return value.split(/\s+/).some((w) => w.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(w) && /[A-Za-z]/.test(w) && /\d/.test(w));
}

/** Texte propre pour une valeur : sans caractères de contrôle, espaces réduits, 200 caractères au plus ; null s'il ressemble à un secret ou s'il est vide. */
export function cleanText(value: unknown, max: number = JOURNAL_LIMITS.fieldChars): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || looksSecret(text)) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const PLACEHOLDER_RE = /\{(\w+)\}/g;
export const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!))].sort();

/** Problèmes d'une déclaration `logEvents` (liste vide = valide). Messages en anglais, comme les autres erreurs du manifeste. */
export function logEventIssues(events: readonly LogEventDecl[] | undefined): string[] {
  const issues: string[] = [];
  const list = events ?? [];
  if (list.length > JOURNAL_LIMITS.maxEvents) issues.push(`at most ${JOURNAL_LIMITS.maxEvents} log events`);
  const seen = new Set<string>();
  for (const e of list) {
    if (e.key.length > EVENT_KEY_MAX || !EVENT_KEY_RE.test(e.key)) issues.push(`log event "${e.key}": the key is lowercase segments like command.run (48 characters at most)`);
    if (RESERVED_ACTION_RE.test(e.key)) issues.push(`log event "${e.key}": module, mcp and instance are reserved first segments (the core writes those lines itself)`);
    if (seen.has(e.key)) issues.push(`duplicate log event "${e.key}"`);
    seen.add(e.key);
    const fields = e.fields ?? [];
    if (fields.length > JOURNAL_LIMITS.maxFields) issues.push(`log event "${e.key}": at most ${JOURNAL_LIMITS.maxFields} fields`);
    const names = new Set<string>();
    for (const f of fields) {
      if (names.has(f.key)) issues.push(`log event "${e.key}": duplicate field "${f.key}"`);
      names.add(f.key);
      if (SECRET_NAME_RE.test(f.key)) issues.push(`log event "${e.key}": field "${f.key}" looks like a secret; a secret is never logged`);
      if (PUBLIC_TEXT_NAME_RE.test(f.key)) issues.push(`log event "${e.key}": field "${f.key}" looks like free text typed by the public; log a name, a count or a state instead`);
    }
    const labels = Object.entries(e.label);
    if (typeof e.label.fr !== "string" || typeof e.label.en !== "string") issues.push(`log event "${e.key}": the label needs both fr and en`);
    let reference: string[] | null = null;
    for (const [lang, text] of labels) {
      if (text.length > JOURNAL_LIMITS.labelChars) issues.push(`log event "${e.key}": the ${lang} label is longer than ${JOURNAL_LIMITS.labelChars} characters`);
      const used = placeholdersOf(text);
      for (const p of used) if (!names.has(p)) issues.push(`log event "${e.key}": the ${lang} label uses {${p}}, which is not a declared field`);
      if (reference && reference.join() !== used.join()) issues.push(`log event "${e.key}": the labels do not use the same {variables} in every language`);
      reference ??= used;
    }
  }
  return issues;
}

/** Les données gardées : SEULEMENT les champs déclarés, chacun converti à son type et borné ; le reste est écarté en silence. */
export function shapeData(decl: Pick<LogEventDecl, "fields"> | undefined, data: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!decl?.fields?.length || !data || typeof data !== "object" || Array.isArray(data)) return out;
  const source = data as Record<string, unknown>;
  for (const f of decl.fields.slice(0, JOURNAL_LIMITS.maxFields)) {
    if (!Object.hasOwn(source, f.key)) continue;
    const v = source[f.key];
    const type = f.type ?? "text";
    if (type === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (type === "boolean") {
      if (typeof v === "boolean") out[f.key] = v;
    } else {
      const text = cleanText(v);
      if (text !== null) out[f.key] = text;
    }
  }
  return out;
}

/** Le JSON enregistré (vide s'il n'y a rien). Au-delà de la borne, les derniers champs sont retirés plutôt que de couper le JSON. */
export function serializeData(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  while (keys.length > 0) {
    const text = JSON.stringify(Object.fromEntries(keys.map((k) => [k, data[k]])));
    if (text.length <= JOURNAL_LIMITS.dataChars) return text;
    keys.pop();
  }
  return "";
}

/** Relit le JSON d'une ligne : un objet de valeurs simples, jamais d'erreur (texte abîmé = rien). */
export function parseData(raw: string): Record<string, string | number | boolean> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) as Record<string, string | number | boolean>;
  } catch {
    return {};
  }
}

/** Qui a agi, d'après la forme de l'ancien champ `actor` (lignes écrites avant le journal central ou par le cœur). */
export function actorKindOf(actor: string): ActorKind {
  if (actor.startsWith("mcp:")) return "assistant";
  if (actor.startsWith("module:")) return "module";
  return actor.includes("@") ? "person" : "system";
}

/** La phrase d'un événement : le libellé de la langue demandée (sinon celle du site, l'anglais, le français), `{champ}` remplacé par la valeur. */
export function renderEvent(decl: Pick<LogEventDecl, "label">, data: Record<string, string | number | boolean>, opts: { locale: string; defaultLocale: string; yes: string; no: string }): string {
  const label = decl.label[opts.locale] ?? decl.label[opts.defaultLocale] ?? decl.label.en ?? decl.label.fr ?? Object.values(decl.label)[0] ?? "";
  return label.replace(PLACEHOLDER_RE, (_all, name: string) => {
    const v = data[name];
    if (v === undefined) return "—";
    return typeof v === "boolean" ? (v ? opts.yes : opts.no) : String(v);
  });
}

/** Normalise ce que le manifeste a déclaré (zod garantit la forme) en liste d'événements utilisables. */
export const eventsOf = (manifest: { logEvents?: readonly LogEventDecl[] | null } | null | undefined): LogEventDecl[] => [...(manifest?.logEvents ?? [])];
