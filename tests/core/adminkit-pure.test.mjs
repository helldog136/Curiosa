// Kit d'administration (lot 1) : la logique pure des briques réutilisables (recherche en direct, période, date et heure, durée, nombre borné, tableau enrichi,
// textes d'aide et d'erreur, résumé de « Plus d'options »), puis leur branchement dans le moteur de réglages (types, manifeste, validation).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const S = await import("@/core/adminkit/search");
const V = await import("@/core/adminkit/values");
const PI = await import("@/core/adminkit/periodInputs");
const PP = await import("@/core/adminkit/periodPresets");
const T = await import("@/core/adminkit/table");
const H = await import("@/core/adminkit/hints");
const Sum = await import("@/core/adminkit/summary");
const { checkFieldInput } = await import("@/core/modules/settingValues");
const { settingField } = await import("@/core/modules/manifest");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const tr = makeTranslator("fr");

/* ───────────── recherche en direct ───────────── */

test("recherche : sans seuil, sans casse ni accents, tous les mots doivent être présents", () => {
  const hay = S.searchText(["Éléphant Rose", "https://zoo.example/Éléphants", null, false, 12]);
  assert.equal(hay, "elephant rose https://zoo.example/elephants 12");
  assert.equal(S.matchesSearch(hay, ""), true, "une recherche vide laisse tout passer");
  assert.equal(S.matchesSearch(hay, "e"), true, "une seule lettre filtre déjà (aucun seuil)");
  assert.equal(S.matchesSearch(hay, "ÉLÉPHANT"), true);
  assert.equal(S.matchesSearch(hay, "elephant   rose"), true);
  assert.equal(S.matchesSearch(hay, "rose zebre"), false, "tous les mots, pas un seul");
  assert.equal(S.matchesSearch(hay, "12"), true);
  assert.deepEqual(S.queryWords("  À  Table "), ["a", "table"]);
});

test("recherche : pastilles de filtre, valeurs distinctes avec leur nombre, pagination à 50", () => {
  const row = { haystack: "twitch", origin: "Les vôtres", state: "on" };
  assert.equal(S.rowPasses(row, "tw", {}), true);
  assert.equal(S.rowPasses(row, "tw", { origin: "Les vôtres" }), true);
  assert.equal(S.rowPasses(row, "tw", { origin: "Partenaires" }), false);
  assert.equal(S.rowPasses(row, "tw", { origin: "all" }), true, "« Tout » ne filtre pas");
  assert.equal(S.rowPasses(row, "yt", { origin: "Les vôtres" }), false);
  assert.deepEqual(S.pillOptions(["A", "B", "A", "", "C", "A"]), [{ value: "A", count: 3 }, { value: "B", count: 1 }, { value: "C", count: 1 }]);
  assert.equal(S.TABLE_PAGE_SIZE, 50, "R15 : 50 au plus");
  const rows = Array.from({ length: 120 }, (_, i) => i);
  assert.equal(S.pageSlice(rows, 1, 50).items.length, 50);
  assert.deepEqual(S.pageSlice(rows, 3, 50), { items: rows.slice(100), page: 3, pages: 3 });
  assert.equal(S.pageSlice(rows, 99, 50).page, 3, "page hors limites ramenée à la dernière");
  assert.equal(S.pageSlice(rows, -2, 50).page, 1);
  assert.equal(S.pageSlice(rows, 1, 0).items.length, 120, "taille 0 : tout sur une page");
  assert.equal(S.pageSlice([], 1, 50).pages, 1);
});

/* ───────────── période ───────────── */

