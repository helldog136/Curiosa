// Edit dialog (`presentation: "dialog"`): the pure rules, the markup, the shared window and the way a module adopts it.
// The behaviour in a real browser (focus, Esc, discard question, Back, sheet on a phone) is checked with Playwright (screenshots listed in the pull request).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (f) => fs.readFileSync(f, "utf8");
const { opensInDialog, dialogsLast, softOpenTarget, closeMode } = await import("@/core/adminkit/dialog");
const { AdminBlockForm, RowActionButton } = await import("@/components/admin/AdminBlocks");
const { formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { MODAL_WIDTH } = await import("@/components/admin/modalWidth");
const { fakeCtx } = await import("../helpers/fakeCtx.mjs");
const { adminPageErgonomicsProblems } = await import("../../testsupport/index.mjs");
const fixture = (await import("../fixtures/edit-dialog/index.mjs")).default;

const form = (extra = {}) => ({ type: "adminForm", action: "save", title: "Edit command", submitLabel: "Save the command", cancelHref: "?", presentation: "dialog", fields: [{ name: "id", kind: "hidden", label: "id", value: "c1" }, { name: "name", label: "Name", value: "hello", example: "hello" }], ...extra });

/* ───────────── pure rules ───────────── */

test("opensInDialog : seulement un adminForm du panneau d'admin qui le demande, sans champ fichier, hors éditeur d'entrée", () => {
  assert.equal(opensInDialog(form(), { admin: true }), true);
  assert.equal(opensInDialog(form(), { admin: false }), false, "jamais sur le site public");
  assert.equal(opensInDialog(form(), { admin: true, entry: true }), false, "pas dans un éditeur d'entrée");
  assert.equal(opensInDialog(form({ presentation: undefined }), { admin: true }), false, "sans la clé : comme avant");
  assert.equal(opensInDialog(form({ fields: [{ name: "f", kind: "file", label: "File" }] }), { admin: true }), false, "un champ fichier reste dans la page");
  assert.equal(opensInDialog({ type: "table", columns: [], rows: [], presentation: "dialog" }, { admin: true }), false);
});

test("dialogsLast : la fenêtre passe après la liste, le reste garde son ordre (la liste ne change pas d'identité à l'ouverture)", () => {
  const table = { type: "table", columns: ["A"], rows: [] }, md = { type: "markdown", text: "x" };
  assert.deepEqual(dialogsLast([form(), md, table], { admin: true }).map((b) => b.type), ["markdown", "table", "adminForm"]);
  assert.deepEqual(dialogsLast([md, table, form()], { admin: true }).map((b) => b.type), ["markdown", "table", "adminForm"]);
  const inPage = form({ presentation: undefined });
  assert.deepEqual(dialogsLast([inPage, table], { admin: true }), [inPage, table], "un formulaire dans la page garde sa place");
});

test("softOpenTarget : navigation douce seulement vers une adresse de l'administration du même site", () => {
  const base = "https://site.example/admin/instances/abc?tab=use";
  assert.equal(softOpenTarget("?edit=7", base), "/admin/instances/abc?edit=7");
  assert.equal(softOpenTarget("/admin/instances/abc?new=1", base), "/admin/instances/abc?new=1");
  assert.equal(softOpenTarget("https://evil.example/admin/x", base), null);
  assert.equal(softOpenTarget("/blog?edit=1", base), null, "hors de l'administration");
  assert.equal(softOpenTarget("//evil.example/admin", base), null);
  assert.equal(softOpenTarget("javascript:alert(1)", base), null);
});

test("closeMode : retour en arrière si un clic dans la page a ouvert la fenêtre, sinon remplacement (rechargement, lien partagé)", () => {
  assert.equal(closeMode("https://s/admin/i?edit=1", "https://s/admin/i?edit=1"), "back");
  assert.equal(closeMode(null, "https://s/admin/i?edit=1"), "replace");
  assert.equal(closeMode("https://s/admin/i?edit=1", "https://s/admin/i?edit=2"), "replace", "une autre adresse : on ne remonte pas l'historique");
});

/* ───────────── markup ───────────── */

test("le formulaire en fenêtre : titre, une seule action principale dans le pied, Annuler discret, mêmes champs, repli sans script", () => {
  const labels = formLabels(makeTranslator("en"), "en", form());
  const html = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block: form(), labels }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+"/, "nommée par son titre");
  assert.match(html, /<h2[^>]*>Edit command<\/h2>/);
  assert.match(html, /data-testid="modal-close"/);
  assert.equal((html.match(/data-testid="edit-dialog-submit"/g) ?? []).length, 1, "un seul bouton principal");
  assert.match(html, /<button[^>]*form="[^"]+"[^>]*data-testid="edit-dialog-submit"|<button[^>]*data-testid="edit-dialog-submit"[^>]*form="[^"]+"/, "le bouton envoie le formulaire par l'attribut form");
  const formId = /<form id="([^"]+)"/.exec(html)?.[1];
  assert.ok(formId && html.includes(`form="${formId}"`));
  assert.match(html, /name="name"/);
  assert.match(html, /data-testid="edit-dialog-cancel"[^>]*>Cancel</);
  assert.match(html, /Save the command/);
  assert.match(html, /sm:max-w-\[min\(94vw,640px\)\]/, "640 px au plus");
  assert.match(html, /h-full w-full/, "feuille pleine hauteur sur téléphone");
});

