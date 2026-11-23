// "Add a skin" and the list of added skins, as automatic checks of the rules of docs/ERGONOMIE-ADMIN.md (the real components rendered with react-dom/server, EN and FR):
//  - ONE entry with two ways (a file, an address), the other way is hidden, not removed (R1, R19);
//  - the address path: one field on the short path (R2, R4), the code field only when the repository refuses (R7), ONE main button per step with a precise verb (R3),
//    each button right under the fields it works on, the long reading folded under ONE "Details" line (R2, R7), no tick box, no filler (R32, R33);
//  - the list of added skins: ONE table with an origin column (colour AND text, R30), a state chip per private repository (R33), at most two visible actions per row (R16),
//    the rest in a menu and in windows, a secret never shown as an empty field (R33.3), a live search from the start (R15);
//  - words: no code word (R9), short labels without a colon (R10), no exclamation (R13), FR and EN parity (R29).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
after(() => db.close());
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { appearanceLabels } = await import("@/app/admin/(panel)/appearance/labels");
const { AppearanceLabelsProvider } = await import("@/app/admin/(panel)/appearance/AppearanceLabels");
const { AddSkin } = await import("@/app/admin/(panel)/appearance/AddSkin");
const { PersonalRepo } = await import("@/app/admin/(panel)/appearance/PersonalRepo");
const { SkinActions } = await import("@/app/admin/(panel)/appearance/ManageSkin");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");

const URL_ = "https://github.com/etoile-nord/skin-prive";
const REPO = "etoile-nord/skin-prive";
const SUMMARY = { ok: true, mode: "summary", url: URL_, skinId: "etoile-nord", origin: "personal", compatible: true, installable: true, name: { fr: "Etoile du nord", en: "Etoile du nord" }, description: { fr: "Un vitrail.", en: "A stained glass." },
  version: "1.2.0", author: "Camille", license: "MIT", modes: ["light", "dark"], sizeKb: 350, assets: [{ file: "fonts/a.woff2", kind: "font", license: "OFL-1.1", author: "Camille" }], readme: "# Etoile du nord", licenseText: "MIT License",
  previews: [{ alt: "Home", dataUrl: "data:image/webp;base64,AAAA" }], issues: ["A note."], unreadable: [] };
const esc = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const count = (html, re) => (html.match(re) ?? []).length;
const wrap = (locale, el) => renderToStaticMarkup(React.createElement(HelpTipProvider, { label: "Help: {name}" }, React.createElement(AppearanceLabelsProvider, { labels: appearanceLabels(makeTranslator(locale)) }, el)));
const repo = (locale, initial) => wrap(locale, React.createElement(PersonalRepo, { locale, initial }));
const add = (locale, initial) => wrap(locale, React.createElement(AddSkin, { locale, initial }));
const SKIN = { id: "etoile-nord", name: "Etoile du nord", version: "1.2.0", source: "personal", active: false, status: "ok", pictures: 0, repo: URL_, access: { state: "configured", repo: REPO } };
const actions = (locale, skin = {}, initial) => wrap(locale, React.createElement(SkinActions, { skin: { ...SKIN, ...skin }, initial }));
/** The form fields a person can type in (hidden inputs, radios and the file input are not fields). */
const fields = (html) => [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].filter((m) => !/type="(hidden|radio|file|checkbox)"/.test(m[0])).length;