test("période : chaque année ou une seule fois, vérifiée, en toutes lettres, avec le jour qui tombe dedans", () => {
  const y = V.parsePeriod("11-01/11-30");
  assert.ok(y.ok && y.period.yearly);
  assert.equal(V.serializePeriod(y.period), "11-01/11-30");
  const o = V.parsePeriod("2026-11-01/2026-11-30");
  assert.ok(o.ok && !o.period.yearly);
  assert.equal(V.serializePeriod(o.period), "2026-11-01/2026-11-30");
  assert.deepEqual(V.parsePeriod("11-31/12-01"), { ok: false, reason: "date" }, "pas de 31 novembre");
  assert.ok(V.parsePeriod("02-29/03-01").ok, "chaque année accepte le 29 février");
  assert.deepEqual(V.parsePeriod("2027-02-29/2027-03-01"), { ok: false, reason: "date" }, "mais pas en 2027");
  assert.deepEqual(V.parsePeriod("2026-11-30/2026-11-01"), { ok: false, reason: "order" });
  assert.deepEqual(V.parsePeriod("1990-01-01/1990-02-01"), { ok: false, reason: "date" });
  for (const bad of ["", "novembre", "11/01-11/30", "11-01", "11-01/11-30/12-01"]) assert.deepEqual(V.parsePeriod(bad), { ok: false, reason: "format" }, bad);
  const tpl = { yearly: "Du {from} au {to}, chaque année", once: "Du {from} au {to}" };
  assert.equal(V.describePeriod(y.period, "fr", tpl), "Du 1er novembre au 30 novembre, chaque année");
  assert.equal(V.describePeriod(o.period, "fr", tpl), "Du 1er novembre 2026 au 30 novembre 2026");
  assert.equal(V.describePeriod(y.period, "en", { yearly: "From {from} to {to}, every year", once: "" }), "From 1 November to 30 November, every year");
  // Enjamber le 31 décembre : « chaque année » seulement.
  const wrap = V.parsePeriod("12-20/01-05").period;
  assert.equal(V.periodContains(wrap, { y: 2026, m: 12, d: 25 }), true);
  assert.equal(V.periodContains(wrap, { y: 2027, m: 1, d: 3 }), true);
  assert.equal(V.periodContains(wrap, { y: 2026, m: 6, d: 1 }), false);
  assert.equal(V.periodContains(y.period, { y: 1999, m: 11, d: 15 }), true, "chaque année : l'année ne compte pas");
  assert.equal(V.periodContains(o.period, { y: 2027, m: 11, d: 15 }), false, "une seule fois : l'année compte");
});

test("période : « Tout le mois de » couvre 28, 29, 30 et 31 jours, selon l'année", () => {
  const last = (m, y) => V.wholeMonth(m, y).to.d;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => last(m, 2027)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(last(2, 2028), 29, "année bissextile");
  assert.equal(last(2, 2100), 28, "2100 n'est pas bissextile");
  assert.equal(last(2, 2000), 29);
  assert.deepEqual(V.wholeMonth(11, 2026), { from: { m: 11, d: 1, y: 2026 }, to: { m: 11, d: 30, y: 2026 } });
  assert.equal(V.wholeMonth(13), null); assert.equal(V.wholeMonth(0), null);
  // Chaque année (sans année) : février finit le 29, la règle du cœur (parsePeriod l'accepte, periodContains compare mois et jour).
  assert.deepEqual(V.wholeMonth(2), { from: { m: 2, d: 1 }, to: { m: 2, d: 29 } });
  const feb = V.parsePeriod(V.serializePeriod({ yearly: true, ...V.wholeMonth(2) }));
  assert.ok(feb.ok);
  assert.equal(V.periodContains(feb.period, { y: 2027, m: 2, d: 28 }), true);
  assert.equal(V.periodContains(feb.period, { y: 2028, m: 2, d: 29 }), true);
  assert.equal(V.periodContains(feb.period, { y: 2027, m: 3, d: 1 }), false);
  for (let m = 1; m <= 12; m++) {
    const w = V.wholeMonth(m);
    assert.ok(V.parsePeriod(V.serializePeriod({ yearly: true, ...w })).ok, `mois ${m} chaque année`);
    assert.ok(V.parsePeriod(V.serializePeriod({ yearly: false, ...V.wholeMonth(m, 2027) })).ok, `mois ${m} une fois`);
  }
});

