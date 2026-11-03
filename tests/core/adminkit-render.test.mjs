// Kit d'administration (lot 1) : rendu des composants (interrupteur, boutons segmentés, recherche, « Plus d'options », période, date et heure, durée, nombre borné,
// exemple et erreur sous le champ, tableau enrichi, formulaire de module). Le comportement dans un vrai navigateur (frappe, clic, retour arrière) est vérifié avec
// Playwright (captures) ; ici : le HTML, l'accessibilité et la compatibilité des blocs d'avant.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const wrap = (el) => h(HelpTipProvider, { label: "Aide : {name}" }, el);
const F = await import("@/components/admin/Field");
const { Switch, SwitchField } = await import("@/components/admin/Switch");
const { Segmented, fitsSegmented } = await import("@/components/admin/Segmented");
const { MoreOptions } = await import("@/components/admin/MoreOptions");
const { NumberField } = await import("@/components/admin/NumberField");
const { PeriodField } = await import("@/components/admin/PeriodField");
const { DateTimeField } = await import("@/components/admin/DateTimeField");
const { DurationField } = await import("@/components/admin/DurationField");
const { LiveSearch, NoResults } = await import("@/components/admin/LiveSearch");
const { AdminTable } = await import("@/components/admin/AdminTable");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels, tableLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const tr = makeTranslator("fr");

/* ───────────── interrupteur ───────────── */

test("interrupteur d'état : role=switch, état coché lu par les outils d'accessibilité, état écrit, cible de 44 px", () => {
  const on = html(h(Switch, { label: "Lien /twitch actif", checked: true, onText: "Actif", offText: "Désactivé", onToggle: async () => {} }));
  assert.match(on, /role="switch"/);
  assert.match(on, /aria-checked="true"/);
  assert.match(on, /aria-label="Lien \/twitch actif"/);
  assert.match(on, /min-h-11/, "cible de 44 px");
  assert.match(on, />Actif</, "l'état est écrit, pas seulement coloré");
  assert.doesNotMatch(on, /Désactivé/);
  const off = html(h(Switch, { label: "x", checked: false, onText: "Actif", offText: "Désactivé", onToggle: async () => {} }));
  assert.match(off, /aria-checked="false"/);
  assert.match(off, />Désactivé</);
  assert.match(off, /role="status"/, "zone de retour annoncée aux lecteurs d'écran");
  assert.doesNotMatch(on, /Activer|Désactiver/, "un interrupteur n'est pas un verbe");
});

test("interrupteur dans un formulaire : une vraie case (valeur « on »), absente si décochée, libellé relié, erreur sous le champ", () => {
  const on = html(wrap(h(SwitchField, { label: "Compter les clics", name: "measure", defaultChecked: true, onText: "Activé", offText: "Désactivé" })));
  const box = /<input[^>]*>/.exec(on)[0];
  for (const part of [/type="checkbox"/, /role="switch"/, /name="measure"/, /value="on"/, /checked=""/]) assert.match(box, part);
  assert.match(on, /<label[^>]*for="sw_measure"/);
  const bad = html(wrap(h(SwitchField, { label: "L", name: "m", error: "Choisissez une option, par exemple oui." })));
  assert.match(bad, /aria-invalid="true"/);
  assert.match(bad, /aria-describedby="err-m"/);
  assert.match(bad, /id="err-m"[^>]*>.*Choisissez une option/s);
});

/* ───────────── boutons segmentés ───────────── */

test("boutons segmentés : 2 à 4 choix, vrais boutons radio, un seul coché, libellés complets", () => {
  assert.deepEqual([1, 2, 4, 5].map(fitsSegmented), [false, true, true, false]);
  const out = html(wrap(h(Segmented, { label: "Mode", name: "mode", defaultValue: "b", options: [{ value: "a", label: "Automatique, selon le moment" }, { value: "b", label: "Toujours" }, { value: "c", label: "Jamais" }] })));
  assert.equal((out.match(/type="radio"/g) ?? []).length, 3);
  assert.match(out, /<input[^>]*value="b"[^>]*checked=""|<input[^>]*checked=""[^>]*value="b"/);
  assert.equal((out.match(/checked=""/g) ?? []).length, 1);
  assert.match(out, /<fieldset/);
  assert.match(out, /<legend[^>]*>Mode/);
  assert.match(out, /Automatique, selon le moment/, "le libellé n'est jamais tronqué");
  assert.doesNotMatch(out, /truncate|text-ellipsis/);
  const first = html(wrap(h(Segmented, { label: "M", name: "m", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] })));
  assert.match(first, /<input[^>]*value="a"[^>]*checked=""|<input[^>]*checked=""[^>]*value="a"/, "sans valeur de départ : le premier choix");
});

