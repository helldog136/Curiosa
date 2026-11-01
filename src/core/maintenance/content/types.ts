import type { ProbeStatus } from "./probe";

/**
 * CONTRÔLE DU CONTENU — les formes des données gardées et échangées. Rien ici ne touche à la base ni au réseau.
 *
 * Importance : « important » (quelque chose est cassé ou invisible pour un visiteur), « advised » (conseillé : le site marche mais pourrait mieux), « info » (pour info).
 * Aucune note chiffrée : le résumé dit seulement « tout va bien » ou « quelques petites choses à regarder ».
 */
export type Severity = "important" | "advised" | "info";
export const SEVERITIES: readonly Severity[] = ["important", "advised", "info"];
export const SEVERITY_RANK: Record<Severity, number> = { important: 0, advised: 1, info: 2 };

/**
 * Où mène « Corriger » : jamais ailleurs que dans l'administration (voir fix.ts).
 *   e : une entrée      ["e", idEntrée, langue, cléInstance]
 *   l : la liste d'une rubrique ["l", cléInstance]
 *   i : la page d'une instance  ["i", idInstance]
 *   n : le menu · r : les raccourcis de liens · x : les réseaux sociaux
 *   s : les réglages ["s", "site" | "appearance"]
 */
export type Fix = ["e", string, string, string] | ["l", string] | ["i", string] | ["n"] | ["r"] | ["x"] | ["s", "site" | "appearance"];

/** Une ligne d'une remarque. `k` : clé stable (sert à « Ignorer »). `d` : détail court choisi par le type de remarque (voir view.ts). */
export type Item = { k: string; t: string; w?: string; u?: string; d?: (string | number)[]; f?: Fix | null };
export type Group = { id: string; loc: string | null; sev: Severity; count: number; /** Total d'images pour « alt » (count compte les pages). */ total?: number; items: Item[] };

export type LinkResult = { st: ProbeStatus | "skipped"; code?: number; why?: string; to?: string; ins?: 1 };
export type LinkSource = { f: Fix | null; w: string };
/** Un lien externe à visiter (ou déjà visité : `r`). Gardé le temps de la vérification seulement. */
export type LinkTask = { u: string; k: "link" | "image"; label: string; s: LinkSource[]; r?: LinkResult };

export type Stats = { instances: number; pages: number; images: number; links: number };
export type Notes = {
  /** Rubriques dont certaines entrées n'ont pas été lues (plafond atteint). */
  capped: boolean;
  /** Rubriques illisibles. */
  unreadable: string[];
  /** Liens vers des sites qu'on n'a pas visités faute de place, ou à la demande de la personne. */
  skipped: { host: number; ignored: number };
  /** L'accueil est servi par une fonctionnalité dont on ne lit pas le texte. */
  modulePages: boolean;
  multi: boolean;
};
export type LinkTotals = { found: number; from: number; count: number; window: boolean };

export type Report = {
  cid: string;
  at: string;
  finished: boolean;
  doneAt?: string;
  stats: Stats;
  linkTotals: LinkTotals;
  notes: Notes;
  locales: string[];
  linksOff: boolean;
  groups: Group[];
  progress: { done: number; total: number } | null;
  counts?: Record<Severity, number>;
  /** Demandé par un assistant IA ou par une personne. */
  by?: "admin" | "ai";
};

export type Run = { cid: string; at: string; links: LinkTask[]; /** Site → fin de pause (« trop de demandes »). */ paused: Record<string, number>; busyUntil: number };
export type State = { cursor: number };
export type HistoryEntry = { at: string; doneAt: string; counts: Record<Severity, number>; ok: boolean; pages: number; links: number };

/** Le petit résumé lu partout (tableau de bord, diagnostic) sans charger le rapport. */
export type Summary = {
  at: string;
  finished: boolean;
  doneAt?: string;
  counts: Record<Severity, number>;
  progress: { done: number; total: number } | null;
  groups: { id: string; loc: string | null; sev: Severity; count: number }[];
};

export type Settings = { checkLinks: boolean; skipHosts: string };