for (const locale of ["fr", "en"]) {
  const t = makeTranslator(locale);

  test(`[${locale}] one entry, two ways: a file and an address; both panels exist, only the chosen one is shown`, () => {
    const html = add(locale);
    assert.equal(count(html, /role="tab"/g), 2, "two ways, side by side, as tabs (not form fields)");
    assert.equal(count(html, /type="radio"/g), 0);
    assert.ok(html.includes(esc(t("appearance.way.label"))) && html.includes(esc(t("appearance.way.file"))) && html.includes(esc(t("appearance.way.address"))));
    assert.match(html, /<div data-way="file"[^>]*><section[^>]*data-testid="upload-skin"/, "the file panel is shown first");
    assert.match(html, /<div hidden="" data-way="address"[^>]*>/, "the address panel is kept, hidden");
    assert.match(html, /id="skin-way-file" aria-selected="true"/);
    assert.match(html, /id="skin-way-address" aria-selected="false"/);
    assert.match(add(locale, { way: "address" }), /<div hidden="" data-way="file"[^>]*>/);
    assert.equal(count(html, /data-testid="add-skin"/g), 1);
  });

  test(`[${locale}] address, start: one visible field with its example, ONE main button "Check the address", no code field, no tick box, no second heading`, () => {
    const html = repo(locale);
    assert.equal(fields(html), 1);
    assert.equal(count(html, /type="checkbox"/g), 0);
    assert.equal(count(html, /type="password"/g), 0, "no code field until the repository refuses (R7)");
    assert.ok(html.includes(esc(t("appearance.personal.urlHelp"))), "example under the field (R11)");
    assert.equal(count(html, /<button[^>]*data-testid="address-check"/g), 1);
    assert.ok(html.includes(`>${esc(t("appearance.address.check"))}<`));
    assert.equal(count(html, /<details|<h[1-6]/g), 0, "nothing folded or titled before there is something to fold");
  });

  test(`[${locale}] address, refused: the code field appears UNDER the address, the error under the right field, and the one button (now "Check with this code") is right below the code`, () => {
    const html = repo(locale, { url: URL_, needsCode: true, urlError: t("skins.error.access") });
    const at = (needle) => html.indexOf(needle);
    assert.equal(fields(html), 2);
    assert.ok(at('id="repoUrl"') < at(esc(t("skins.error.access"))) && at(esc(t("skins.error.access"))) < at('name="code"') && at('name="code"') < at('data-testid="address-check"'), "address, its error, the code, then the button");
    assert.ok(html.includes(`>${esc(t("appearance.address.checkCode"))}<`) && !html.includes(`>${esc(t("appearance.address.check"))}<`));
    const bad = repo(locale, { url: URL_, needsCode: true, codeError: t("access.error.rejected") });
    assert.ok(bad.indexOf(esc(t("access.error.rejected"))) > bad.indexOf('name="code"') && bad.indexOf(esc(t("access.error.rejected"))) < bad.indexOf('data-testid="address-check"'), "a wrong code: the cause under the code field, button after it");
  });

  test(`[${locale}] address, summary: what will be added, ONE main button "Add this skin", the sentence about who is responsible beside it, no tick box, the long reading folded under ONE "Details" line`, () => {
    const html = repo(locale, { view: SUMMARY });
    assert.ok(html.includes("Etoile du nord") && html.includes('data-testid="inspect-panel"') && html.includes('data-testid="inspect-permissions"'));
    assert.equal(count(html, /<button[^>]*data-testid="address-add"/g), 1);
    assert.ok(html.includes(`>${esc(t("appearance.personal.add"))}<`));
    assert.ok(html.includes('data-testid="address-trust"') && html.includes(esc(t("appearance.file.trust"))));
    assert.equal(count(html, /type="checkbox"/g), 0);
    assert.equal(fields(html), 0, "nothing to type any more");
    assert.equal(count(html, /<details/g), 1, "one fold");
    assert.ok(html.includes(esc(`${t("appearance.details.readme")} · ${t("appearance.details.license")} · ${t("appearance.details.notes", { n: 1 })} · ${t("appearance.details.files", { n: 1 })}`)), "the fold says what is inside");
    assert.ok(html.includes(`>${esc(t("appearance.address.change"))}<`), "a way back to the address");
    assert.ok(!html.includes('data-testid="address-check"'), "the first button is gone: one main button per step");
    assert.ok(!html.includes(esc(t("appearance.personal.mustConfirm"))), "no error before anything was clicked");
  });

  test(`[${locale}] address, a skin that cannot be read: the reason is shown and there is no Add button`, () => {
    const html = repo(locale, { view: { ...SUMMARY, installable: false, unreadable: ["Too pale."] } });
    assert.ok(html.includes("Too pale.") && html.includes('role="alert"'));
    assert.ok(!html.includes('data-testid="address-add"'));
  });

  test(`[${locale}] address, install refused: the cause is said under the button; added: ONE main button "Use this skin" and a quiet "Keep as is"`, () => {
    const err = repo(locale, { view: SUMMARY, installError: t("skins.error.failed") });
    assert.ok(err.indexOf(esc(t("skins.error.failed"))) > err.indexOf('data-testid="address-add"'));
    const done = repo(locale, { added: { id: "etoile-nord", name: "Etoile du nord" } });
    assert.ok(done.includes(esc(t("appearance.file.added", { name: "Etoile du nord" }))) && done.includes(`>${esc(t("appearance.file.use"))}<`) && done.includes(`>${esc(t("appearance.file.keep"))}<`));
    assert.equal(count(done, /bg-accent/g), 1, "one main button");
  });

  test(`[${locale}] a code already saved: ONE summary line and ONE visible button ("Edit"); "Remove access" is inside that window, with "Leave empty to keep the current one"; no field outside it`, () => {
    const html = repo(locale, { url: URL_, access: { state: "configured", repo: REPO } });
    assert.equal(count(html, new RegExp(`>${esc(t("access.edit"))}<`, "g")), 1);
    const outside = html.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
    assert.ok(!outside.includes(esc(t("access.remove"))), "not visible outside the window");
    assert.ok(html.includes(esc(t("access.remove"))) && html.includes(esc(t("access.field.keep"))));
    assert.equal(count(outside, /type="password"/g), 0);
  });

  test(`[${locale}] an added skin: three windows, none open at the start; each says what it does and the loss is named`, () => {
    assert.equal(count(actions(locale), /<dialog/g), 3 + 0, "update, access, remove (no earlier version here)");
    assert.equal(count(actions(locale, { previousVersion: "1.1.0" }), /<dialog/g), 4);
    const remove = actions(locale, { active: true, pictures: 3 }, { open: "remove" });
    assert.ok(remove.includes(esc(t("appearance.remove.confirm", { name: SKIN.name }))), "what is removed, and that the content stays");
    assert.ok(remove.includes(esc(t("appearance.remove.active"))), "what replaces the current skin");
    assert.ok(remove.includes(esc(t("appearance.cz.removePictures", { count: 3 }))));
    assert.ok(remove.includes(`>${esc(t("appearance.remove.do"))}<`));
    const upd = actions(locale, {}, { open: "update", update: { ok: true, available: true, target: "2.0.0", level: "major" } });
    assert.ok(upd.includes(esc(t("appearance.update.available", { version: "2.0.0" }))) && upd.includes(esc(t("appearance.update.major"))) && upd.includes(esc(t("appearance.update.acceptMajor"))), "a big update needs the person to say so");
    assert.match(upd, /name="acceptMajor"[^>]*required|required=""[^>]*name="acceptMajor"/);
    const same = actions(locale, {}, { open: "update", update: { ok: true, available: false } });
    assert.ok(same.includes(esc(t("appearance.update.none"))) && !same.includes(`>${esc(t("appearance.update.do"))}<`));
    const refused = actions(locale, {}, { open: "update", update: { ok: true, available: false, access: true } });
    assert.ok(refused.includes(esc(t("appearance.update.access"))));
  });

  test(`[${locale}] an added skin: at most two visible actions; the main one follows the state; a degraded access is fixed from the first button`, () => {
    const visible = (html) => {
      const bar = html.replace(/<dialog[\s\S]*?<\/dialog>/g, "");
      const menu = bar.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
      return { menu, direct: count(bar.replace(menu, ""), /<button/g) + (menu ? 1 : 0), all: bar };
    };
    const ok = visible(actions(locale));
    assert.equal(ok.direct, 2, "one button and the menu");
    assert.ok(ok.all.includes(`>${esc(t("appearance.update.check"))}</button>`));
    assert.ok(ok.menu.includes(esc(t("appearance.manage.access"))) && ok.menu.includes(esc(t("appearance.remove.do"))));
    const degraded = visible(actions(locale, { access: { state: "reenter", repo: REPO } }));
    assert.ok(degraded.all.indexOf(esc(t("appearance.manage.access"))) < degraded.all.indexOf("<details"), "the first button is Edit access");
    assert.ok(degraded.menu.includes(esc(t("appearance.update.check"))));
    const file = visible(actions(locale, { repo: undefined, access: undefined, upload: { date: "2026-11-19", print: "ab12cd34ef56" } }));
    assert.equal(file.direct, 1, "a skin added from a file has only the menu");
    assert.ok(!file.menu.includes(esc(t("appearance.manage.access"))));
    const win = actions(locale, { access: { state: "reenter", repo: REPO } }, { open: "access" });
    assert.ok(win.includes(esc(t("access.reenter.why"))) && win.includes(esc(t("access.field.example"))) && win.includes(esc(t("access.edit.save"))), "the reason and the way out, in the window");
    assert.ok(actions(locale, {}, { open: "access" }).includes(esc(t("access.field.keep"))), "a code that works: an empty field keeps it");
    for (const html of [win, ok.all]) assert.ok(!/<input[^>]*type="password"[^>]*value="[^"]+"/.test(html), "a password field is never pre-filled");
  });
}

