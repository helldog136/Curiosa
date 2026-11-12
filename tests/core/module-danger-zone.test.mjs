// Module page structure (core 0.12.0): the module's own tabs apart from the content tabs, a danger zone only in General, a confirmation window that names the
// module, the new window slots (secondary button, danger style), keyboard rules, FR/EN parity. Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const T = await import("@/core/modules/tabs");
const { PageTabs, TabPanel } = await import("@/components/admin/PageTabs");
const { ModalWindow } = await import("@/components/admin/ModalWindow");
const { RemoveWindow } = await import("@/components/admin/RemoveWindow");
const { removalConfirmed } = await import("@/components/admin/removalConfirm");
const { removeWindowLabels } = await import("@/components/admin/removalLabels");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { adminPageErgonomicsProblems } = await import("../../testsupport/index.mjs");
const VIEW = "src/app/admin/(panel)/instances/[id]/InstanceView.tsx";
const ids = (l) => l.map((x) => x.id);

/* ───────────── tab groups ───────────── */

test("groupTabs : le contenu du module d'abord, puis Réglages, Sources, Général, Historique ; la séparation seulement s'il y a les deux groupes", () => {
  const plan = T.planTabs([{ id: "use", label: { en: "Partners", fr: "Partenaires" } }, { id: "look", label: { en: "Look", fr: "Apparence" } }]);
  const visible = [...T.visibleTabs(plan, ["use", "settings", "look", "general"]), { id: T.HISTORY_TAB }];
  const g = T.groupTabs(visible);
  assert.deepEqual(ids(g.tabs), ["use", "look", "settings", "general", "history"]);
  assert.equal(g.split, true);
  assert.deepEqual(g.tabs.map((t) => t.group), ["content", "content", "module", "module", "module"]);
  const noContent = T.groupTabs([{ id: "settings" }, { id: "general" }, { id: "history" }]);
  assert.equal(noContent.split, false, "rien à séparer : pas de marque");
  assert.equal(T.groupTabs([{ id: "use" }]).split, false);
  assert.deepEqual(ids(T.groupTabs([{ id: "use" }, { id: "settings" }, { id: "general" }]).tabs), ["use", "settings", "general"], "sans onglet ajouté : l'ordre d'avant");
});

const tabs = [{ id: "use", label: "Partners", group: "content" }, { id: "settings", label: "Settings", group: "module" }, { id: "general", label: "General", group: "module" }, { id: "history", label: "History", group: "module" }];
const labels = { modified: "changed", error: "fix", leave: "leave", list: "Sections" };
const row = (extra) => renderToStaticMarkup(h(PageTabs, { tabs, initial: "use", labels, ...extra }, h(TabPanel, { id: "use" }, "x")));

test("PageTabs split : le groupe Module est à part (séparateur, pastille « Module », lu avant chaque onglet), le contenu reste à gauche", () => {
  const html = row({ split: true, groupLabel: "Module" });
  assert.match(html, /data-testid="tabs-module-group"/);
  assert.match(html, /data-testid="tabs-separator"/);
  assert.match(html, /aria-hidden="true"[^>]*data-testid="tabs-module-mark"/);
  const group = /data-testid="tabs-module-group"[\s\S]*$/.exec(html)[0];
  for (const id of ["settings", "general", "history"]) assert.match(group, new RegExp(`data-testid="tab-${id}"`));
  assert.doesNotMatch(group, /data-testid="tab-use"/, "Utiliser reste hors du groupe");
  assert.equal((html.match(/<span class="sr-only">Module<\/span>/g) ?? []).length, 3, "chaque onglet du module est précédé de « Module » pour un lecteur d'écran");
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4, "une seule liste d'onglets");
});