/* ───────────── « Plus d'options » ───────────── */

test("« Plus d'options » : replié avec son résumé, ouvert d'office quand une valeur y est, champs dans le formulaire", () => {
  const closed = html(h(MoreOptions, { title: "Plus d'options", summary: "Fin le 30 novembre", count: 2 }, h("input", { name: "inside" })));
  assert.match(closed, /<details/);
  assert.doesNotMatch(closed, /<details[^>]*\bopen\b/);
  assert.match(closed, /<summary/);
  assert.match(closed, /Fin le 30 novembre/);
  assert.match(closed, />2</);
  assert.match(closed, /name="inside"/, "le champ replié part avec le formulaire");
  const open = html(h(MoreOptions, { title: "Plus d'options", defaultOpen: true }, "x"));
  assert.match(open, /<details[^>]*\bopen=""/);
});

/* ───────────── exemple et erreur sous le champ ───────────── */

test("Field : l'exemple et l'erreur s'affichent sous le champ, reliés par aria-describedby ; sans eux, rien ne change", () => {
  const plain = html(wrap(h(F.TextField, { label: "Nom", name: "nom" })));
  assert.doesNotMatch(plain, /aria-describedby|aria-invalid|data-field-example/);
  const out = html(wrap(h(F.TextField, { label: "Pseudo", name: "pseudo", example: "Par exemple : insta, ig", error: "Écrivez un pseudo, par exemple insta." })));
  assert.match(out, /aria-describedby="ex-pseudo err-pseudo"/);
  assert.match(out, /aria-invalid="true"/);
  assert.match(out, /border-red-500/);
  assert.match(out, /data-field-example[^>]*>Par exemple : insta, ig/);
  assert.match(out, /data-field-error[^>]*>.*Écrivez un pseudo/s);
  assert.ok(out.indexOf("Par exemple") > out.indexOf("<input") && out.indexOf("Écrivez un pseudo") > out.indexOf("Par exemple"), "sous le champ, l'exemple puis l'erreur");
  for (const C of [F.TextArea, F.Select]) {
    const o = html(wrap(h(C, { label: "L", name: "z", options: [{ value: "a", label: "A" }], example: "Par exemple : 1", error: "Erreur, par exemple 1." })));
    assert.match(o, /aria-invalid="true"/);
    assert.match(o, /id="err-z"/);
  }
});

/* ───────────── nombre, durée, période, date et heure ───────────── */

test("nombre borné : bornes natives, unité à droite, valeur par défaut grisée, indication", () => {
  const out = html(wrap(h(NumberField, { label: "Délai", name: "delay", min: 5, max: 3600, step: 5, unit: "secondes", emptyValue: 30, hint: "Entre 5 et 3600 secondes · Vide : 30 secondes", defaultValue: "" })));
  assert.match(out, /type="number"/);
  assert.match(out, /min="5"/); assert.match(out, /max="3600"/); assert.match(out, /step="5"/);
  assert.match(out, /placeholder="30"/);
  assert.match(out, /inputMode="numeric"/);
  assert.match(out, />secondes</);
  assert.match(out, /Vide : 30 secondes/);
});

const periodLabels = { from: "Du", to: "au", yearly: "Chaque année", sentenceYearly: "Du {from} au {to}, chaque année", sentenceOnce: "Du {from} au {to}", none: "Aucune période choisie", clear: "Effacer la période", order: "La fin doit venir après le début.", month: "Tout le mois de", monthPick: "Choisir un mois", incomplete: "Choisissez les deux dates, par exemple du 1er au 30 novembre.",
  preset: "Une période toute prête", presetPick: "Choisir une période", presetSearch: "Rechercher une fête ou une saison", presetEmpty: "Aucune période ne correspond.", presetClear: "Effacer la recherche",
  presetNote: "Dates de cette année. Pensez à les refaire l'an prochain.", presetMoon: "Lune.", presetEve: "Veille.",
  groups: { season: "Saisons", fixed: "Fêtes à date fixe", movable: "Fêtes qui changent chaque année" }, names: { spring: "Printemps" } };

