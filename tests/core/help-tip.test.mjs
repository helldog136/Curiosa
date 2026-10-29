import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Bouton d'aide « ? » des formulaires d'administration : règle de seuil, rendu des deux modes, accessibilité, repli sans JavaScript, texte échappé, textes FR/EN,
// bornes de la bulle et non-régression des champs. Le comportement dans un vrai navigateur (survol, toucher, bulle dans l'écran) est vérifié à la main avec Playwright.
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const H = await import("@/components/admin/helpRule");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const F = await import("@/components/admin/Field");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const { FileField } = await import("@/components/admin/FileField");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const read = (f) => fs.readFileSync(f, "utf8");

const SHORT = "Exemple : 500";
const LONG = "Utilisée pour vous répondre : une adresse que vous lisez vraiment, sans espace, avec un @ au milieu.";
const render = (el, locale = "fr") => renderToStaticMarkup(React.createElement(HelpTipProvider, { label: (locale === "fr" ? fr : en)["help.tip"] }, el));
const h = React.createElement;

/* ───────────── règle ───────────── */

test("règle : 60 caractères au plus sur une ligne = sous le champ ; au-delà, ou sur plusieurs lignes = bulle « ? »", () => {
  assert.equal(H.HELP_INLINE_MAX, 60);
  assert.equal(H.isLongHelp("a".repeat(60)), false);
  assert.equal(H.isLongHelp("a".repeat(61)), true);
  assert.equal(H.isLongHelp(SHORT), false, "un exemple très court reste visible");
  assert.equal(H.isLongHelp("Une ligne\nUne autre"), true);
  assert.equal(H.isLongHelp("  " + "a".repeat(60) + "  "), false, "les espaces autour ne comptent pas");
  assert.equal(H.isLongHelp("é".repeat(60)), false);
  assert.equal(H.isLongHelp("😀".repeat(60)), false, "on compte des caractères, pas des octets");
  for (const v of [undefined, null, "", "   "]) assert.equal(H.isLongHelp(v), false, "rien à montrer : jamais de « ? »");
});

/* ───────────── rendu des deux modes ───────────── */

test("aide courte : reste en clair sous le champ, aucun bouton", () => {
  const html = render(h(F.TextField, { label: "Montant", name: "amount", help: SHORT }));
  assert.match(html, /<p class="[^"]*text-muted[^"]*">Exemple : 500<\/p>/);
  assert.ok(!html.includes("data-helptip") && !html.includes("<button") && !html.includes("noscript"));
});

test("aide longue : bouton « ? » à côté du libellé, texte dans la bulle, plus de paragraphe sous le champ", () => {
  const html = render(h(F.TextField, { label: "E-mail", name: "email", help: LONG }));
  assert.ok(html.includes("data-helptip"));
  assert.match(html, /<button[^>]*type="button"/);
  assert.ok(html.includes(LONG), "le texte est bien dans la page (bulle)");
  assert.ok(!/<label[^>]*>[^<]*<[^>]*helptip/.test(html) && !/<label[^>]*>(?:(?!<\/label>).)*<button/.test(html), "le bouton n'est jamais DANS le libellé");
  assert.match(html, /<label[^>]*for="email"[^>]*>E-mail<\/label>/, "le libellé du champ reste « E-mail » tout court");
  // Hors repli sans JavaScript, aucun paragraphe d'aide sous le champ.
  const outside = html.replace(/<noscript>.*?<\/noscript>/g, "");
  assert.ok(!/<p[ >]/.test(outside));
});