test("PageTabs sans split : la rangée est celle d'avant (aucun groupe, aucun attribut de plus)", () => {
  const html = row({});
  assert.doesNotMatch(html, /tabs-module-group|tabs-separator|data-group|sr-only">Module/);
});

/* ───────────── danger zone ───────────── */

test("la zone sensible n'est que dans Général, en bas, hors de tout formulaire, avec un seul bouton", () => {
  const src = read(VIEW);
  assert.equal((src.match(/\{dangerZone\}/g) ?? []).length, 1, "rendue une seule fois");
  assert.match(src, /here\("general"\) && <>\{generalForm\}\{tasksNode\}\{dangerZone\}<\/>/, "après le formulaire et les tâches, tout en bas de Général");
  assert.match(src, /border-2 border-danger\/50/, "encadré rouge");
  assert.match(src, /id="danger-zone-title"/);
  assert.doesNotMatch(src, /dangerZoneHelp/, "pas de phrase d'explication (R32)");
  const form = src.slice(src.indexOf("const generalForm"), src.indexOf("const tasksNode"));
  assert.doesNotMatch(form, /RemoveWindow|dangerZone/, "jamais dans le formulaire de Général (Entrée ne peut pas l'atteindre)");
  assert.doesNotMatch(src.slice(src.indexOf("const settingsForm"), src.indexOf("const sourcesForm")), /RemoveWindow/);
});

test("le bouton de la zone nomme le module (verbe + objet) et n'envoie rien : il ouvre la fenêtre", () => {
  const t = makeTranslator("en");
  const impact = { instances: 1, items: 12, files: 3 };
  const labels = removeWindowLabels(t, { scope: "module", name: "Partnerships", impact });
  assert.equal(labels.button, "Remove the module Partnerships");
  assert.equal(removeWindowLabels(t, { scope: "instance", name: "Weekly", impact }).button, "Remove Weekly");
  assert.deepEqual(labels.impact, [{ label: "Saved items", value: 12 }, { label: "Uploaded files", value: 3 }]);
  assert.match(labels.submitKeep, /Partnerships/);
  assert.match(labels.submitErase, /Partnerships/);
  const html = renderToStaticMarkup(h(RemoveWindow, { labels, name: "Partnerships", keep: async () => {}, erase: async () => {} }));
  assert.match(html, /<button type="button"[^>]*aria-haspopup="dialog"[^>]*data-testid="remove-open"[^>]*>Remove the module Partnerships<\/button>/);
  assert.doesNotMatch(html, /<form|role="dialog"|type="submit"/, "fermée : rien d'autre que le bouton, aucun envoi possible");
});

test("la confirmation : case cochée (données gardées) ou nom écrit (tout effacer), jamais par défaut", () => {
  assert.equal(removalConfirmed("keep", { checked: false, typed: "", name: "Partnerships" }), false);
  assert.equal(removalConfirmed("keep", { checked: true, typed: "", name: "Partnerships" }), true);
  assert.equal(removalConfirmed("erase", { checked: true, typed: "", name: "Partnerships" }), false, "cocher ne suffit pas pour tout effacer");
  assert.equal(removalConfirmed("erase", { checked: false, typed: "partnership", name: "Partnerships" }), false);
  assert.equal(removalConfirmed("erase", { checked: false, typed: "  partnerships ", name: "Partnerships" }), true, "sans casse ni espaces");
  assert.equal(removalConfirmed("erase", { checked: false, typed: "", name: "" }), false, "un champ vide ne confirme jamais");
});

test("la fenêtre de retrait : sans formulaire, sans focus automatique, Entrée neutralisé, bouton rouge désactivé tant que le geste manque, texte de perte visible", () => {
  const src = read("src/components/admin/RemoveWindow.tsx");
  assert.doesNotMatch(src, /<form|autoFocus|requestSubmit/);
  assert.match(src, /e\.key === "Enter"\) e\.preventDefault\(\)/);
  assert.match(src, /variant="dangerSolid"[^>]*disabled=\{!ok\}/);
  assert.match(src, /data-testid="remove-lost"/);
  assert.match(src, /data-testid="remove-impact"/);
  assert.match(src, /<HelpTip help=\{labels\.keepHelp\}/, "la précision va dans une info-bulle (R32)");
  const win = read("src/components/admin/ModalWindow.tsx");
  assert.match(win, /panel\.current\?\.focus\(\)/, "le focus entre dans la fenêtre, pas sur un bouton");
});