test("période : une ligne, un seul libellé, la phrase d'aperçu et la valeur enregistrée dans un champ caché", () => {
  const out = html(wrap(h(PeriodField, { label: "Période", name: "period", defaultValue: "11-01/11-30", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(out, /<input type="hidden" name="period" value="11-01\/11-30"/);
  assert.match(out, /value="2026-11-01"/); assert.match(out, /value="2026-11-30"/);
  assert.match(out, /Du 1er novembre au 30 novembre, chaque année/);
  assert.equal((out.match(/type="date"/g) ?? []).length, 2);
  assert.match(out, /checked=""/, "« Chaque année » coché");
  assert.equal((out.match(/<label/g) ?? []).length, 3, "un libellé pour le champ, un pour « Tout le mois de », un pour la case");
  const once = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "2026-12-20/2026-12-31", locale: "fr", labels: periodLabels })));
  assert.match(once, /value="2026-12-20\/2026-12-31"/);
  assert.match(once, /Du 20 décembre 2026 au 31 décembre 2026/);
  const wraps = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "12-20/01-05", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(wraps, /value="2027-01-05"/, "la fin passe à l'année suivante");
  const empty = html(wrap(h(PeriodField, { label: "P", name: "p", locale: "fr", labels: periodLabels })));
  assert.match(empty, /<input type="hidden" name="p" value=""/);
  assert.match(empty, /Aucune période choisie/);
});

test("période : « Tout le mois de » est une liste de 12 mois sans nom (rien d'envoyé), l'état de départ n'affiche aucune erreur", () => {
  const empty = html(wrap(h(PeriodField, { label: "P", name: "p", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(empty, /<label for="p__month"[^>]*>Tout le mois de<\/label>/);
  const sel = /<select id="p__month"[^>]*>[\s\S]*?<\/select>/.exec(empty)?.[0] ?? "";
  assert.ok(sel && !/ name=/.test(sel), "la liste n'envoie rien");
  assert.equal((sel.match(/<option/g) ?? []).length, 13);
  assert.match(sel, /<option value="" selected="">Choisir un mois<\/option>/);
  assert.match(sel, /<option value="2">février<\/option>/); assert.match(sel, /<option value="8">août<\/option>/);
  assert.doesNotMatch(empty, /role="alert"|Choisissez les deux dates/, "pas d'erreur à l'ouverture");
  assert.match(empty, /min-h-11/);
  const nov = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "11-01/11-30", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(nov, /<option value="11" selected="">novembre<\/option>/, "la liste montre le mois entier");
  const part = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "11-05/11-30", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(part, /<option value="" selected="">Choisir un mois<\/option>/, "jours modifiés : retour à « Choisir un mois »");
  const feb = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "02-01/02-29", locale: "fr", labels: periodLabels, refYear: 2026 })));
  assert.match(feb, /<option value="2" selected="">février<\/option>/); assert.match(feb, /value="2028-02-29"/);
  const en = html(wrap(h(PeriodField, { label: "P", name: "p", defaultValue: "11-01/11-30", locale: "en", labels: { ...periodLabels, sentenceYearly: "From {from} to {to}, every year" }, refYear: 2026 })));
  assert.match(en, /<option value="11" selected="">November<\/option>/); assert.match(en, /From 1 November to 30 November, every year/);
  assert.match(empty, /<span[^>]*>Une période toute prête<\/span>/);
  assert.match(empty, /aria-expanded="false"[^>]*>Choisir une période/, "la liste toute prête est repliée au départ");
  assert.doesNotMatch(empty, /Dates de cette année/, "pas de remarque tant qu'aucune fête mobile n'est choisie");
  const err = html(wrap(h(PeriodField, { label: "P", name: "p", locale: "fr", labels: periodLabels, error: "Oups, par exemple 5" })));
  assert.match(err, /Oups, par exemple 5/);
});

