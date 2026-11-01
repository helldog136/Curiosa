/**
 * Logique pure du champ période (testée sans navigateur) : les dates « AAAA-MM-JJ » des sélecteurs natifs et le raccourci « Tout le mois de [mois] ».
 */
import { wholeMonth, wholeMonthOf, type DayRef } from "./values";

const two = (n: number) => (n < 10 ? `0${n}` : String(n));
export const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${two(m)}-${two(d)}`;

export const isLeap = (y: number) => new Date(Date.UTC(y, 2, 0)).getUTCDate() === 29;
export const isFeb29 = (x: DayRef) => x.m === 2 && x.d === 29;
const nextLeap = (y: number) => { let r = y; while (!isLeap(r)) r++; return r; };

/** Une date « AAAA-MM-JJ » des sélecteurs en jour ; sans l'année pour « chaque année » ; null si elle est vide ou illisible. */
export function dayOf(v: string, yearly: boolean): DayRef | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? (yearly ? { m: Number(m[2]), d: Number(m[3]) } : { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }) : null;
}

/** Le mois entier que montrent les deux sélecteurs (1 à 12), ou null : dès que les jours sont modifiés à la main, la liste « Tout le mois de » revient à « Choisir un mois ». */
export function monthShown(from: string, to: string, yearly: boolean): number | null {
  const f = dayOf(from, yearly), t = dayOf(to, yearly);
  return f && t ? wholeMonthOf(f, t) : null;
}

/** Les deux dates qu'écrit « Tout le mois de [mois] » : l'année de la date de début si elle est choisie (sinon `refYear`), février selon le calendrier ; « chaque année » : février finit le 29, sur une année bissextile. */
export function monthInputs(m: number, yearly: boolean, currentFrom: string, refYear: number): { from: string; to: string } {
  const y = yearly ? (m === 2 ? nextLeap(refYear) : refYear) : (dayOf(currentFrom, false)?.y ?? refYear);
  const w = wholeMonth(m, yearly ? undefined : y);
  if (!w) return { from: "", to: "" };
  return { from: ymd(y, w.from.m, w.from.d), to: ymd(y, w.to.m, w.to.d) };
}