test("sans les textes de la fenêtre (autre appelant) ou avec un champ fichier : le formulaire reste dans la page, comme avant", () => {
  const labels = formLabels(makeTranslator("en"), "en", form());
  const noDialog = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block: form(), labels: { ...labels, dialog: undefined } }));
  assert.doesNotMatch(noDialog, /role="dialog"/);
  assert.match(noDialog, /<form/);
  const inPage = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", block: form({ presentation: undefined }), labels }));
  assert.doesNotMatch(inPage, /role="dialog"/);
  const scoped = renderToStaticMarkup(h(AdminBlockForm, { instanceId: "i1", entry: { panelId: "p", entryId: "e" }, block: form(), labels }));
  assert.doesNotMatch(scoped, /role="dialog"/, "pas dans l'éditeur d'une entrée");
});

test("un bouton de ligne en fenêtre reste un vrai lien (sans script : la page entière), avec haspopup=dialog", () => {
  const html = renderToStaticMarkup(h(RowActionButton, { instanceId: "i1", label: "Edit", href: "?edit=c1", id: "c1", presentation: "dialog" }));
  assert.match(html, /<a href="\?edit=c1"[^>]*aria-haspopup="dialog"[^>]*>Edit<\/a>/);
  const plain = renderToStaticMarkup(h(RowActionButton, { instanceId: "i1", label: "Edit", href: "?edit=c1", id: "c1" }));
  assert.match(plain, /<a href="\?edit=c1"/);
  assert.doesNotMatch(plain, /aria-haspopup/);
});

/* ───────────── the shared window ───────────── */

test("une seule fenêtre : la fiche d'une extension et la fenêtre de modification passent par ModalWindow (même fond, panneau, bouton, focus)", () => {
  const win = read("src/components/admin/ModalWindow.tsx");
  const route = read("src/components/admin/RouteModal.tsx");
  const edit = read("src/components/admin/EditDialog.tsx");
  assert.match(route, /<ModalWindow/);
  assert.match(edit, /<ModalWindow/);
  assert.doesNotMatch(route, /role="dialog"/, "RouteModal n'a plus sa propre fenêtre");
  // keyboard, focus, scroll lock
  for (const re of [/key === "Escape"/, /e\.key !== "Tab"/, /opener\.focus\(\)/, /dialog\[open\]/, /aria-modal="true"/, /document\.body\.style\.overflow = "hidden"/, /e\.target === e\.currentTarget/, /overflow-x-hidden/, /h-full w-full/, /sm:h-auto/]) assert.match(win, re);
  // the question before discarding edits, asked with the same confirmation box as everywhere
  assert.match(win, /askConfirm\(/);
  assert.match(win, /focusCancel: true/, "le focus arrive sur « Continuer la modification »");
  // sticky footer, tap targets
  assert.match(win, /sticky bottom-0/);
  assert.match(win, /min-h-11/);
  assert.match(win, /modal-panel/);
  assert.match(read("src/app/globals.css"), /\.modal-panel \{ animation/);
  assert.match(read("src/app/globals.css"), /prefers-reduced-motion: reduce\)[^}]*animation: none !important/s, "l'animation est supprimée si le mouvement est réduit");
  assert.equal(MODAL_WIDTH.form, "sm:max-w-[min(94vw,640px)]");
});

test("la fenêtre de l'extension n'a PAS de question d'abandon (son comportement d'avant est inchangé) ; celle de la liste en a une", () => {
  assert.doesNotMatch(read("src/components/admin/RouteModal.tsx"), /guard/);
  assert.match(read("src/components/admin/EditDialog.tsx"), /guard=\{guard\}/);
});