test("période : reconnaître un mois entier, noms FR et EN", () => {
  assert.equal(V.wholeMonthOf({ m: 11, d: 1 }, { m: 11, d: 30 }), 11);
  assert.equal(V.wholeMonthOf({ m: 2, d: 1 }, { m: 2, d: 29 }), 2);
  assert.equal(V.wholeMonthOf({ m: 2, d: 1 }, { m: 2, d: 28 }), null, "chaque année : le 28 ne couvre pas tout février");
  assert.equal(V.wholeMonthOf({ m: 2, d: 1, y: 2027 }, { m: 2, d: 28, y: 2027 }), 2);
  assert.equal(V.wholeMonthOf({ m: 2, d: 1, y: 2028 }, { m: 2, d: 28, y: 2028 }), null, "2028 est bissextile");
  assert.equal(V.wholeMonthOf({ m: 11, d: 2 }, { m: 11, d: 30 }), null);
  assert.equal(V.wholeMonthOf({ m: 11, d: 1 }, { m: 12, d: 30 }), null);
  assert.equal(V.wholeMonthOf({ m: 11, d: 1, y: 2026 }, { m: 11, d: 30, y: 2027 }), null);
  assert.equal(V.monthName(11, "fr"), "novembre"); assert.equal(V.monthName(2, "fr"), "février");
  assert.equal(V.monthName(11, "en"), "November"); assert.equal(V.monthName(8, "fr"), "août");
});