test("words of the new texts: no code word (R9), labels short and without colon (R10), no exclamation or 'Please' (R13), sentences of 20 words at most, same keys and variables in EN and FR (R29)", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const mine = (d) => Object.keys(d).filter((k) => /^appearance\.(way|address|origin|details\.(readme|license|notes|files)|manage\.|update\.dialog|revert\.do|personal\.help)/.test(k));
  assert.deepEqual(mine(en), mine(fr));
  assert.ok(mine(en).length >= 20);
  const banned = /\b(token|jeton|cl[ée]|slug|webhook|payload|api|json|cache|hash|oauth|identifiant|instance|route|service)\b/i;
  for (const [lang, d] of [["en", en], ["fr", fr]]) for (const k of mine(en)) {
    const text = d[k];
    assert.equal(typeof text, "string", `${lang} ${k}`);
    assert.ok(!banned.test(text) && !/!|Veuillez|Please/.test(text), `${lang} ${k}: ${text}`);
    assert.ok(text.length <= 60 || /\.$/.test(text), `${lang} ${k}: a label of at most 60 characters`);
    if (!/\.$/.test(text)) assert.ok(!/:/.test(text), `${lang} ${k}: no colon in a label`);
    for (const sentence of text.split(/(?<=[.?])\s+(?=[A-ZÉ])/)) assert.ok(sentence.split(/\s+/).length <= 20, `${lang} ${k}`);
    assert.deepEqual([...(en[k].match(/\{\w+\}/g) ?? [])].sort(), [...(fr[k].match(/\{\w+\}/g) ?? [])].sort(), `variables ${k}`);
  }
  for (const gone of ["appearance.personal.summary", "appearance.personal.check", "appearance.personal.warning", "appearance.personal.understood", "appearance.personal.activate", "appearance.manage.help", "appearance.update.safe", "appearance.remove.explain", "appearance.revert.help"]) {
    assert.ok(!(gone in en) && !(gone in fr), `${gone} was filler or a duplicate: it is gone`);
  }
});

test("the address path keeps its security properties: the server still demands the confirmation, the code is never rendered, the install goes through the same action", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/appearance/PersonalRepo.tsx", "utf8");
  assert.match(src, /installPersonalAction\(null, fd\)/, "the same install action as before");
  assert.match(src, /fd\.set\("understood", "on"\)/, "the confirmation travels with the click on the one main button");
  assert.match(src, /inspectSkinAction\(u, c \|\| undefined\)/, "the code is sent to the same check");
  const actions = fs.readFileSync("src/app/admin/(panel)/appearance/actions.ts", "utf8");
  assert.match(actions, /if \(fd\.get\("understood"\) !== "on"\) return \{ errors: \{ understood:/, "no install without the confirmation");
  assert.ok(!/value=\{code\}/.test(src.replace(/CodeField[^\n]*value=\{code\}/, "")), "the code is only the value of the controlled code field");
});