test("date et heure : un champ, deux sélecteurs natifs, valeur « AAAA-MM-JJTHH:mm » (ou la date seule si l'heure est facultative)", () => {
  const labels = { date: "Date de fin", time: "Heure de fin", timePlaceholder: "Sans heure, jusqu'à la fin du jour.", clear: "Effacer", at: "à", preview: "Le lien marche jusqu'au {when}." };
  const full = html(wrap(h(DateTimeField, { label: "Date de fin", name: "end", defaultValue: "2026-11-30T18:30", locale: "fr", labels, optionalTime: true })));
  assert.match(full, /<input type="hidden" name="end" value="2026-11-30T18:30"/);
  assert.match(full, /type="date"[^>]*/); assert.match(full, /type="time"/);
  assert.match(full, /name="end__date"/); assert.match(full, /name="end__time"/);
  assert.match(full, /Le lien marche jusqu&#x27;au 30 novembre 2026 à 18:30\./);
  const dateOnly = html(wrap(h(DateTimeField, { label: "x", name: "end", defaultValue: "2026-11-30", locale: "fr", labels, optionalTime: true })));
  assert.match(dateOnly, /name="end" value="2026-11-30"/);
  assert.match(dateOnly, /jusqu&#x27;au 30 novembre 2026\./);
  const strict = html(wrap(h(DateTimeField, { label: "x", name: "end", defaultValue: "2026-11-30", locale: "fr", labels })));
  assert.match(strict, /name="end" value=""/, "sans optionalTime, une date sans heure n'est pas complète");
});

test("durée : un nombre et une unité, secondes cachées, bornes dans l'unité choisie", () => {
  const labels = { s: "secondes", min: "minutes", h: "heures", d: "jours", day: "j" };
  const out = html(wrap(h(DurationField, { label: "Attente", name: "wait", defaultValue: 5400, min: 5, max: 7200, labels })));
  assert.match(out, /<input type="hidden" name="wait" value="5400"/);
  assert.match(out, /value="90"/, "5400 s = 90 minutes");
  assert.match(out, /<option value="min" selected="">minutes/);
  assert.doesNotMatch(out, /jours/, "pas de jours sous un maximum de 2 heures");
  assert.match(out, /max="120"/, "7200 s = 120 minutes");
  assert.match(out, /min="1"/, "au moins 5 s = 1 minute, arrondi vers le haut");
  const none = html(wrap(h(DurationField, { label: "A", name: "w", labels, emptyHint: "Vide : 30 s" })));
  assert.match(none, /name="w" value=""/);
  assert.match(none, /Vide : 30 s/);
});

/* ───────────── recherche en direct ───────────── */

test("recherche en direct : champ « Rechercher » présent dès le départ, étiqueté, sans bouton de validation", () => {
  const out = html(h(LiveSearch, { scope: "liens", placeholder: "Rechercher un lien", noneLabel: "Aucun résultat", clearLabel: "Effacer la recherche", filters: [{ key: "state", allLabel: "Tout", options: [{ value: "on", label: "Actifs", count: 4 }] }] }));
  assert.match(out, /type="search"/);
  assert.match(out, /aria-label="Rechercher un lien"/);
  assert.doesNotMatch(out, /type="submit"/, "pas de bouton : la liste se filtre pendant la frappe");
  assert.match(out, /aria-pressed="true"[^>]*>Tout/);
  assert.match(out, />Actifs<span[^>]*>4</);
  assert.doesNotMatch(out, /Aucun résultat/, "le message n'apparaît qu'en l'absence de résultat");
  const typed = html(h(LiveSearch, { scope: "liens", placeholder: "R", noneLabel: "n", clearLabel: "Effacer la recherche", mode: "server", action: "/admin/redirects", initialQuery: "twitch" }));
  assert.match(typed, /value="twitch"/);
  assert.match(typed, />Effacer la recherche</, "« Effacer la recherche » dès qu'il y a du texte");
  const none = html(h(NoResults, { message: "Aucun résultat", clearLabel: "Effacer la recherche", href: "/admin/redirects" }));
  assert.match(none, /Aucun résultat/); assert.match(none, /href="\/admin\/redirects"[^>]*>Effacer la recherche/);
});

/* ───────────── tableau enrichi ───────────── */

const tlabels = tableLabels(tr);
const block = (extra = {}) => ({ type: "table", columns: ["Commande", "Origine", "Réponse", "État"], rowIds: ["a", "b", "c"], rows: [
  ["!bonjour", { text: "Les vôtres", badge: "accent" }, "Bonjour à toutes et à tous, bienvenue sur la chaîne et merci d'être là ce soir pour cette longue soirée", { text: "Actif", switch: { on: true, action: "toggle", label: "Commande !bonjour active" } }],
  ["!merci", { text: "Partenaires", badge: "info" }, "Merci", { text: "Désactivé", switch: { on: false, action: "toggle", label: "Commande !merci active" } }],
  ["!planning", { text: "Les vôtres", badge: "accent" }, "Planning", { text: "Actif", switch: { on: true, action: "toggle", label: "Commande !planning active" } }],
], rowActions: [{ label: "Modifier", href: "?edit={id}" }, { label: "Supprimer", action: "del", danger: true, confirm: "Supprimer ?" }], searchable: true, filters: [{ column: 1 }], truncate: [2], ...extra });
const table = (b, instanceId = "i1") => html(h(AdminTable, { block: b, instanceId, labels: tlabels }));

test("tableau enrichi : recherche, pastilles avec leur nombre, colonne d'origine colorée ET écrite, interrupteurs, menu « ⋯ », texte coupé", () => {
  const out = table(block());
  assert.match(out, /type="search"/);
  assert.match(out, /aria-label="Rechercher"/);
  assert.match(out, />Tout</); assert.match(out, />Les vôtres<span[^>]*>2</); assert.match(out, />Partenaires<span[^>]*>1</);
  assert.match(out, /rounded-full px-2\.5 py-0\.5 text-xs font-medium bg-accent\/10[^>]*>Les vôtres/, "pastille colorée");
  assert.match(out, /bg-sky-500\/15[^>]*>Partenaires/);
  assert.equal((out.match(/role="switch"/g) ?? []).length, 3);
  assert.match(out, /aria-label="Commande !merci active"/);
  assert.equal((out.match(/data-testid="row-menu"/g) ?? []).length, 3, "un menu « ⋯ » par ligne");
  assert.match(out, /aria-label="Autres actions"/);
  assert.match(out, /role="menuitem"[^>]*>Supprimer/, "l'action destructive est rangée dans le menu");
  assert.match(out, /href="\?edit=a"[^>]*>Modifier/, "« Modifier » reste visible");
  assert.match(out, /class="block truncate" title="Bonjour à toutes/, "texte long coupé, complet dans l'info-bulle");
  assert.doesNotMatch(out, /(?<![:\w-])overflow-x-auto/, "pas de défilement horizontal sur téléphone : seulement dès 640 px");
  assert.match(out, /class="relative sm:overflow-x-auto"/);
  assert.match(out, /max-sm:block/, "cartes sous 640 px");
  assert.match(out, /role="columnheader"/);
  assert.doesNotMatch(out, /Activer|Désactiver/);
});

test("tableau enrichi : deux actions visibles au plus", () => {
  const b = block({ rowActions: ["Un", "Deux", "Trois", "Quatre"].map((label) => ({ label, href: `?${label}={id}` })) });
  const out = table(b);
  const visible = out.match(/<td role="cell" class="whitespace-nowrap[\s\S]*?<\/td>/)[0];
  assert.equal((visible.match(/<a href="\?(Un|Deux)=a"/g) ?? []).length, 2);
  assert.doesNotMatch(visible.split('data-testid="row-menu"')[0], /Trois|Quatre/);
  assert.match(out, /role="menuitem"[^>]*>Trois/);
  assert.match(out, /role="menuitem"[^>]*>Quatre/);
});

test("tableau enrichi : 50 lignes par page, pagination annoncée ; état vide dit quoi faire", () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`ligne ${i}`]);
  const out = table({ type: "table", columns: ["Nom"], rows, searchable: true });
  assert.equal((out.match(/<tr role="row" data-skin-part="table-row" class="border-t-token/g) ?? []).length, 50);
  assert.match(out, /Page 1 sur 3/);
  assert.match(out, /<button[^>]*disabled=""[^>]*>← Précédent/);
  const tall = table({ type: "table", columns: ["Nom"], rows, pageSize: 0 });
  assert.equal((tall.match(/<tr role="row" data-skin-part="table-row" class="border-t-token/g) ?? []).length, 120, "pageSize 0 : tout sur une page");
  assert.match(table({ type: "table", columns: ["A"], rows: [], empty: "Aucune commande. Ajoutez-en une ci-dessous." }), /Aucune commande\. Ajoutez-en une ci-dessous\./);
});

test("tableau enrichi hors du panneau d'admin : pas de boutons de ligne ni d'interrupteur actif, l'état reste écrit", () => {
  const out = html(h(AdminTable, { block: block(), labels: tlabels }));
  assert.doesNotMatch(out, /role="switch"/);
  assert.doesNotMatch(out, /row-menu/);
  assert.match(out, />Actif</);
});

/* ───────────── formulaire d'un module ───────────── */

const formBlock = () => ({ type: "adminForm", action: "save", submitLabel: "Enregistrer la commande", title: "Commande", fields: [
  { name: "name", label: "Nom", example: "!bonjour" },
  { name: "reply", label: "Réponse", kind: "textarea" },
  { name: "mode", label: "Qui peut l'utiliser", kind: "segmented", options: [{ value: "all", label: "Tout le monde" }, { value: "subs", label: "Abonnements" }], value: "subs" },
  { name: "enabled", label: "Active", kind: "switch", value: "on" },
  { name: "wait", label: "Attente", kind: "number", min: 0, max: 600, unit: "secondes", placeholder: "30" },
  { name: "cool", label: "Délai", kind: "duration", min: 5, max: 3600, value: "90", folded: true },
  { name: "period", label: "Période", kind: "period", value: "11-01/11-30", folded: true },
  { name: "end", label: "Fin", kind: "datetime", folded: true },
  { name: "id", label: "", kind: "hidden", value: "7" },
] });

test("formulaire de module : nouveaux champs rendus, champs repliés sous « Plus d'options » avec résumé, exemple préfixé", () => {
  const b = formBlock();
  const out = html(wrap(h(AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, "fr", b) })));
  assert.match(out, /data-field-example[^>]*>Par exemple : !bonjour/);
  assert.match(out, /<fieldset[^>]*data-segmented/);
  assert.match(out, /role="switch"[^>]*name="enabled"/);
  assert.match(out, /type="number"[^>]*min="0"[^>]*max="600"|min="0" max="600"/);
  assert.match(out, />secondes</);
  assert.match(out, /Entre 0 et 600 secondes/);
  assert.match(out, /<input type="hidden" name="id" value="7"/);
  const more = out.slice(out.indexOf("<details"), out.indexOf("</details>"));
  assert.match(more, /name="cool"/); assert.match(more, /name="period"/); assert.match(more, /name="end"/);
  assert.match(more, /Plus d&#x27;options/);
  assert.match(more, /Du 1er novembre au 30 novembre, chaque année|Délai : 1 min 30 s/, "résumé de ce qui est réglé");
  assert.match(out.slice(out.indexOf("<details"), out.indexOf("<details") + 16), /<details open/, "ouvert d'office : des valeurs y sont déjà");
  assert.ok(out.indexOf("<details") > out.indexOf('name="wait"'), "les champs repliés sont après les champs visibles");
});

test("formulaire de module : sans les nouvelles clés, exactement les champs d'avant (aucun repli, aucun exemple)", () => {
  const b = { type: "adminForm", action: "save", submitLabel: "Enregistrer", fields: [{ name: "a", label: "A", help: "Aide" }, { name: "n", label: "N", kind: "number" }, { name: "c", label: "C", kind: "checkbox" }] };
  const out = html(wrap(h(AdminBlockForm, { instanceId: "i1", block: b, labels: formLabels(tr, "fr", b) })));
  assert.doesNotMatch(out, /<details|data-field-example|role="switch"|data-segmented/);
  assert.match(out, /type="number"/); assert.match(out, /type="checkbox"/);
  // Et sans les textes du kit (autre appelant) : un champ de la 0.6.0 se rabat sur un champ texte.
  const old = html(wrap(h(AdminBlockForm, { instanceId: "i1", block: { ...b, fields: [{ name: "p", label: "P", kind: "period" }] } })));
  assert.match(old, /<input[^>]*name="p"/);
});

/* ───────────── câblage ───────────── */

test("câblage : le tableau enrichi n'est choisi que sur demande, le bloc d'avant garde son rendu (défilement horizontal compris)", () => {
  const blocks = fs.readFileSync("src/components/site/Blocks.tsx", "utf8");
  assert.match(blocks, /if \(isEnhancedTable\(block\)\) \{/);
  assert.match(blocks, /relative overflow-x-auto/, "le tableau simple est inchangé");
  const types = fs.readFileSync("src/core/blocks.ts", "utf8");
  assert.match(types, /rows: TableCell\[\]\[\]/);
  assert.match(types, /columns: string\[\];/, "columns reste un tableau de textes");
});

/* ───────────── période : une seule fois par défaut, période ouverte ───────────── */

const { periodLabels: realPeriodLabels } = await import("@/components/admin/periodLabels");
const trEn = makeTranslator("en");
const yearlyBox = (out) => /<input type="checkbox"([^>]*)>/.exec(out)?.[1] ?? null;

test("période : sur une période NOUVELLE, « Chaque année » est décoché ; une valeur enregistrée garde son sens", () => {
  const labels = realPeriodLabels(tr);
  const fresh = html(wrap(h(PeriodField, { label: "Période", name: "p", locale: "fr", labels, refYear: 2026 })));
  assert.ok(yearlyBox(fresh) !== null, "la case est là");
  assert.doesNotMatch(yearlyBox(fresh), /checked/, "une annonce ponctuelle ne revient pas toute seule");
  assert.match(fresh, /<input type="hidden" name="p" value=""/);
  const yearly = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "12-01/12-24", locale: "fr", labels, refYear: 2026 })));
  assert.match(yearlyBox(yearly), /checked/, "« chaque année » déjà enregistré : toujours coché");
  assert.match(yearly, /value="12-01\/12-24"/); assert.match(yearly, /Du 1er décembre au 24 décembre, chaque année/);
  const once = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "2026-12-01/2026-12-15", locale: "fr", labels })));
  assert.doesNotMatch(yearlyBox(once), /checked/);
  assert.match(once, /value="2026-12-01\/2026-12-15"/); assert.match(once, /Du 1er décembre 2026 au 15 décembre 2026/);
  // Le défaut d'un module (twitch-bot et d'autres déclarent « chaque année ») est lu comme avant.
  const fromDefault = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "11-01/11-30", locale: "fr", labels, refYear: 2026 })));
  assert.match(yearlyBox(fromDefault), /checked/);
  assert.match(fromDefault, /value="11-01\/11-30"/);
});