test("l'adresse est l'état de la fenêtre : retour en arrière ou remplacement à la fermeture, ouverture sans rechargement", () => {
  const edit = read("src/components/admin/EditDialog.tsx");
  assert.match(edit, /router\.push\(target, \{ scroll: false \}\)/, "la liste ne saute pas");
  assert.match(edit, /router\.back\(\)/);
  assert.match(edit, /router\.replace\(target, \{ scroll: false \}\)/);
  assert.match(edit, /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey/, "ouvrir dans un onglet reste possible");
  const blocks = read("src/components/site/Blocks.tsx");
  assert.match(blocks, /dialogsLast\(blocks/);
});

/* ───────────── adoption by a module ───────────── */

test("la fiche de démonstration : le formulaire n'existe que si l'adresse le demande, avec cancelHref ; le bouton de ligne et le lien « Nouveau » demandent la fenêtre", async () => {
  const ctx = fakeCtx({ permissions: ["storage", "admin"] });
  await fixture.adminActions.save(ctx, { name: "hello", reply: "Hello", cooldown: "30" });
  const [row] = await ctx.api.store.list("commands");
  const closed = await fixture.adminPanel(ctx, { query: {} });
  assert.equal(closed.some((b) => b.type === "adminForm"), false);
  const open = await fixture.adminPanel(ctx, { query: { edit: row.id } });
  const f = open.find((b) => b.type === "adminForm");
  assert.equal(f.presentation, "dialog");
  assert.equal(f.cancelHref, "?");
  assert.equal(f.fields.find((x) => x.name === "id").value, row.id);
  const table = open.find((b) => b.type === "table");
  assert.deepEqual(table.rowActions.map((a) => a.presentation), ["dialog", undefined], "la suppression reste une action séparée, dans le menu");
  assert.equal(open.find((b) => b.type === "links").items[0].presentation, "dialog");
  const created = await fixture.adminPanel(ctx, { query: { new: "1" } });
  assert.equal(created.find((b) => b.type === "adminForm").title, "New command");
});

test("erreurs : sous le champ, avec un exemple, et rien n'est enregistré ; succès : un message", async () => {
  const ctx = fakeCtx({ permissions: ["storage", "admin"] });
  const bad = await fixture.adminActions.save(ctx, { name: "  ", cooldown: "30" });
  assert.match(bad.errors.name, /for example hello/);
  const bad2 = await fixture.adminActions.save(ctx, { name: "x", cooldown: "99999" });
  assert.match(bad2.errors.cooldown, /for example 30/);
  assert.equal((await ctx.api.store.list("commands")).length, 0);
  assert.deepEqual(await fixture.adminActions.save(ctx, { name: "x", cooldown: "5" }), { ok: "Saved." });
});

test("le kit admin.ergonomics : les champs d'une fenêtre comptent pour R4 (5), mais pas pour la section de la liste ; cancelHref demandé (R24)", async () => {
  const ctx = fakeCtx({ permissions: ["storage", "admin"] });
  const blocks = await fixture.adminPanel(ctx, { query: { new: "1" } });
  assert.deepEqual(adminPageErgonomicsProblems(blocks, { skip: ["R15"] }), []);
  const six = form({ fields: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, label: `Field ${i}` })) });
  assert.ok(adminPageErgonomicsProblems([six]).some((p) => p.rule === "R4"), "6 champs visibles dans une fenêtre : trop");
  const folded = form({ fields: [...Array.from({ length: 4 }, (_, i) => ({ name: `f${i}`, label: `Field ${i}` })), ...Array.from({ length: 4 }, (_, i) => ({ name: `g${i}`, label: `Rare ${i}`, folded: true }))] });
  assert.deepEqual(adminPageErgonomicsProblems([folded]).filter((p) => p.rule === "R4"), [], "les champs repliés ne comptent pas");
  const five = (n) => ({ type: "adminForm", action: "a", submitLabel: "Save the item", fields: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, label: `Field ${i}` })) });
  assert.ok(adminPageErgonomicsProblems([five(4), five(4)]).some((p) => p.rule === "R4"), "deux formulaires dans la page : la section déborde");
  assert.deepEqual(adminPageErgonomicsProblems([form({ fields: five(4).fields }), five(4)]).filter((p) => p.rule === "R4"), [], "l'un en fenêtre : la section ne déborde pas");
  assert.ok(adminPageErgonomicsProblems([form({ cancelHref: undefined })]).some((p) => p.rule === "R24"));
  const badRow = { type: "table", columns: ["A"], rows: [["x"]], rowActions: [{ label: "Edit", action: "edit", presentation: "dialog" }] };
  assert.ok(adminPageErgonomicsProblems([badRow]).some((p) => p.rule === "R24"));
});

/* ───────────── texts ───────────── */

test("textes de la fenêtre : anglais et français à parité, sans deux-points final, formels", () => {
  const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
  const keys = Object.keys(en).filter((k) => k.startsWith("editDialog."));
  assert.deepEqual(keys.sort(), ["editDialog.cancel", "editDialog.discard", "editDialog.keep", "editDialog.message"]);
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("editDialog.")).sort(), keys);
  for (const k of keys) assert.ok(en[k] && fr[k] && !/:\s*$/.test(en[k]) && !/:\s*$/.test(fr[k]) && !/!/.test(en[k] + fr[k]), k);
  assert.doesNotMatch(Object.values(fr).filter((v, i) => Object.keys(fr)[i].startsWith("editDialog.")).join(" "), /\btu\b|\bton\b|\bta\b/i);
});
