/**
 * Périodes toutes prêtes du champ période (pur, testé sans navigateur) : saisons, fêtes à date fixe, fêtes qui changent chaque année.
 *
 * Mêmes règles pour toutes : aucune fête n'est « par défaut » ni mise en avant ; la liste est rangée par date (saisons, fêtes fixes) ou par ordre
 * alphabétique du nom (fêtes mobiles, rangées à l'affichage). Le format enregistré ne change pas : `MM-JJ/MM-JJ` (chaque année) ou `AAAA-MM-JJ/AAAA-MM-JJ`.
 *
 *  - SAISONS et FÊTES À DATE FIXE : valeur « chaque année » (la fin peut passer le 31 décembre). Saisons de l'hémisphère nord, aux dates usuelles
 *    (l'astronomie varie d'un jour selon les années, ce sont des repères fixes).
 *  - FÊTES MOBILES : jamais « chaque année » (leurs dates changent). Le raccourci écrit les dates de la PROCHAINE occurrence (celle en cours si elle
 *    n'est pas finie), avec l'année. Calculs sans bibliothèque : Pâques par l'algorithme grégorien ; Ramadan, Aïd, Nouvel An chinois et fêtes juives par le
 *    calendrier de `Intl.DateTimeFormat` (islamic-umalqura, chinese, hebrew). Les fêtes musulmanes dépendent de l'observation de la lune (± 1 jour) ; les
 *    fêtes juives commencent la veille au soir.
 */

export type PresetGroup = "season" | "fixed" | "movable";
export type PresetNote = "moon" | "eve";
type Day = { m: number; d: number };
export type Preset = { id: string; group: PresetGroup; note?: PresetNote };
export type Today = { y: number; m: number; d: number };

/** Les périodes proposées, dans l'ordre d'affichage : saisons et fêtes fixes par date, fêtes mobiles par nom (l'affichage les trie dans la langue). */
export const PRESETS: readonly Preset[] = [
  { id: "spring", group: "season" }, { id: "summer", group: "season" }, { id: "autumn", group: "season" }, { id: "winter", group: "season" },
  { id: "epiphany", group: "fixed" }, { id: "valentine", group: "fixed" }, { id: "labour", group: "fixed" }, { id: "halloween", group: "fixed" },
  { id: "allSaints", group: "fixed" }, { id: "stNicholas", group: "fixed" }, { id: "christmas", group: "fixed" }, { id: "newYear", group: "fixed" },
  { id: "carnival", group: "movable" }, { id: "chineseNewYear", group: "movable" }, { id: "easter", group: "movable" }, { id: "eidAdha", group: "movable", note: "moon" },
  { id: "eidFitr", group: "movable", note: "moon" }, { id: "hanukkah", group: "movable", note: "eve" }, { id: "passover", group: "movable", note: "eve" },
  { id: "ramadan", group: "movable", note: "moon" }, { id: "roshHashanah", group: "movable", note: "eve" }, { id: "yomKippur", group: "movable", note: "eve" },
];

/** Dates fixes (chaque année). L'hiver et le Nouvel An passent le 31 décembre. */
const FIXED: Record<string, [Day, Day]> = {
  spring: [{ m: 3, d: 20 }, { m: 6, d: 20 }], summer: [{ m: 6, d: 21 }, { m: 9, d: 22 }], autumn: [{ m: 9, d: 23 }, { m: 12, d: 20 }], winter: [{ m: 12, d: 21 }, { m: 3, d: 19 }],
  epiphany: [{ m: 1, d: 6 }, { m: 1, d: 6 }], valentine: [{ m: 2, d: 14 }, { m: 2, d: 14 }], labour: [{ m: 5, d: 1 }, { m: 5, d: 1 }],
  halloween: [{ m: 10, d: 25 }, { m: 10, d: 31 }], allSaints: [{ m: 11, d: 1 }, { m: 11, d: 1 }], stNicholas: [{ m: 12, d: 6 }, { m: 12, d: 6 }],
  christmas: [{ m: 12, d: 24 }, { m: 12, d: 26 }], newYear: [{ m: 12, d: 31 }, { m: 1, d: 2 }],
};

/* ───────────── calcul des fêtes mobiles ───────────── */

