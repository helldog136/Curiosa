/**
 * POLICES : types et règles partagés (serveur ET navigateur : aucun accès au disque ici). Voir docs/POLICES.md.
 *
 * Un CHOIX de police est une petite chaîne, enregistrée dans `theme.fontHeading` (titres) ou `theme.fontBody` (texte) :
 *   ""  / absent   celle du skin (rien n'est retouché)
 *   sys:sans|serif|mono   la police du système (les anciennes valeurs `sans`, `serif`, `mono` de `theme.font` sont lues pareil)
 *   lib:<id>       une famille de la bibliothèque embarquée (`fonts/library.json`)
 *   up:<nom>       une police envoyée par la personne (`theme.fontFiles`)
 * Un choix inconnu (police retirée, bibliothèque plus ancienne) est lu comme « celle du skin » : jamais d'erreur, jamais de page cassée.
 */

export const FONT_GROUPS = ["sans", "serif", "handwriting", "display", "mono", "readable"] as const;
export type FontGroup = (typeof FONT_GROUPS)[number];
export const isFontGroup = (v: unknown): v is FontGroup => (FONT_GROUPS as readonly unknown[]).includes(v);

export type SystemKey = "sans" | "serif" | "mono";
export const SYSTEM_KEYS: readonly SystemKey[] = ["sans", "serif", "mono"];

export type FontChoice =
  | { kind: "skin" }
  | { kind: "sys"; key: SystemKey }
  | { kind: "lib"; id: string }
  | { kind: "up"; id: string };

export const LIB_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const UP_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Lit une valeur de réglage. Tout ce qui n'est pas reconnu vaut « celle du skin ». */
export function parseChoice(v: unknown): FontChoice {
  if (typeof v !== "string") return { kind: "skin" };
  const s = v.trim();
  if ((SYSTEM_KEYS as readonly string[]).includes(s)) return { kind: "sys", key: s as SystemKey };
  const m = /^(sys|lib|up):(.+)$/.exec(s);
  if (!m) return { kind: "skin" };
  if (m[1] === "sys") return (SYSTEM_KEYS as readonly string[]).includes(m[2]!) ? { kind: "sys", key: m[2] as SystemKey } : { kind: "skin" };
  if (m[1] === "lib") return LIB_ID_RE.test(m[2]!) ? { kind: "lib", id: m[2]! } : { kind: "skin" };
  return UP_ID_RE.test(m[2]!) ? { kind: "up", id: m[2]! } : { kind: "skin" };
}

/** La valeur à enregistrer pour un choix (`""` = celle du skin : la clé est supprimée). */
export function choiceValue(c: FontChoice): string {
  return c.kind === "skin" ? "" : c.kind === "sys" ? `sys:${c.key}` : `${c.kind}:${c.id}`;
}

/** Texte d'un formulaire → valeur à enregistrer (forme vérifiée seulement : l'existence de la police se lit au rendu). */
export function normalizeChoice(v: unknown): string {
  return choiceValue(parseChoice(v));
}

export type FontFile = { file: string; weight: number; style: "normal"; subset: "latin" | "latin-ext"; bytes: number; sha256: string };

export type LibraryFamily = {
  id: string;
  name: string;
  group: FontGroup;
  /** Famille générique de repli dans la pile (`sans-serif`, `serif`, `cursive`, `monospace`). */
  generic: "sans-serif" | "serif" | "cursive" | "monospace";
  weights: number[];
  author: string;
  source: string;
  license: string;
  licenseFile: string;
  copyright: string;
  files: FontFile[];
};

export type UploadedFont = {
  /** Empreinte du contenu (16 premiers caractères hexadécimaux de SHA-256) : nom du fichier et fin de son adresse. */
  id: string;
  /** Nom de la police tel que la personne le voit. */
  family: string;
  /** Identifiant de la famille (partagé par les graisses d'une même police) : `up:<slug>`. */
  slug: string;
  /** « 400 », « 700 » ou une plage (police variable) : « 100 900 ». */
  weight: string;
  style: "normal" | "italic";
  bytes: number;
  addedAt: string;
};

/** Plafonds de l'envoi (docs/POLICES.md). */
export const UPLOAD_LIMITS = { maxBytes: 150 * 1024, maxFiles: 4, maxName: 60 } as const;

/** Réglages : les deux choix, et la liste des polices envoyées. */
export const SETTING_HEADING = "theme.fontHeading";
export const SETTING_BODY = "theme.fontBody";
export const SETTING_FILES = "theme.fontFiles";

export type Role = "heading" | "body";

/** Conseils (jamais un blocage) : la police est TOUJOURS appliquée. */
export type AdviceCode = "no-bold" | "title-font-for-text" | "mono-for-text";

/** Ce que le conseil sait d'une police : son groupe et les graisses qu'elle apporte (400 = normale, 700 = grasse). */
export type AdviceInfo = { group: FontGroup | "upload" | "system"; weights: readonly number[]; mono?: boolean };

/**
 * Conseils pour une police choisie. Le texte courant s'écrit en normal et en gras (mots importants) : une police sans gras est simulée par le navigateur, ce qui
 * se voit. Les titres sont gras par défaut : le conseil vaut aussi pour eux. Une police d'affiche ou manuscrite fatigue sur un long texte.
 */
export function fontAdvice(role: Role, info: AdviceInfo | null): AdviceCode[] {
  if (!info) return [];
  const out: AdviceCode[] = [];
  if (info.group !== "system" && !info.weights.includes(700)) out.push("no-bold");
  if (role === "body") {
    if (info.group === "display" || info.group === "handwriting") out.push("title-font-for-text");
    else if (info.group === "mono") out.push("mono-for-text");
  }
  return out;
}