test("accessibilité : vrai bouton nommé « Aide : <champ> » (FR/EN), aria-expanded, bulle role=tooltip reliée par aria-describedby", () => {
  for (const [locale, name, expected] of [["fr", "E-mail", "Aide : E-mail"], ["en", "Email", "Help: Email"]]) {
    const html = render(h(F.TextArea, { label: name, name: "x", help: LONG }), locale);
    assert.ok(html.includes(`aria-label="${expected}"`), expected);
    assert.match(html, /aria-expanded="false"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    assert.ok(id, "aria-describedby");
    assert.match(html, new RegExp(`<span[^>]*id="${id.replace(/[:]/g, "\\$&")}"[^>]*role="tooltip"|<span[^>]*role="tooltip"[^>]*id="${id.replace(/[:]/g, "\\$&")}"`), "la bulle porte l'identifiant référencé");
    assert.match(html, /role="tooltip"[^>]*hidden|hidden=""[^>]*role="tooltip"|role="tooltip"[^>]*hidden=""/, "fermée au départ");
  }
});

test("bouton : cible tactile de 44 px (h-11 w-11) avec une icône plus petite, sans jeton --sk-*", () => {
  const src = read("src/components/admin/HelpTip.tsx");
  assert.ok(/h-11 w-11/.test(src) && /h-5 w-5/.test(src));
  assert.ok(!/--sk-|var\(--sk/.test(src) && !/--sk-/.test(read("src/components/admin/helpRule.ts")), "jamais restylé par les skins");
});

test("repli sans JavaScript : le texte s'affiche en clair (noscript) et le bouton est masqué ; en aide courte, rien de tel", () => {
  const html = render(h(F.TextField, { label: "E-mail", name: "email", help: LONG }));
  assert.match(html, /<noscript><style>\[data-helptip\]\{display:none\}<\/style><p class="[^"]*">Utilisée pour vous répondre/);
  assert.ok(!render(h(F.TextField, { label: "x", name: "x", help: SHORT })).includes("noscript"));
});

test("texte seulement : aucun HTML injecté (bulle et repli)", () => {
  const evil = '<img src=x onerror=alert(1)> <script>alert(2)</script> ' + "x".repeat(60);
  for (const el of [h(F.TextField, { label: "A", name: "a", help: evil }), h(F.Select, { label: "A", name: "a", options: [], help: evil }), h(F.Checkbox, { label: "A", name: "a", help: evil })]) {
    const html = render(el);
    assert.ok(!html.includes("<img") && !html.includes("<script"), "balises échappées");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  }
  assert.ok(!read("src/components/admin/HelpTip.tsx").includes("dangerouslySetInnerHTML"));
  // Le nom du champ aussi est échappé dans le libellé accessible.
  const html = render(h(F.TextField, { label: 'A"><b>', name: "a", help: LONG }));
  assert.ok(!html.includes("<b>") && html.includes("aria-label=\"Aide : A&quot;&gt;&lt;b&gt;\""));
});

test("tous les champs d'aide du moteur : aide courte inchangée, aide longue en « ? »", () => {
  const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const makers = {
    TextField: (help) => h(F.TextField, { label: "L", name: "n", help }),
    TextArea: (help) => h(F.TextArea, { label: "L", name: "n", help }),
    Checkbox: (help) => h(F.Checkbox, { label: "L", name: "n", help }),
    Select: (help) => h(F.Select, { label: "L", name: "n", options: opts, help }),
    CheckboxGroup: (help) => h(F.CheckboxGroup, { label: "Catégories", name: "n", options: opts, checked: [], help }),
    FileField: (help) => h(FileField, { f: { name: "n", label: "L", kind: "file", help } }),
    AdminBlockForm: (help) => h(AdminBlockForm, { instanceId: "i", block: { type: "adminForm", action: "go", submit: "OK", fields: [{ name: "n", label: "L", kind: "text", help }] } }),
  };
  for (const [name, make] of Object.entries(makers)) {
    const short = render(make(SHORT));
    assert.ok(short.includes(`>${SHORT}<`) && !short.includes("data-helptip"), `${name} : court en clair`);
    const long = render(make(LONG));
    assert.ok(long.includes("data-helptip") && long.includes('role="tooltip"'), `${name} : long en bulle`);
    assert.equal((long.match(/<button[^>]*aria-label="Aide : /g) ?? []).length, 1, `${name} : un seul bouton d'aide`);
    const none = render(make(undefined));
    assert.ok(!none.includes("data-helptip") && !none.includes("noscript"), `${name} : sans aide, rien`);
  }
});

test("groupe de cases (Catégories) : nommé par sa légende seule, l'aide longue en bulle, l'indication (hint) reste visible", () => {
  const html = render(h(F.CheckboxGroup, { label: "Catégories", name: "cat", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], checked: [], help: LONG, hint: "Choisissez 1 à 2 cases." }));
  assert.match(html, /aria-labelledby="cat__legend"/);
  assert.match(html, /<span id="cat__legend">Catégories<\/span>/);
  assert.match(html, /<p id="cat__note"[^>]*>Choisissez 1 à 2 cases\.<\/p>/, "l'indication reste sous la liste");
  assert.ok(html.includes('aria-label="Aide : Catégories"'));
});

test("les erreurs de champ restent visibles : jamais cachées dans une bulle", () => {
  const errors = read("src/components/admin/FieldErrors.tsx");
  assert.ok(!errors.includes("HelpTip") && !errors.includes("helpRule"));
  assert.match(errors, /data-field-error/);
  // Une erreur est un message distinct de l'aide : même avec une aide longue, rien ne la relie à la bulle.
  const html = render(h(F.TextField, { label: "E-mail", name: "email", help: LONG }));
  assert.ok(!html.includes("data-field-error"));
});

/* ───────────── interaction (logique pure) ───────────── */

const run = (...events) => events.reduce((s, e) => H.tipReducer(s, e), H.TIP_CLOSED);

test("souris : le survol ouvre, la sortie ferme ; un clic l'épingle jusqu'à un second clic", () => {
  assert.deepEqual(run("mouseEnter"), { open: true, pinned: false });
  assert.deepEqual(run("mouseEnter", "mouseLeave"), H.TIP_CLOSED);
  assert.deepEqual(run("mouseEnter", "click", "mouseLeave"), { open: true, pinned: true }, "épinglée : reste ouverte");
  assert.deepEqual(run("mouseEnter", "click", "mouseLeave", "click"), H.TIP_CLOSED);
});

test("clavier : le focus ouvre, Entrée/Espace (clic) épingle puis referme, Échap ferme, quitter le champ ferme", () => {
  assert.equal(run("keyboardFocus").open, true);
  assert.deepEqual(run("click"), { open: true, pinned: true }, "Entrée ou Espace sur un bouton fermé ouvre");
  assert.deepEqual(run("keyboardFocus", "click", "click"), H.TIP_CLOSED);
  assert.deepEqual(run("keyboardFocus", "escape"), H.TIP_CLOSED);
  assert.deepEqual(run("click", "escape"), H.TIP_CLOSED);
  assert.deepEqual(run("click", "escape", "click"), { open: true, pinned: true }, "après Échap, Entrée rouvre");
  assert.deepEqual(run("keyboardFocus", "blur"), H.TIP_CLOSED);
});

test("toucher : un appui ouvre, un second ferme ; un appui ailleurs ou Échap ferme (pas de survol sur téléphone)", () => {
  assert.deepEqual(run("click"), { open: true, pinned: true });
  assert.deepEqual(run("click", "click"), H.TIP_CLOSED);
  assert.deepEqual(run("click", "outside"), H.TIP_CLOSED);
  assert.deepEqual(run("outside"), H.TIP_CLOSED, "fermée : rien ne change");
  const src = read("src/components/admin/HelpTip.tsx");
  assert.match(src, /pointerType === "mouse"/, "le survol ne vaut que pour la souris");
  assert.match(src, /addEventListener\("pointerdown"/);
  assert.match(src, /e\.key === "Escape"/);
});

test("aucun minuteur de fond, aucune bibliothèque, aucun chargement tiers", () => {
  const src = read("src/components/admin/HelpTip.tsx") + read("src/components/admin/helpRule.ts");
  assert.ok(!/setTimeout|setInterval/.test(src));
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports.filter((i) => !i.startsWith(".")), ["react"]);
  assert.ok(!/https?:\/\//.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
});

/* ───────────── position de la bulle ───────────── */

test("bulle : 320 px au plus, jamais plus large que l'écran, ramenée dans l'écran, au-dessus s'il n'y a pas la place en bas", () => {
  const phone = { width: 390, height: 800 };
  const anchor = (left, top) => ({ left, top, width: 44, height: 44 });
  let at = H.placeBubble(anchor(330, 100), { width: 320, height: 90 }, phone);
  assert.ok(at.left + 320 <= 390 - H.HELP_BUBBLE_MARGIN && at.left >= H.HELP_BUBBLE_MARGIN, "ramenée dans l'écran à droite");
  assert.equal(at.top, 144, "sous le bouton");
  assert.equal(at.maxWidth, 320);
  at = H.placeBubble(anchor(0, 100), { width: 320, height: 90 }, phone);
  assert.equal(at.left, H.HELP_BUBBLE_MARGIN);
  at = H.placeBubble(anchor(100, 740), { width: 300, height: 120 }, phone);
  assert.equal(at.top, 620, "au-dessus du bouton");
  at = H.placeBubble(anchor(10, 10), { width: 300, height: 900 }, phone);
  assert.equal(at.top, 54, "trop haute partout : reste en dessous");
  at = H.placeBubble(anchor(10, 10), { width: 300, height: 50 }, { width: 280, height: 600 });
  assert.equal(at.maxWidth, 264, "écran étroit : jamais plus large que l'écran moins les marges");
  assert.ok(at.left >= 8);
});

/* ───────────── textes et branchement ───────────── */

test("textes : « help.tip » existe en FR et en EN avec {name}", () => {
  for (const d of [fr, en]) assert.match(d["help.tip"], /\{name\}/);
  assert.equal(fr["help.tip"], "Aide : {name}");
  assert.equal(H.helpAriaLabel(fr["help.tip"], "E-mail"), "Aide : E-mail");
  const keys = (d) => Object.keys(d).filter((k) => k.startsWith("help.")).sort();
  assert.deepEqual(keys(fr), keys(en));
});

test("branché partout où une aide est rendue sous un champ de formulaire d'administration", () => {
  const wired = [
    "src/components/admin/Field.tsx", "src/components/admin/AdminBlocks.tsx", "src/components/admin/FileField.tsx", "src/components/admin/ChoicePicker.tsx",
    "src/components/admin/MarkdownField.tsx", "src/components/admin/ModuleSettings.tsx", "src/app/admin/(panel)/users/RolesPanel.tsx",
  ];
  for (const f of wired) {
    const src = read(f);
    assert.ok(/HelpBelow|FieldLabel/.test(src), `${f} utilise le composant d'aide`);
    assert.ok(!/\{(?:f\.|opts\.)?help && <p /.test(src), `${f} : plus de paragraphe d'aide écrit à la main`);
  }
  assert.match(read("src/app/admin/(panel)/layout.tsx"), /<HelpTipProvider label=\{t\("help\.tip"\)\}>/);
});

test("pas de changement d'API : le champ `help` des manifestes et des formulaires est inchangé", () => {
  assert.match(read("src/core/modules/types.ts"), /help\?: LocalizedString;/);
  assert.match(read("src/core/blocks.ts"), /help\?: string/);
});
