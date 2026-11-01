import { NICKNAME_MAX } from "../instanceLabel";

/**
 * DONNÉES MISES DE CÔTÉ — la logique PURE (sans base de données, testée seule). Quand on retire un module ou une instance en « gardant mes données »,
 * tout ce que l'instance possédait est rangé en un bloc inerte (voir retired.ts) ; réinstaller le module remet ce bloc tel quel. Ici : la forme du bloc,
 * ce qu'il faut ajuster quand le monde a changé entre-temps (adresse ou identifiant déjà pris), et la migration des « éteints » d'avant la 0.1.20.
 */
export type Row = Record<string, unknown>;

/** Tout ce qu'une instance possède : sa ligne, ses traductions, ses entrées, ses réglages (`instance.<id>.…`) et son stockage. Dates en texte (JSON). */
export type RetiredPayload = {
  v: 1;
  instance: Row;
  translations: Row[];
  entries: Row[];
  entryTranslations: Row[];
  settings: { key: string; locale: string; value: string }[];
  records: Row[];
};

const isRows = (v: unknown): v is Row[] => Array.isArray(v) && v.every((r) => r && typeof r === "object" && !Array.isArray(r));

/** Lit un bloc enregistré. Illisible ou d'une forme inconnue → null (on ne devine jamais : les données restent rangées, intactes). */
export function parsePayload(raw: string): RetiredPayload | null {
  let p: unknown;
  try { p = JSON.parse(raw); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (o.v !== 1 || !o.instance || typeof o.instance !== "object" || Array.isArray(o.instance)) return null;
  if (!isRows(o.translations) || !isRows(o.entries) || !isRows(o.entryTranslations) || !isRows(o.records) || !Array.isArray(o.settings)) return null;
  const settings = o.settings;
  if (!settings.every((s) => s && typeof s === "object" && typeof (s as Row).key === "string" && typeof (s as Row).locale === "string" && typeof (s as Row).value === "string")) return null;
  return o as unknown as RetiredPayload;
}

/** Colonnes de date de chaque table : le JSON les porte en texte, la base les veut en date. */
const DATE_FIELDS = {
  instance: ["createdAt", "updatedAt"],
  entry: ["publishedAt", "expiresAt", "createdAt", "updatedAt"],
  entryTranslation: ["updatedAt"],
  record: ["createdAt"],
} as const;

export function reviveDates(kind: keyof typeof DATE_FIELDS, row: Row): Row {
  const out: Row = { ...row };
  for (const f of DATE_FIELDS[kind]) if (typeof out[f] === "string") out[f] = new Date(out[f] as string);
  return out;
}

/* ───────────── Ce qui est déjà pris quand on remet une instance ───────────── */

export type Occupied = {
  /** Identifiants d'instance en base. */
  ids: ReadonlySet<string>;
  keys: ReadonlySet<string>;
  basePaths: ReadonlySet<string>;
  /** Surnoms des autres instances du même module. */
  nicknames: readonly string[];
  /** Combien d'instances ce module a déjà, et s'il n'en accepte qu'une. */
  siblings: number;
  single: boolean;
  /** Chemin interdit (réservé par le cœur, code de langue…). */
  reserved: (path: string) => boolean;
};

export type RestorePlan =
  | { ok: true; key: string; basePath: string | null; nickname: string | null; /** Ce qui a dû changer pour que la remise en place ne heurte rien. */ changed: ("key" | "basePath" | "nickname")[] }
  | { ok: false; reason: "single" | "exists" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Premier « base », « base-2 », « base-3 »… libre. */
export function firstFree(base: string, taken: (v: string) => boolean, max = 31): string {
  for (let i = 1; i < 1000; i++) {
    const suffix = i === 1 ? "" : `-${i}`;
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base.slice(0, max - 14)}-${Date.now()}`;
}

/**
 * Comment remettre une instance rangée : refusée si elle existe déjà, ou si le module n'accepte qu'UNE instance et en a déjà une (les données restent
 * rangées, rien n'est écrasé). Sinon on la remet à l'identique ; seuls l'identifiant technique, l'adresse publique et le surnom changent, et seulement
 * s'ils ont été pris entre-temps.
 */
export function planRestore(row: { id: string; key: string; basePath: string | null; nickname: string | null }, now: Occupied): RestorePlan {
  if (now.ids.has(row.id)) return { ok: false, reason: "exists" };
  if (now.single && now.siblings > 0) return { ok: false, reason: "single" };
  const changed: ("key" | "basePath" | "nickname")[] = [];
  let key = row.key;
  if (now.keys.has(key)) { key = firstFree(row.key, (k) => now.keys.has(k)); changed.push("key"); }
  let basePath = row.basePath;
  if (basePath !== null && (now.basePaths.has(basePath) || (basePath !== "" && now.reserved(basePath)))) {
    // Une adresse vide (accueil) prise : on cherche à partir du module plutôt que de rester sans page ; sinon « blog-2 »…
    basePath = firstFree(basePath || key, (p) => now.basePaths.has(p) || now.reserved(p));
    changed.push("basePath");
  }
  let nickname = row.nickname;
  if (nickname && now.nicknames.some((n) => norm(n) === norm(nickname!))) {
    for (let i = 2; i < 100; i++) {
      const suffix = ` ${i}`;
      const candidate = `${nickname.slice(0, NICKNAME_MAX - suffix.length)}${suffix}`;
      if (!now.nicknames.some((n) => norm(n) === norm(candidate))) { nickname = candidate; break; }
    }
    changed.push("nickname");
  }
  return { ok: true, key, basePath, nickname, changed };
}

/* ───────────── Présentation ───────────── */

export type RetiredLine = { id: string; moduleId: string; key: string; label: string; moduleName: string; reason: string; retiredAt: Date; entryCount: number; recordCount: number; /** Dépôt d'où réinstaller quand le module ne vient pas du catalogue. */ repoUrl: string | null; ref: string | null; subdir: string | null };

/** Données gardées regroupées par module (le plus récent d'abord) : ce que la liste « Ajouter » et la page d'un module montrent. */
export function groupByModule(rows: readonly RetiredLine[]): { moduleId: string; moduleName: string; instances: RetiredLine[]; retiredAt: Date; entryCount: number; recordCount: number; repoUrl: string | null; ref: string | null; subdir: string | null }[] {
  const by = new Map<string, RetiredLine[]>();
  for (const r of rows) by.set(r.moduleId, [...(by.get(r.moduleId) ?? []), r]);
  return [...by.entries()]
    .map(([moduleId, instances]) => {
      const sorted = [...instances].sort((a, b) => b.retiredAt.getTime() - a.retiredAt.getTime() || a.key.localeCompare(b.key));
      return { moduleId, moduleName: sorted[0]!.moduleName, instances: sorted, retiredAt: sorted[0]!.retiredAt, repoUrl: sorted[0]!.repoUrl, ref: sorted[0]!.ref, subdir: sorted[0]!.subdir, entryCount: sorted.reduce((n, r) => n + r.entryCount, 0), recordCount: sorted.reduce((n, r) => n + r.recordCount, 0) };
    })
    .sort((a, b) => b.retiredAt.getTime() - a.retiredAt.getTime() || a.moduleId.localeCompare(b.moduleId));
}