test("période : le choix d'un mois remplit les deux dates, la liste revient à « Choisir un mois » dès qu'un jour change", () => {
  // Chaque année : l'année de référence sert seulement à l'affichage.
  assert.deepEqual(PI.monthInputs(11, true, "", 2026), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(PI.monthInputs(2, true, "", 2026), { from: "2028-02-01", to: "2028-02-29" }, "février : une année bissextile pour montrer le 29");
  // Une seule fois : l'année de la date de début si elle est choisie, sinon l'année de référence.
  assert.deepEqual(PI.monthInputs(2, false, "2027-05-10", 2026), { from: "2027-02-01", to: "2027-02-28" });
  assert.deepEqual(PI.monthInputs(2, false, "2028-05-10", 2026), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(PI.monthInputs(2, false, "", 2026), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(PI.monthInputs(12, false, "", 2026), { from: "2026-12-01", to: "2026-12-31" });
  // Le sélecteur suit les jours.
  assert.equal(PI.monthShown("2026-11-01", "2026-11-30", true), 11);
  assert.equal(PI.monthShown("2026-11-01", "2026-11-30", false), 11);
  assert.equal(PI.monthShown("2026-11-02", "2026-11-30", false), null, "début modifié à la main");
  assert.equal(PI.monthShown("2026-11-01", "2026-11-29", true), null, "fin modifiée à la main");
  assert.equal(PI.monthShown("2026-11-01", "", true), null);
  assert.equal(PI.monthShown("", "", true), null);
  assert.equal(PI.monthShown("2026-11-01", "2027-11-30", false), null, "deux années différentes");
  assert.equal(PI.monthShown("2028-02-01", "2028-02-29", true), 2);
  // Un 29 février enregistré « chaque année » reste affichable.
  assert.equal(PI.monthShown(...Object.values(PI.monthInputs(2, true, "", 2026)), true), 2);
});

test("périodes toutes prêtes : Pâques sur des années connues, bissextile compris", () => {
  const easter = (y) => { const e = PP.easterSunday(y); return `${e.y}-${String(e.m).padStart(2, "0")}-${String(e.d).padStart(2, "0")}`; };
  for (const [y, d] of [[2024, "2024-03-31"], [2025, "2025-04-20"], [2026, "2026-04-05"], [2027, "2027-03-28"], [2028, "2028-04-16"], [2038, "2038-04-25"], [2000, "2000-04-23"]]) assert.equal(easter(y), d, `Pâques ${y}`);
  // week-end pascal : vendredi saint → lundi de Pâques ; carnaval : dimanche gras → mardi gras
  assert.equal(PP.presetValue("easter", { y: 2026, m: 1, d: 10 }), "2026-04-03/2026-04-06");
  assert.equal(PP.presetValue("carnival", { y: 2026, m: 1, d: 10 }), "2026-02-15/2026-02-17");
  assert.equal(PP.presetValue("easter", { y: 2028, m: 1, d: 1 }), "2028-04-14/2028-04-17", "année bissextile");
  assert.equal(PP.presetValue("carnival", { y: 2028, m: 1, d: 1 }), "2028-02-27/2028-02-29", "le mardi gras tombe un 29 février");
  // la prochaine occurrence : en cours = encore elle ; passée = l'an suivant
  assert.equal(PP.presetValue("easter", { y: 2026, m: 4, d: 6 }), "2026-04-03/2026-04-06", "le dernier jour compte encore");
  assert.equal(PP.presetValue("easter", { y: 2026, m: 4, d: 7 }), "2027-03-26/2027-03-29");
  assert.equal(PP.presetValue("easter", { y: 2026, m: 12, d: 31 }), "2027-03-26/2027-03-29");
});

test("périodes toutes prêtes : fêtes lunaires, chinoise et juives calculées avec Intl (vérifiées sur des dates connues)", () => {
  const v = (id, y, m, d) => PP.presetValue(id, { y, m, d });
  assert.equal(v("ramadan", 2026, 1, 1), "2026-02-18/2026-03-19");
  assert.equal(v("eidFitr", 2026, 1, 1), "2026-03-20/2026-03-22");
  assert.equal(v("eidAdha", 2026, 1, 1), "2026-05-27/2026-05-29");
  assert.equal(v("chineseNewYear", 2026, 1, 1), "2026-02-17/2026-03-03");
  assert.equal(v("chineseNewYear", 2025, 1, 1), "2025-01-29/2025-02-12");
  assert.equal(v("passover", 2026, 1, 1), "2026-04-02/2026-04-09");
  assert.equal(v("roshHashanah", 2026, 1, 1), "2026-09-12/2026-09-13");
  assert.equal(v("yomKippur", 2026, 1, 1), "2026-09-21/2026-09-21");
  assert.equal(v("hanukkah", 2026, 1, 1), "2026-12-05/2026-12-12");
  assert.equal(v("hanukkah", 2026, 12, 20), "2027-12-25/2028-01-01", "passée : la suivante, à cheval sur deux années");
  assert.equal(v("ramadan", 2026, 3, 1), "2026-02-18/2026-03-19", "en cours : encore elle");
  // Toujours une occurrence, quelle que soit la date du jour, et toujours une période que le cœur accepte.
  for (const id of ["ramadan", "eidFitr", "eidAdha", "chineseNewYear", "hanukkah", "passover", "roshHashanah", "yomKippur", "easter", "carnival"]) {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 17 * 86_400_000) {
      const x = new Date(t), val = PP.presetValue(id, { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() });
      assert.ok(val && /^\d{4}-/.test(val) && V.parsePeriod(val).ok, `${id} ${x.toISOString().slice(0, 10)} : ${val}`);
      const end = val.split("/")[1];
      assert.ok(end >= x.toISOString().slice(0, 10), `${id} : la période n'est pas finie`);
    }
  }
});

test("périodes toutes prêtes : saisons et fêtes fixes en « chaque année », fêtes mobiles jamais", () => {
  const today = { y: 2026, m: 11, d: 1 };
  assert.equal(PP.presetValue("winter", today), "12-21/03-19", "l'hiver chevauche l'année");
  assert.equal(PP.presetValue("newYear", today), "12-31/01-02");
  assert.equal(PP.presetValue("spring", today), "03-20/06-20");
  assert.equal(PP.presetValue("halloween", today), "10-25/10-31");
  assert.equal(PP.presetValue("nope", today), null);
  // Les saisons se suivent sans trou ni recouvrement.
  const next = (md) => { const [m, d] = md.split("-").map(Number); const t = new Date(Date.UTC(2027, m - 1, d + 1)); return `${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`; };
  const seasons = ["spring", "summer", "autumn", "winter"].map((id) => PP.presetValue(id, today).split("/"));
  for (let i = 0; i < 4; i++) assert.equal(next(seasons[i][1]), seasons[(i + 1) % 4][0], `la saison ${i} est suivie de la suivante`);
  for (const p of PP.PRESETS) {
    const val = PP.presetValue(p.id, today), parsed = V.parsePeriod(val);
    assert.ok(parsed.ok, p.id);
    assert.equal(parsed.period.yearly, p.group !== "movable", `${p.id} : chaque année seulement si la date est fixe`);
    assert.equal(PP.isMovable(p.id), p.group === "movable");
  }
  assert.equal(new Set(PP.PRESETS.map((p) => p.id)).size, PP.PRESETS.length);
});

test("périodes toutes prêtes : chaque période a son nom en FR et en EN, les mêmes groupes, textes neutres", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = [...PP.PRESETS.map((p) => `period.preset.${p.id}`), "period.preset", "period.presetPick", "period.presetSearch", "period.presetEmpty", "period.presetClear", "period.presetNote", "period.presetMoon", "period.presetEve", ...["season", "fixed", "movable"].map((g) => `period.presetGroup.${g}`)];
  for (const k of keys) { assert.ok(typeof fr[k] === "string" && fr[k], `fr ${k}`); assert.ok(typeof en[k] === "string" && en[k], `en ${k}`); assert.ok(fr[k].length <= 60 && en[k].length <= 60, `${k} : 60 caractères au plus`); assert.doesNotMatch(fr[k] + en[k], /!|Veuillez|[:]\s*$/); }
  for (const k of Object.keys(fr).filter((x) => x.startsWith("period."))) assert.ok(k in en, `en ${k}`);
  for (const k of Object.keys(en).filter((x) => x.startsWith("period."))) assert.ok(k in fr, `fr ${k}`);
  const vars = (x) => (x.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of keys) assert.equal(vars(fr[k]), vars(en[k]), `${k} : mêmes {variables}`);
  // Un nom de fête garde son vrai nom (Noël, Pâques…), distinct dans chaque langue.
  assert.equal(fr["period.preset.christmas"], "Noël"); assert.equal(en["period.preset.christmas"], "Christmas");
  assert.equal(new Set(PP.PRESETS.map((p) => fr[`period.preset.${p.id}`])).size, PP.PRESETS.length);
});

/* ───────────── date et heure, durée, nombre ───────────── */

test("date et heure : réelles, en toutes lettres", () => {
  assert.equal(V.checkDateTime("2026-11-30T18:30"), true);
  for (const bad of ["2026-11-30", "2026-11-31T10:00", "2026-11-30T24:00", "2026-11-30T10:60", "30/11/2026 18:30", "1999-01-01T00:00", ""]) assert.equal(V.checkDateTime(bad), false, bad);
  assert.equal(V.describeDateTime("2026-11-30T18:30", "fr", "à"), "30 novembre 2026 à 18:30");
  assert.equal(V.describeDate("2026-11-01", "fr"), "1er novembre 2026");
  assert.equal(V.describeDate("2026-11-01", "en"), "1 November 2026");
});

test("durée : un nombre entier de secondes, l'unité la plus grande qui tombe juste, bornes, phrase", () => {
  assert.deepEqual(V.splitDuration(5400), { n: 90, unit: "min" });
  assert.deepEqual(V.splitDuration(7200), { n: 2, unit: "h" });
  assert.deepEqual(V.splitDuration(86400 * 3), { n: 3, unit: "d" });
  assert.deepEqual(V.splitDuration(45), { n: 45, unit: "s" });
  assert.deepEqual(V.splitDuration(0), { n: 0, unit: "s" });
  assert.deepEqual(V.splitDuration(7200, ["s", "min"]), { n: 120, unit: "min" }, "seulement les unités permises");
  assert.equal(V.joinDuration(90, "min"), 5400);
  assert.deepEqual(V.durationUnits(), ["s", "min", "h", "d"]);
  assert.deepEqual(V.durationUnits(3600), ["s", "min", "h"], "pas de jours sous un maximum d'une heure");
  assert.deepEqual(V.durationUnits(30), ["s"]);
  assert.deepEqual(V.checkDuration("90", { min: 5, max: 3600 }), { ok: true, value: 90 });
  assert.deepEqual(V.checkDuration("3", { min: 5 }), { ok: false, reason: "range" });
  assert.deepEqual(V.checkDuration("9999", { max: 3600 }), { ok: false, reason: "range" });
  for (const bad of ["", "1.5", "-4", "abc", "1e3"]) assert.deepEqual(V.checkDuration(bad), { ok: false, reason: "duration" }, bad);
  assert.equal(V.describeDuration(5400, "j"), "1 h 30 min");
  assert.equal(V.describeDuration(45, "j"), "45 s");
  assert.equal(V.describeDuration(90000, "j"), "1 j 1 h");
});

test("nombre borné : bornes, pas, exemple", () => {
  assert.deepEqual(V.checkBoundedNumber("60", { min: 5, max: 3600 }), { ok: true, value: 60 });
  assert.deepEqual(V.checkBoundedNumber("4", { min: 5, max: 3600 }), { ok: false, reason: "range" });
  assert.deepEqual(V.checkBoundedNumber("1,5", {}), { ok: true, value: 1.5 }, "la virgule française est comprise");
  assert.deepEqual(V.checkBoundedNumber("abc", {}), { ok: false, reason: "number" });
  assert.deepEqual(V.checkBoundedNumber("", {}), { ok: false, reason: "number" });
  assert.deepEqual(V.checkBoundedNumber("15", { min: 5, step: 5 }), { ok: true, value: 15 });
  assert.deepEqual(V.checkBoundedNumber("17", { min: 5, step: 5 }), { ok: false, reason: "range" });
  assert.deepEqual(V.checkBoundedNumber("0.3", { min: 0, step: 0.1 }), { ok: true, value: 0.3 }, "pas décimal sans erreur d'arrondi");
  assert.equal(V.exampleNumber({ min: 5, max: 3600, default: 60 }), 60, "le défaut quand il est dans les bornes");
  assert.equal(V.exampleNumber({ min: 5, max: 3600, default: 99999 }), 1803);
  assert.equal(V.exampleNumber({ min: 1 }), 1);
});

/* ───────────── réglages : validation commune à l'admin, à l'assistant et aux migrations ───────────── */

test("réglages : checkFieldInput comprend période, date et heure, durée et nombre borné ; un nombre sans borne reste comme avant", () => {
  assert.deepEqual(checkFieldInput({ type: "period" }, "11-01/11-30"), { ok: true, value: "11-01/11-30" });
  assert.deepEqual(checkFieldInput({ type: "period" }, "11-32/11-30"), { ok: false, reason: "period" });
  assert.deepEqual(checkFieldInput({ type: "datetime" }, "2026-11-30T18:30"), { ok: true, value: "2026-11-30T18:30" });
  assert.deepEqual(checkFieldInput({ type: "datetime" }, "demain"), { ok: false, reason: "datetime" });
  assert.deepEqual(checkFieldInput({ type: "duration", min: 5, max: 3600 }, "90"), { ok: true, value: 90 });
  assert.deepEqual(checkFieldInput({ type: "duration", min: 5, max: 3600 }, "2"), { ok: false, reason: "range" });
  assert.deepEqual(checkFieldInput({ type: "duration" }, "1.5"), { ok: false, reason: "duration" });
  assert.deepEqual(checkFieldInput({ type: "number", min: 1, max: 10 }, "11"), { ok: false, reason: "range" });
  assert.deepEqual(checkFieldInput({ type: "number", min: 1, max: 10 }, "7"), { ok: true, value: 7 });
  // Compatibilité : sans borne, exactement l'ancienne règle (Number() fini).
  assert.deepEqual(checkFieldInput({ type: "number" }, "-5"), { ok: true, value: -5 });
  assert.deepEqual(checkFieldInput({ type: "number" }, "1e20"), { ok: true, value: 1e20 });
  assert.deepEqual(checkFieldInput({ type: "number" }, "abc"), { ok: false, reason: "number" });
});

const field = (extra) => ({ key: "k", label: "K", ...extra });

test("manifeste : les nouveaux types et clés sont acceptés, les contresens refusés", () => {
  const ok = (f) => assert.equal(settingField.safeParse(field(f)).success, true, JSON.stringify(f));
  const bad = (f, why) => assert.equal(settingField.safeParse(field(f)).success, false, why);
  ok({ type: "period", default: "11-01/11-30", example: "du 1er au 30 novembre" });
  ok({ type: "datetime", default: "2026-11-30T18:30" });
  ok({ type: "duration", min: 5, max: 3600, default: 60 });
  ok({ type: "number", min: 0, max: 100, step: 5, unit: { fr: "%", en: "%" }, default: 50 });
  ok({ type: "select", display: "segmented", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
  ok({ type: "text", rare: true, example: "insta, ig" });
  bad({ type: "period", default: "novembre" }, "défaut de période illisible");
  bad({ type: "datetime", default: "2026-11-30" }, "défaut sans heure");
  bad({ type: "duration", default: 1.5 }, "durée non entière");
  bad({ type: "duration", step: 5 }, "pas sur une durée");
  bad({ type: "period", translatable: true }, "période traduisible");
  bad({ type: "text", min: 1 }, "bornes sur un texte");
  bad({ type: "text", unit: "s" }, "unité sur un texte");
  bad({ type: "number", min: 10, max: 1 }, "min > max");
  bad({ type: "select", display: "segmented", options: [{ value: "a", label: "A" }] }, "1 seul choix");
  bad({ type: "select", display: "segmented", options: ["a", "b", "c", "d", "e"].map((v) => ({ value: v, label: v })) }, "5 choix");
  bad({ type: "text", display: "segmented" }, "segmenté sur un texte");
  bad({ type: "text", rare: true, advanced: true }, "rare et avancé");
});

/* ───────────── tableau enrichi ───────────── */

test("tableau : enrichi seulement si le module l'a demandé (sinon le rendu d'avant)", () => {
  const base = { type: "table", columns: ["A"], rows: [["x"]] };
  assert.equal(T.isEnhancedTable(base), false);
  assert.equal(T.isEnhancedTable({ ...base, rowIds: ["1"], rowActions: [{ label: "Modifier", action: "edit" }, { label: "Supprimer", action: "del", danger: true }] }), false, "les anciens boutons de ligne gardent leur rendu");
  assert.equal(T.isEnhancedTable({ ...base, searchable: true }), true);
  assert.equal(T.isEnhancedTable({ ...base, filters: [{ column: 0 }] }), true);
  assert.equal(T.isEnhancedTable({ ...base, truncate: [0] }), true);
  assert.equal(T.isEnhancedTable({ ...base, pageSize: 20 }), true);
  assert.equal(T.isEnhancedTable({ ...base, empty: "Rien" }), true);
  assert.equal(T.isEnhancedTable({ ...base, rows: [[{ text: "Les vôtres", badge: "accent" }]] }), true);
  assert.equal(T.isEnhancedTable({ ...base, rowActions: [{ label: "x", action: "y", inMenu: true }] }), true);
  assert.equal(T.isEnhancedTable({ ...base, searchable: false }), false);
});

test("tableau : deux actions visibles au plus, les autres, les destructives et inMenu dans « ⋯ »", () => {
  const a = (label, extra = {}) => ({ label, action: label, ...extra });
  assert.deepEqual(T.splitActions([a("Modifier"), a("Supprimer", { danger: true })]), { visible: [a("Modifier")], menu: [a("Supprimer", { danger: true })] });
  const r = T.splitActions([a("1"), a("2"), a("3"), a("4")]);
  assert.deepEqual(r.visible.map((x) => x.label), ["1", "2"]);
  assert.deepEqual(r.menu.map((x) => x.label), ["3", "4"]);
  assert.deepEqual(T.splitActions([a("1", { inMenu: true }), a("2"), a("3")]).visible.map((x) => x.label), ["2", "3"]);
  assert.equal(T.VISIBLE_ACTIONS, 2);
  assert.equal(T.cellText({ text: "ok", badge: "ok" }), "ok");
  assert.equal(T.cellText("x"), "x");
  assert.equal(T.cellText({ switch: { on: true, action: "t", label: "Commande active" } }), "Commande active");
});

/* ───────────── textes d'aide et d'erreur ───────────── */

test("indication d'un nombre borné : bornes, pas, valeur quand le champ reste vide", () => {
  assert.equal(H.numberHint(tr, { type: "number", min: 5, max: 3600, default: 30 }, "secondes"), "Entre 5 et 3600 secondes · Vide : 30 secondes");
  assert.equal(H.numberHint(tr, { type: "number", min: 1 }), "1 au moins");
  assert.equal(H.numberHint(tr, { type: "number", max: 10, step: 2 }), "10 au plus · par pas de 2");
  assert.equal(H.numberHint(tr, { type: "duration", min: 5, max: 3600, default: 90 }), "Entre 5 s et 1 h · Vide : 1 min 30 s");
  assert.equal(H.numberHint(tr, { type: "number" }), "");
});

test("erreur d'un nombre ou d'une date : dit les bornes et donne TOUJOURS un exemple, sans code", () => {
  const msg = (reason, f) => { const e = H.valueErrorKey(reason, f, tr); return tr(e.key, { field: "Délai", ...e.vars }); };
  assert.equal(msg("range", { type: "number", min: 5, max: 3600, default: 60 }), "« Délai » : écrivez un nombre entre 5 et 3600, par exemple 60.");
  assert.equal(msg("range", { type: "number", min: 1 }), "« Délai » : écrivez un nombre d'au moins 1, par exemple 1.");
  assert.equal(msg("range", { type: "number", max: 10 }), "« Délai » : écrivez un nombre d'au plus 10, par exemple 10.");
  assert.equal(msg("number", { type: "number" }), "« Délai » : écrivez un nombre, par exemple 10.");
  assert.match(msg("duration", { type: "duration" }), /par exemple 1 min 30 s/);
  assert.match(msg("range", { type: "duration", min: 5, max: 3600 }), /entre 5 s et 1 h, par exemple 30 min/);
  assert.match(msg("period", { type: "period" }), /par exemple du 1er novembre au 30 novembre/);
  assert.match(msg("datetime", { type: "datetime" }), /par exemple le 30 novembre 2026 à 18:30/);
  for (const r of ["number", "range", "duration", "period", "datetime"]) assert.doesNotMatch(msg(r, { type: "number", min: 1, max: 9 }), /erreur|\bNaN\b|undefined|\{/i);
});

test("résumé de « Plus d'options » : seulement ce qui est déjà réglé", () => {
  const fields = [
    { key: "end", label: "Fin", type: "datetime" },
    { key: "msg", label: "Message", type: "text" },
    { key: "perm", label: "Permanent", type: "boolean", default: false },
    { key: "wait", label: "Attente", type: "duration", default: 30 },
    { key: "per", label: "Période", type: "period" },
  ];
  const stored = { end: "2026-11-30T18:30", msg: "", perm: false, wait: 30 };
  const r = Sum.summarizeGroup(fields, (k) => stored[k], "fr", tr);
  assert.equal(r.summary, "Fin : 30 novembre 2026 à 18:30");
  assert.equal(r.count, 1, "un message vide, un booléen au défaut et une durée au défaut ne comptent pas");
  const all = Sum.summarizeGroup(fields, (k) => ({ ...stored, msg: "Merci d'être venu, à bientôt pour la suite", perm: true, wait: 90, per: "11-01/11-30" })[k], "fr", tr);
  assert.equal(all.count, 5);
  assert.match(all.summary, /Message : Merci d'être venu, à bi…/);
  assert.match(all.summary, /Permanent/);
  assert.match(all.summary, /Attente : 1 min 30 s/);
  assert.match(all.summary, /Du 1er novembre au 30 novembre, chaque année/);
  assert.equal(Sum.summarizeGroup(fields, () => undefined, "fr", tr).summary, "");
});

/* ───────────── textes FR + EN ───────────── */

test("textes du kit : mêmes clés et mêmes {variables} en français et en anglais, vouvoiement, aucun point d'exclamation", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const kit = Object.keys(fr).filter((k) => /^(field\.(example|hint|summary)|unit\.|period\.|datetime\.|switch\.|search\.|table\.|instances\.error\.(number|range|duration|period|datetime)|instances\.s\.more|aim\.cfg\.(range|period|datetime|duration)|redirects\.(switch|endDate\.|state\.pill|state\.label|deleteMenu|moreHint))/.test(k));
  assert.ok(kit.length > 60, `les textes du kit existent (${kit.length})`);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of kit) {
    assert.ok(k in en, `${k} manque en anglais`);
    assert.equal(vars(fr[k]), vars(en[k]), `${k} : les {variables} diffèrent`);
    assert.ok(!/!/.test(fr[k]) && !/!/.test(en[k]), `${k} : pas de point d'exclamation`);
    assert.ok(!/\bveuillez\b|\btu\b|\bton\b/i.test(fr[k]), `${k} : vouvoiement`);
  }
});