test("période : sans la demande `openEnded`, rien ne change (étiquettes, aucune indication, une valeur ouverte n'est pas lue)", () => {
  const labels = realPeriodLabels(tr);
  const out = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "2026-12-01/", locale: "fr", labels })));
  assert.match(out, /<span[^>]*>Du<\/span>/); assert.match(out, /<span[^>]*>au<\/span>/);
  assert.doesNotMatch(out, /À partir du|jusqu&#x27;au|Une seule date suffit/);
  assert.match(out, /<input type="hidden" name="p" value=""/, "une valeur ouverte n'est jamais acceptée sans la demande");
  assert.match(out, /Aucune période choisie/);
  assert.equal((out.match(/required=""/g) ?? []).length, 0);
});

test("période ouverte : début seul et fin seule, une seule phrase d'aperçu, FR et EN, un seul contrôle", () => {
  const fr = realPeriodLabels(tr), en = realPeriodLabels(trEn);
  const since = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "2026-12-01/", locale: "fr", labels: fr, openEnded: true })));
  assert.match(since, /<input type="hidden" name="p" value="2026-12-01\/"/);
  assert.match(since, /À partir du 1er décembre 2026/);
  assert.match(since, /<span[^>]*>À partir du<\/span>/); assert.match(since, /<span[^>]*>jusqu&#x27;au<\/span>/);
  assert.match(since, /Une seule date suffit : l&#x27;autre peut rester vide\./);
  assert.equal((since.match(/type="date"/g) ?? []).length, 2, "toujours deux sélecteurs de date, pas de champ en plus");
  assert.equal((since.match(/type="checkbox"/g) ?? []).length, 0, "un seul bout : « Chaque année » se range");
  assert.equal((since.match(/pv-p/g) ?? []).length >= 2, true);
  const until = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "/2026-12-24", locale: "fr", labels: fr, openEnded: true })));
  assert.match(until, /<input type="hidden" name="p" value="\/2026-12-24"/);
  assert.match(until, /Jusqu&#x27;au 24 décembre 2026/);
  assert.match(until, /value="2026-12-24"/);
  const enSince = html(wrap(h(PeriodField, { label: "Period", name: "p", defaultValue: "2026-12-01/", locale: "en", labels: en, openEnded: true })));
  assert.match(enSince, /From 1 December 2026/);
  const enUntil = html(wrap(h(PeriodField, { label: "Period", name: "p", defaultValue: "/2026-12-24", locale: "en", labels: en, openEnded: true })));
  assert.match(enUntil, /Until 24 December 2026/);
  // Les deux bouts : la phrase d'avant et la case « Chaque année » reviennent ; vide : rien d'enregistré.
  const both = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "2026-12-01/2026-12-15", locale: "fr", labels: fr, openEnded: true })));
  assert.match(both, /Du 1er décembre 2026 au 15 décembre 2026/); assert.equal((both.match(/type="checkbox"/g) ?? []).length, 1);
  const yearly = html(wrap(h(PeriodField, { label: "Période", name: "p", defaultValue: "11-01/11-30", locale: "fr", labels: fr, openEnded: true, refYear: 2026 })));
  assert.match(yearly, /Du 1er novembre au 30 novembre, chaque année/); assert.match(yearlyBox(yearly), /checked/);
  const empty = html(wrap(h(PeriodField, { label: "Période", name: "p", locale: "fr", labels: fr, openEnded: true })));
  assert.match(empty, /<input type="hidden" name="p" value=""/); assert.match(empty, /Aucune période choisie/);
  assert.doesNotMatch(yearlyBox(empty), /checked/, "période nouvelle : une seule fois");
  // Obligatoire : une date suffit, donc l'exigence ne pèse que tant que les deux sont vides.
  const req = html(wrap(h(PeriodField, { label: "Période", name: "p", required: true, locale: "fr", labels: fr, openEnded: true })));
  assert.equal((req.match(/required=""/g) ?? []).length, 2);
  const reqSince = html(wrap(h(PeriodField, { label: "Période", name: "p", required: true, defaultValue: "2026-12-01/", locale: "fr", labels: fr, openEnded: true })));
  assert.equal((reqSince.match(/required=""/g) ?? []).length, 0);
  const reqClosed = html(wrap(h(PeriodField, { label: "Période", name: "p", required: true, locale: "fr", labels: fr })));
  assert.equal((reqClosed.match(/required=""/g) ?? []).length, 2, "sans la demande : les deux dates, comme avant");
});

