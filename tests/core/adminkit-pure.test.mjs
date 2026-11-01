// Kit d'administration (lot 1) : la logique pure des briques réutilisables (recherche en direct, période, date et heure, durée, nombre borné, tableau enrichi,
// textes d'aide et d'erreur, résumé de « Plus d'options »), puis leur branchement dans le moteur de réglages (types, manifeste, validation).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const S = await import("@/core/adminkit/search");
const V = await import("@/core/adminkit/values");
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