const DAY_MS = 86_400_000;
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);
const dayOf = (t: number): Today => { const x = new Date(t); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const two = (n: number) => (n < 10 ? `0${n}` : String(n));
const iso = (x: Today) => `${String(x.y).padStart(4, "0")}-${two(x.m)}-${two(x.d)}`;

/** Dimanche de Pâques (calendrier grégorien) : algorithme de Meeus/Jones/Butcher. */
export function easterSunday(y: number): Today {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y, m: month, d: day };
}

/** Fêtes calculées depuis Pâques : [décalage du début, décalage de la fin] en jours. */
const EASTER_BASED: Record<string, [number, number]> = { easter: [-2, 1], carnival: [-49, -47] }; // week-end pascal : vendredi saint → lundi ; carnaval : dimanche gras → mardi gras

type Lunar = { cal: string; month: string; day: number; length: number | "month" };
const LUNAR: Record<string, Lunar> = {
  ramadan: { cal: "islamic-umalqura", month: "9", day: 1, length: "month" },
  eidFitr: { cal: "islamic-umalqura", month: "10", day: 1, length: 3 },
  eidAdha: { cal: "islamic-umalqura", month: "12", day: 10, length: 3 },
  chineseNewYear: { cal: "chinese", month: "1", day: 1, length: 15 }, // jusqu'à la fête des lanternes
  hanukkah: { cal: "hebrew", month: "Kislev", day: 25, length: 8 },
  passover: { cal: "hebrew", month: "Nisan", day: 15, length: 8 },
  roshHashanah: { cal: "hebrew", month: "Tishri", day: 1, length: 2 },
  yomKippur: { cal: "hebrew", month: "Tishri", day: 10, length: 1 },
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function calendarDay(cal: string, t: number): { month: string; day: number } {
  let f = formatters.get(cal);
  if (!f) { f = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, { day: "numeric", month: cal === "hebrew" ? "long" : "numeric", year: "numeric", timeZone: "UTC" }); formatters.set(cal, f); }
  const parts = f.formatToParts(new Date(t));
  return { month: parts.find((p) => p.type === "month")?.value ?? "", day: Number(parts.find((p) => p.type === "day")?.value) };
}

function lunarRange(spec: Lunar, today: Today): { from: Today; to: Today } | null {
  const t0 = utc(today.y, today.m, today.d);
  for (let t = t0 - 40 * DAY_MS; t <= t0 + 420 * DAY_MS; t += DAY_MS) {
    const c = calendarDay(spec.cal, t);
    if (c.month !== spec.month || c.day !== spec.day) continue;
    let end = t;
    if (spec.length === "month") { while (calendarDay(spec.cal, end + DAY_MS).day !== 1) end += DAY_MS; } else end = t + (spec.length - 1) * DAY_MS;
    if (end >= t0) return { from: dayOf(t), to: dayOf(end) };
  }
  return null;
}

function easterRange(id: string, today: Today): { from: Today; to: Today } {
  const [a, b] = EASTER_BASED[id] as [number, number];
  const t0 = utc(today.y, today.m, today.d);
  for (let y = today.y; ; y++) {
    const e = easterSunday(y), base = utc(e.y, e.m, e.d);
    if (base + b * DAY_MS >= t0) return { from: dayOf(base + a * DAY_MS), to: dayOf(base + b * DAY_MS) };
  }
}

/**
 * La valeur enregistrée d'une période toute prête : « MM-JJ/MM-JJ » (chaque année) pour les saisons et fêtes fixes ; « AAAA-MM-JJ/AAAA-MM-JJ » (la prochaine
 * occurrence, à partir de `today`) pour les fêtes mobiles. `null` : identifiant inconnu.
 */
export function presetValue(id: string, today: Today): string | null {
  const fixed = FIXED[id];
  if (fixed) return `${two(fixed[0].m)}-${two(fixed[0].d)}/${two(fixed[1].m)}-${two(fixed[1].d)}`;
  const r = EASTER_BASED[id] ? easterRange(id, today) : LUNAR[id] ? lunarRange(LUNAR[id], today) : null;
  return r ? `${iso(r.from)}/${iso(r.to)}` : null;
}

/** Une fête mobile n'est jamais « chaque année » : ses dates changent. */
export const isMovable = (id: string): boolean => PRESETS.some((p) => p.id === id && p.group === "movable");