test("le décompte vient du cœur (éléments, fichiers) sans lire les données du module", () => {
  const src = read("src/core/modules/removalImpact.ts");
  for (const re of [/prisma\.entry\.count/, /prisma\.moduleRecord\.count/, /prisma\.uploadFile\.count/]) assert.match(src, re);
  assert.doesNotMatch(src, /findMany\(\{[^}]*data/);
});

/* ───────────── window slots ───────────── */

const modal = (extra) => renderToStaticMarkup(h(ModalWindow, { closeLabel: "Close", title: "Edit partner", onClose() {}, footer: h("button", { "data-testid": "main" }, "Save the partner"), ...extra }, "body"));

test("ModalWindow : sans secondary, le pied est celui d'avant ; avec secondary, une zone à part, d'abord dans l'ordre du clavier", () => {
  const plain = modal({});
  assert.doesNotMatch(plain, /route-modal-secondary/);
  const html = modal({ secondary: h("button", { "data-testid": "del" }, "Delete the partner") });
  const s = html.indexOf('data-testid="route-modal-secondary"');
  assert.ok(s > 0);
  assert.ok(html.indexOf('data-testid="del"') > s && html.indexOf('data-testid="del"') < html.indexOf('data-testid="main"'), "le bouton destructif précède le bouton principal dans le DOM (ordre de tabulation = ordre visuel)");
  assert.match(html, /border-b border-line\/60 pb-3 sm:border-b-0/, "séparé du bouton principal");
  assert.equal((html.match(/data-testid="main"/g) ?? []).length, 1);
});

const form = (extra = {}) => ({ type: "adminForm", action: "save", title: "Edit partner", submitLabel: "Save the partner", cancelHref: "?", presentation: "dialog", fields: [{ name: "id", kind: "hidden", label: "id", value: "p1" }, { name: "name", label: "Name", value: "etoile_nord", example: "etoile_nord" }], ...extra });
const render = (block) => renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block, labels: formLabels(makeTranslator("en"), "en", block) }));

test("adminForm : danger → bouton principal rouge plein ; secondaryAction → bouton destructif à part ; sans les clés, rien ne change", () => {
  const base = render(form());
  assert.doesNotMatch(base, /edit-dialog-secondary/);
  assert.match(base, /bg-accent[^"]*"[^>]*data-testid="edit-dialog-submit"|data-testid="edit-dialog-submit"[^>]*bg-accent|bg-accent[^>]*data-phase/);
  const danger = render(form({ danger: true }));
  assert.match(danger, /bg-danger/);
  const withSecond = render(form({ secondaryAction: { label: "Delete the partner", action: "remove", confirm: "Delete this partner? Their history is lost." } }));
  assert.match(withSecond, /data-testid="edit-dialog-secondary"[^>]*>[^<]*(<[^>]*>)*Delete the partner/);
  assert.match(withSecond, /route-modal-secondary|edit-dialog-secondary/);
  assert.equal((withSecond.match(/data-testid="edit-dialog-submit"/g) ?? []).length, 1, "toujours un seul bouton principal");
});

test("le kit : secondaryAction sans confirmation, sans fenêtre ou au libellé vague est signalé", () => {
  const bad = (sa, extra) => adminPageErgonomicsProblems([form({ secondaryAction: sa, ...extra })]).map((p) => p.rule + ":" + p.message);
  assert.deepEqual(bad({ label: "Delete the partner", action: "remove", confirm: "Delete this partner? Their history is lost." }), []);
  assert.ok(bad({ label: "Delete the partner", action: "remove" }).some((m) => m.startsWith("R24")));
  assert.ok(bad({ label: "Submit", action: "remove", confirm: "x" }).some((m) => m.startsWith("R3")));
  assert.ok(bad({ label: "Delete the partner", action: "remove", confirm: "x" }, { presentation: undefined }).some((m) => m.startsWith("R24")));
});

/* ───────────── FR / EN, R32 ───────────── */

test("FR et EN : mêmes clés danger.*, mêmes {variables}, pas de phrase d'explication retirée par erreur", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  const keys = Object.keys(en).filter((k) => k.startsWith("danger.") || k.startsWith("instances.pageState.") || k === "moduleTabs.group");
  assert.ok(keys.length >= 20);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) { assert.ok(k in fr, `${k} manque en français`); assert.equal(vars(en[k]), vars(fr[k]), k); }
  assert.ok(!("instances.dangerZoneHelp" in en) && !("instances.dangerZoneHelp" in fr), "phrase de remplissage supprimée");
  for (const k of ["danger.button.module", "danger.submitKeep", "danger.submitErase", "danger.typeName"]) {
    assert.ok(!/[!]/.test(en[k]) && !/veuillez/i.test(fr[k]), k);
    assert.ok(en[k].length <= 60 && !/:\s*$/.test(en[k]), `${k} : libellé court sans deux-points (R10)`);
  }
});

test("R32 est écrite dans docs/ERGONOMIE-ADMIN.md et dans la liste de contrôle", () => {
  const doc = read("docs/ERGONOMIE-ADMIN.md");
  assert.match(doc, /\*\*R32 \[revue\]/);
  assert.match(doc, /\(R32\)\./);
});