test("période : les messages disent quoi faire avec un exemple (fin avant début, aucune date) en FR et EN, sans mot interdit", () => {
  for (const t of [tr, trEn]) {
    for (const k of ["period.order", "period.incomplete", "period.incompleteOpen", "instances.error.period", "instances.error.periodOpen"]) assert.match(t(k, { field: "X" }), /par exemple|for example/, k);
  }
  assert.match(tr("period.order"), /fin doit venir après le début/);
  // Les nouveaux textes visibles : courts (R10, R11), neutres, sans point d'exclamation.
  for (const t of [tr, trEn]) {
    for (const k of ["period.openFrom", "period.openTo", "period.sentenceSince", "period.sentenceUntil", "period.openHint"]) { const v = t(k, { from: "", to: "" }); assert.ok(v.length <= 60, `${k} : ${v.length}`); assert.doesNotMatch(v, /!|:\s*$/, k); }
  }
});

test("formulaire de module : un champ `period` avec `openEnded` accepte une seule date ; sans, comme avant", () => {
  const b = (extra) => ({ type: "adminForm", action: "save", submitLabel: "Enregistrer l'annonce", fields: [{ name: "p", label: "Période", kind: "period", value: "2026-12-01/", ...extra }] });
  const open = b({ openEnded: true });
  const o = html(wrap(h(AdminBlockForm, { instanceId: "i1", block: open, labels: formLabels(tr, "fr", open) })));
  assert.match(o, /name="p" value="2026-12-01\/"/); assert.match(o, /À partir du 1er décembre 2026/);
  const closed = b({});
  const c = html(wrap(h(AdminBlockForm, { instanceId: "i1", block: closed, labels: formLabels(tr, "fr", closed) })));
  assert.match(c, /name="p" value=""/); assert.doesNotMatch(c, /À partir du/);
});
