/**
 * Logique pure du champ période (testée sans navigateur) : les dates « AAAA-MM-JJ » des sélecteurs natifs et le raccourci « Tout le mois de [mois] ».
 */
import { parsePeriod, serializePeriod, wholeMonth, wholeMonthOf, type DayRef, type OpenPeriod, type Period } from "./values";

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

/**
 * Les dates affichées par les deux sélecteurs pour une valeur enregistrée (« chaque année » : l'année de référence, la fin au printemps suivant si elle enjambe le 31 décembre).
 * Sans valeur (ou illisible), c'est une période NOUVELLE : « chaque année » n'est pas coché, une annonce ponctuelle ne doit pas revenir toute seule. Une valeur déjà enregistrée garde
 * son sens, « chaque année » compris.
 */
export function toInputs(raw: string, refYear: number, openEnded = false): { from: string; to: string; yearly: boolean } {
  const parsed = parsePeriod(raw, { openEnded });
  if (!parsed.ok) return { from: "", to: "", yearly: false };
  const p = parsed.period;
  if (!p.yearly) return { from: p.from ? ymd(p.from.y, p.from.m, p.from.d) : "", to: p.to ? ymd(p.to.y, p.to.m, p.to.d) : "", yearly: false };
  const wraps = p.from.m * 100 + p.from.d > p.to.m * 100 + p.to.d;
  // Un 29 février doit tomber dans une année bissextile pour que le sélecteur de date le montre : on avance l'année de référence au besoin.
  let base = refYear;
  for (let i = 0; i < 4; i++, base++) {
    const fy = base, ty = wraps ? base + 1 : base;
    if ((!isFeb29(p.from) || isLeap(fy)) && (!isFeb29(p.to) || isLeap(ty))) break;
  }
  return { from: ymd(base, p.from.m, p.from.d), to: ymd(wraps ? base + 1 : base, p.to.m, p.to.d), yearly: true };
}

/** Ce que les sélecteurs disent en une valeur enregistrée ("" : incomplet), et la période pour l'aperçu. Avec `openEnded`, une seule date suffit (début seul ou fin seule). */
export function toPeriod(from: string, to: string, yearly: boolean, openEnded = false): Period | OpenPeriod | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from), t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  const day = (m: RegExpExecArray) => ({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  if (f && t) {
    const a = day(f), b = day(t);
    const p: Period = yearly ? { yearly: true, from: { m: a.m, d: a.d }, to: { m: b.m, d: b.d } } : { yearly: false, from: a, to: b };
    const checked = parsePeriod(serializePeriod(p));
    return checked.ok ? checked.period : null;
  }
  // Une période ouverte est toujours « une seule fois » : « chaque année » n'a de sens qu'avec les deux bouts.
  if (!openEnded || (!f && !t) || (f && to !== "") || (t && from !== "")) return null;
  const p: OpenPeriod = f ? { yearly: false, from: day(f), to: null } : { yearly: false, from: null, to: day(t!) };
  const checked = parsePeriod(serializePeriod(p), { openEnded: true });
  return checked.ok ? checked.period : null;
}

/**
 * Ce que disent les deux sélecteurs et l'interrupteur « Chaque année » (pur, testé sans navigateur) :
 * `oneSide` (période ouverte, un seul bout choisi : l'interrupteur se range), `yearlyOn` (« chaque année » réellement appliqué : jamais avec un seul bout),
 * `period` (ce qu'on enregistre et dit en une phrase, null tant que c'est incomplet ou impossible) et `wrongOrder` (une seule fois, la fin avant le début).
 */
export function periodState(from: string, to: string, yearly: boolean, openEnded: boolean): { oneSide: boolean; yearlyOn: boolean; period: Period | OpenPeriod | null; wrongOrder: boolean } {
  const oneSide = openEnded && (from === "") !== (to === "");
  const yearlyOn = yearly && !oneSide;
  return { oneSide, yearlyOn, period: toPeriod(from, to, yearlyOn, openEnded), wrongOrder: from !== "" && to !== "" && !yearlyOn && from > to };
}
