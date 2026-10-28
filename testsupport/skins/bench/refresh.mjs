// Fabrique les FRAGMENTS du banc d'essai (docs/SKINS.md §14) à partir des VRAIS composants du cœur (src/components/site/*.tsx, rendus avec react-dom/static),
// avec des données de démonstration fixes. Les fragments sont versionnés dans ./fragments/ ; tests/core/skins-bench.test.mjs vérifie qu'ils sont à jour.
//
//   npm run skin:bench:refresh [-- --out <dossier>]
//
// Rien n'est inventé ici : chaque balise vient d'un composant du cœur. Le banc ne remplace que les SOURCES DE DONNÉES (menu, réseaux, modules, réglages : ./stubs/)
// et l'état initial de deux composants à état (menu sobre ouvert, formulaire en erreur : ./hooks.mjs). Les morceaux de page que le cœur écrit dans les fichiers
// de pages (liste, fiche, 404, confidentialité, accueil) sont transcrits ici ; tests/core/skins-bench.test.mjs vérifie que leurs pièces sont bien celles des pages du cœur.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { prerender } from "react-dom/static";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : path.join(HERE, "fragments"));

const { demoConfig } = await import("./stubs/settings.mjs");
const { Header } = await import("@/components/site/Header");
const { Footer } = await import("@/components/site/Footer");
const { Blocks } = await import("@/components/site/Blocks");
const { EntryList } = await import("@/components/site/EntryList");
const { Pagination } = await import("@/components/site/Pagination");
const { Markdown } = await import("@/components/site/Markdown");
const { CoverImage } = await import("@/components/site/CoverImage");
const { EntryIcon } = await import("@/components/site/EntryIcon");
const { CopyCode } = await import("@/components/site/CopyCode");
const { CookieTray } = await import("@/components/site/CookieTray");
const { ModuleForm } = await import("@/components/site/ModuleForm");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { TRAY_TEXT_KEYS } = await import("@/core/cookieTray");
const { buildPrivacyPolicy } = await import("@/core/privacy");

const h = React.createElement;

async function render(element, prefix) {
  const { prelude } = await prerender(element, { identifierPrefix: prefix });
  const chunks = [];
  const reader = prelude.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  // React 19 ajoute des <link rel="preload"> pour les images d'un rendu statique : sans importance ici
  return Buffer.concat(chunks).toString("utf8").replace(/<link [^>]*>/g, "");
}

// ── données de démonstration (neutres : aucun nom réel) ────────────────────────────────────────────────────────────
const img = (n) => `/uploads/00000000-0000-4000-8000-00000000000${n}.png`;
const DATE = (d) => new Date(`2026-0${d}-12T10:00:00.000Z`);
const TEXT = {
  fr: {
    entries: [
      ["Premier article", "Un court résumé de ce premier article, pour voir comment le texte se range dans une carte."],
      ["Un titre un peu plus long pour voir comment il passe à la ligne dans une carte", "Résumé plus long : il contient plusieurs phrases afin de montrer l'interligne et la largeur de lecture du texte courant dans la pièce."],
      ["Sans image", "Une entrée sans couverture."],
      ["Quatrième", "Encore un exemple."],
      ["Cinquième", "Et un dernier pour remplir la grille."],
      ["Sixième", "Une carte de plus."],
    ],
    lead: "Un chapeau d'introduction qui résume l'article en une ou deux phrases.",
    body: "Un paragraphe de texte courant avec un [lien dans le texte](/blog) et un [lien externe](https://example.org/page), du **gras**, de l'*italique* et du ~~texte barré~~. Il est assez long pour passer à la ligne sur un téléphone et montrer l'interligne.\n\n## Un titre de niveau deux\n\nUn autre paragraphe, suivi d'une liste :\n\n- un premier point\n- un deuxième point, un peu plus long pour voir le retour à la ligne dans une liste à puces\n- un troisième point\n\n### Un titre de niveau trois\n\n1. première étape\n2. deuxième étape\n3. troisième étape\n\n> Une citation, pour voir comment elle se détache du texte courant.\n\nDu `code en ligne` dans une phrase, puis un bloc :\n\n```\nligne 1 du bloc de code\nune ligne beaucoup plus longue que les autres pour montrer le défilement horizontal du bloc sur un téléphone\n```\n\n| Colonne A | Colonne B | Colonne C |\n|---|---|---|\n| valeur 1 | valeur 2 | valeur 3 |\n| une autre | encore une | et la dernière |\n\n---\n\n![Une image d'illustration](/uploads/00000000-0000-4000-8000-000000000005.png)\n\n#### Un titre de niveau quatre\n\n##### Un titre de niveau cinq\n\n###### Un titre de niveau six\n\nUn dernier paragraphe pour finir.",
    hero: { title: "Bienvenue", text: "Une phrase d'accroche qui présente le site en quelques mots.", eyebrow: "Petite ligne", button: { label: "Découvrir", href: "/blog" } },
    panels: { eyebrow: "Nouveau", mediaTitle: "Un bloc avec des images", tabsTitle: "Un bloc à onglets", statsTitle: "Quelques chiffres", ctaTitle: "Un appel à l'action", text: "Un texte court qui accompagne le bloc.", tabs: ["Premier onglet", "Deuxième onglet", "Troisième onglet"], stat: ["Un chiffre", "Un autre", "Le dernier"], button: "Un bouton" },
    banner: ["Une information importante", "Une réussite", "Un avertissement"],
    links: ["Un lien", "Un autre lien", "Encore un lien"],
    swatches: ["Rouge", "Bleu", "Vert", "Jaune"],
    downloads: ["Une image", "Une autre image"],
    copy: { label: "Phrase à copier", text: "Une courte phrase de présentation que l'on peut copier d'un clic." },
    form: { fields: [["nom", "Votre nom", "text", true], ["email", "Votre adresse e-mail", "email", true], ["message", "Votre message", "textarea", false]], submit: "Envoyer", ok: "Merci, c'est envoyé.", error: "Le message n'a pas pu être envoyé. Réessayez dans un instant." },
    listName: "Blog", listDescription: "Les derniers articles.", contactName: "Contact", articleTitle: "Un article d'exemple", field: ["Auteur", "Une personne"],
  },
  en: {
    entries: [
      ["First article", "A short summary of this first article, to see how the text fits in a card."],
      ["A slightly longer title to see how it wraps inside a card", "A longer summary: it has several sentences to show the line spacing and the reading width of body text in the part."],
      ["No picture", "An entry without a cover."],
      ["Fourth", "Another example."],
      ["Fifth", "And one more to fill the grid."],
      ["Sixth", "One more card."],
    ],
    lead: "An introduction that sums the article up in a sentence or two.",
    body: "A paragraph of body text with an [inline link](/en/blog) and an [external link](https://example.org/page), some **bold**, some *italic* and some ~~struck text~~. It is long enough to wrap on a phone and show the line spacing.\n\n## A level two heading\n\nAnother paragraph, followed by a list:\n\n- a first point\n- a second point, a little longer to see the wrapping inside a bullet list\n- a third point\n\n### A level three heading\n\n1. first step\n2. second step\n3. third step\n\n> A quotation, to see how it stands out from the body text.\n\nSome `inline code` in a sentence, then a block:\n\n```\nline 1 of the code block\na much longer line than the others to show the horizontal scrolling of the block on a phone\n```\n\n| Column A | Column B | Column C |\n|---|---|---|\n| value 1 | value 2 | value 3 |\n| another | one more | and the last |\n\n---\n\n![An illustration](/uploads/00000000-0000-4000-8000-000000000005.png)\n\n#### A level four heading\n\n##### A level five heading\n\n###### A level six heading\n\nA last paragraph to finish.",
    hero: { title: "Welcome", text: "A catchy sentence that introduces the site in a few words.", eyebrow: "Small line", button: { label: "Discover", href: "/en/blog" } },
    panels: { eyebrow: "New", mediaTitle: "A block with pictures", tabsTitle: "A block with tabs", statsTitle: "A few figures", ctaTitle: "A call to action", text: "A short text that goes with the block.", tabs: ["First tab", "Second tab", "Third tab"], stat: ["A figure", "Another", "The last"], button: "A button" },
    banner: ["An important notice", "A success", "A warning"],
    links: ["A link", "Another link", "One more link"],
    swatches: ["Red", "Blue", "Green", "Yellow"],
    downloads: ["A picture", "Another picture"],
    copy: { label: "Sentence to copy", text: "A short introduction sentence that can be copied with one click." },
    form: { fields: [["nom", "Your name", "text", true], ["email", "Your email address", "email", true], ["message", "Your message", "textarea", false]], submit: "Send", ok: "Thank you, it was sent.", error: "The message could not be sent. Please try again in a moment." },
    listName: "Blog", listDescription: "The latest articles.", contactName: "Contact", articleTitle: "A sample article", field: ["Author", "A person"],
  },
};

const instance = { key: "blog", basePath: "blog", display: "cards", clickAction: "page" };
function entriesFor(L, over = {}) {
  return TEXT[L].entries.map(([title, summary], i) => ({
    id: `e${i}`, instanceId: "i", instanceKey: "blog", basePath: "blog", slug: `article-${i + 1}`, locale: L, isFallback: i === 3 && L === "en", title, summary, body: "",
    cover: i === 2 || i === 4 ? null : img(1 + (i % 4)), icon: null, url: i === 3 ? "https://example.org/ext" : null, code: i === 1 ? "EXEMPLE-2026" : null, featured: false, tags: [], expired: i === 5,
    publishedAt: DATE(1 + i), expiresAt: null, fields: {}, availableLocales: [L], translations: [{ locale: L, slug: `article-${i + 1}` }], ...over,
  }));
}

const CFG = (L, over = {}) => demoConfig({ locale: L, ...over });
const blocks = (L, list) => h(Blocks, { blocks: list, locale: L });

function panelBlocks(L) {
  const p = TEXT[L].panels;
  return [
    { type: "panel", kind: "media", eyebrow: p.eyebrow, title: p.mediaTitle, text: p.text, button: { label: p.button, href: "/blog" }, images: [img(1), img(2), img(3)], imageSide: "right", tone: "plain" },
    { type: "panel", kind: "tabs", title: p.tabsTitle, text: p.text, items: p.tabs.map((t, i) => ({ title: t, heading: `${t} — ${i + 1}`, text: p.text, image: i === 1 ? img(2) : undefined })), images: [img(1), img(4)] },
    { type: "panel", kind: "stats", title: p.statsTitle, items: p.stat.map((t, i) => ({ title: String((i + 1) * 128), heading: t })), tone: "surface" },
    { type: "panel", kind: "cta", title: p.ctaTitle, text: p.text, button: { label: p.button, href: "/blog" }, tone: "accent" },
    { type: "panel", kind: "media", title: p.mediaTitle, text: p.text, button: { label: p.button, href: "/blog" }, bg: { src: img(2), size: "cover", position: "center", veil: "dark" } },
  ];
}
function bannerBlocks(L) { const b = TEXT[L].banner; return [{ type: "banner", text: b[0], tone: "info", href: "/blog" }, { type: "banner", text: b[1], tone: "success" }, { type: "banner", text: b[2], tone: "warning" }]; }
function miscBlocks(L) {
  const T = TEXT[L];
  return [
    { type: "heading", text: T.panels.statsTitle },
    { type: "links", items: T.links.map((label, i) => ({ label, href: i === 2 ? "https://example.org" : "/blog" })) },
    { type: "swatches", items: T.swatches.map((name, i) => ({ name, hex: ["#d1495b", "#2e86ab", "#3d9970", "#f2c14e"][i], role: i === 0 ? "principal" : undefined })) },
    { type: "downloads", items: T.downloads.map((label, i) => ({ src: img(1 + i), label, detail: "PNG" })) },
    { type: "copy", label: T.copy.label, text: T.copy.text },
    { type: "table", columns: ["A", "B", "C"], rows: [["1", "2", "3"], ["4", "5", "6"]] },
    { type: "markdown", text: T.lead },
  ];
}

const out = new Map();   // nom → { html, parts }
const add = (name, html) => out.set(name, html);

async function fragmentsFor(L) {
  const t = makeTranslator(L);
  const T = TEXT[L];
  const pre = (n) => `${L}-${n}-`;
  const ap = (modeSwitch, dark = true) => ({ dark, modeSwitch });
  const logos = { wide: img(1), square: img(2), wideDark: img(3), squareDark: img(4), favicon: null, share: null };

  // En-tête : quatre mises en page, avec et sans la bascule clair/sombre du visiteur ; un en-tête avec logos à deux variantes.
  for (const layout of ["classic", "twoRows", "centered", "minimal"]) {
    for (const sw of [false, true]) {
      const cfg = CFG(L, { header: { ...CFG(L).header, layout } });
      add(`${L}/header-${layout}${sw ? "-switch" : ""}`, await render(h(await Header({ config: cfg, locale: L, appearance: ap(sw) }).then((x) => () => x)), pre(`h-${layout}-${sw}`)));
    }
  }
  add(`${L}/header-classic-logo`, await render(h(await Header({ config: CFG(L, { logos, header: { ...CFG(L).header } }), locale: L, appearance: ap(true) }).then((x) => () => x)), pre("h-logo")));
  add(`${L}/header-nobutton`, await render(h(await Header({ config: CFG(L, { header: { layout: "classic", socials: false, secondary: null, button: null } }), locale: L, appearance: ap(false) }).then((x) => () => x)), pre("h-nb")));
  globalThis.__benchMenuOpen = true;
  for (const sw of [false, true]) add(`${L}/header-minimal-open${sw ? "-switch" : ""}`, await render(h(await Header({ config: CFG(L, { header: { ...CFG(L).header, layout: "minimal" } }), locale: L, appearance: ap(sw) }).then((x) => () => x)), pre(`h-mo${sw}`)));
  globalThis.__benchMenuOpen = false;

  add(`${L}/footer`, await render(h(await Footer({ config: CFG(L), locale: L }).then((x) => () => x)), pre("f")));
  const labels = Object.fromEntries(TRAY_TEXT_KEYS.map((k) => [k, t(`cookies.${k}`)]));
  const privacyHref = L === "fr" ? "/privacy#cookies" : "/en/privacy#cookies";
  add(`${L}/tray`, await render(h(CookieTray, { labels, privacyHref, initialOpen: true }), pre("t")));
  add(`${L}/tray-closed`, await render(h(CookieTray, { labels, privacyHref, initialOpen: false }), pre("tc")));

  // Blocs de page (Blocks du cœur)
  const hero = { type: "hero", ...T.hero, image: img(2) };
  add(`${L}/block-hero`, await render(h(await Blocks({ blocks: [hero], locale: L }).then((x) => () => x)), pre("b-hero")));
  add(`${L}/block-hero-plain`, await render(h(await Blocks({ blocks: [{ type: "hero", title: T.hero.title }], locale: L }).then((x) => () => x)), pre("b-hero2")));
  for (const [i, kind] of ["media", "tabs", "stats", "cta", "media-bg"].entries()) add(`${L}/block-panel-${kind}`, await render(h(await Blocks({ blocks: [panelBlocks(L)[i]], locale: L }).then((x) => () => x)), pre(`b-p${i}`)));
  add(`${L}/block-banners`, await render(h(await Blocks({ blocks: bannerBlocks(L), locale: L }).then((x) => () => x)), pre("b-ban")));
  add(`${L}/block-misc`, await render(h(await Blocks({ blocks: miscBlocks(L), locale: L }).then((x) => () => x)), pre("b-misc")));

  // Listes d'entrées et pagination
  const e = entriesFor(L);
  for (const display of ["cards", "list", "links", "codes"]) add(`${L}/entries-${display}`, await render(h(EntryList, { entries: e, collection: { display, clickAction: "page" }, locale: L, defaultLocale: "fr" }), pre(`e-${display}`)));
  add(`${L}/entries-empty`, await render(h(EntryList, { entries: [], collection: instance, locale: L, defaultLocale: "fr" }), pre("e-empty")));
  add(`${L}/pagination`, await render(h(Pagination, { page: 3, pages: 9, base: L === "fr" ? "/blog" : "/en/blog", t }), pre("pg")));

  // Formulaire (idle, en erreur) : le composant du cœur, dans deux états
  const form = { action: "demo/contact", fields: T.form.fields.map(([name, label, kind, required]) => ({ name, label, kind, required })), submitLabel: T.form.submit, successText: T.form.ok };
  add(`${L}/form`, await render(h(ModuleForm, form), pre("fm")));
  globalThis.__benchFormState = "error"; globalThis.__benchFormMessage = T.form.error;
  add(`${L}/form-error`, await render(h(ModuleForm, form), pre("fe")));
  globalThis.__benchFormState = "sending";
  add(`${L}/form-sending`, await render(h(ModuleForm, form), pre("fs")));
  globalThis.__benchFormState = "done"; globalThis.__benchFormMessage = T.form.ok;
  add(`${L}/form-done`, await render(h(ModuleForm, form), pre("fd")));
  delete globalThis.__benchFormState; delete globalThis.__benchFormMessage;

  // Markdown riche (prose)
  add(`${L}/prose`, await render(h(Markdown, { text: T.body }), pre("md")));

  // ── Pages (le cœur écrit ces morceaux dans les fichiers de pages : transcrits, pièces vérifiées par test)
  const listPath = L === "fr" ? "/blog" : "/en/blog";
  const listPage = async (display, n) => {
    const entries = entriesFor(L).slice(0, n);
    return render(h("div", { className: "space-y-8" },
      h("header", { className: "space-y-2" },
        h("h1", { "data-skin-part": "heading", "data-level": "1", className: "text-3xl font-bold" }, T.listName),
        h("p", { "data-skin-part": "lead", className: "text-muted" }, T.listDescription)),
      h(EntryList, { entries, collection: { display, clickAction: "page" }, locale: L, defaultLocale: "fr" }),
      h(Pagination, { page: 2, pages: 5, base: listPath, t })), pre(`p-list-${display}`));
  };
  add(`${L}/page-list`, await listPage("cards", 6));
  add(`${L}/page-list-plain`, await listPage("list", 6));
  add(`${L}/page-list-links`, await listPage("links", 6));

  const article = entriesFor(L)[1];
  const dtf = new Intl.DateTimeFormat(L, { dateStyle: "long" });
  add(`${L}/page-article`, await render(h("article", { lang: L, className: "mx-auto max-w-[var(--sk-prose-width-wide,48rem)] space-y-6" },
    h(CoverImage, { src: img(1), variant: "article" }),
    h("header", { className: "space-y-2" },
      h("h1", { "data-skin-part": "heading", "data-level": "1", className: "flex items-center gap-3 text-3xl font-bold" }, h(EntryIcon, { icon: null, className: "h-7 w-7" }), T.articleTitle),
      h("time", { className: "text-sm text-muted", dateTime: article.publishedAt.toISOString() }, dtf.format(article.publishedAt)),
      h("p", { "data-skin-part": "lead", className: "text-lg text-muted" }, T.lead)),
    h("div", { className: "flex flex-wrap items-center gap-4" },
      h(CopyCode, { code: "EXEMPLE-2026", copyLabel: t("site.copy"), copiedLabel: t("site.copied") }),
      h("a", { href: "https://example.org/ext", target: "_blank", rel: "noopener noreferrer", "data-skin-part": "button", className: "rounded-button bg-accent px-5 py-2 text-sm font-medium text-accent-fg" }, t("site.visit")),
      h("span", { className: "text-sm text-muted" }, t("site.expiresOn", { date: new Intl.DateTimeFormat(L, { dateStyle: "medium" }).format(DATE(9)) }))),
    h(Markdown, { text: T.body }),
    h("dl", { className: "grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm" }, h("div", { className: "contents" }, h("dt", { className: "text-muted" }, T.field[0]), h("dd", null, T.field[1])))), pre("p-article")));

  add(`${L}/page-contact`, await render(h("div", { className: "space-y-8" },
    h("h1", { "data-skin-part": "heading", "data-level": "1", className: "text-3xl font-bold" }, T.contactName),
    await Blocks({ blocks: [{ type: "form", ...form }], locale: L }).then((x) => x)), pre("p-contact")));

  add(`${L}/page-notfound`, await render(h("div", { className: "space-y-4 py-16 text-center" },
    h("h1", { "data-skin-part": "heading", "data-level": "1", className: "text-4xl font-bold" }, "404"),
    h("p", { "data-skin-part": "lead", className: "text-muted" }, t("site.notFound")),
    h("a", { href: "/", "data-skin-part": "link", className: "text-link hover:underline" }, t("site.backHome"))), pre("p-404")));

  const policy = buildPrivacyPolicy({ siteName: CFG(L).name, contactEmail: "contact@example.org", statsEnabled: false, newsToggle: true, modeSwitch: true, features: [], extra: "", t });
  add(`${L}/page-privacy`, await render(h("article", { className: "mx-auto max-w-[var(--sk-prose-width-wide,48rem)] space-y-4 py-6" },
    h("h1", { "data-skin-part": "heading", "data-level": "1", className: "text-3xl font-bold tracking-tight" }, t("privacy.title")),
    h(Markdown, { text: policy }),
    h("p", { id: "cookies", "data-testid": "privacy-cookie-control", "data-skin-part": "notice", "data-tone": "info", className: "scroll-mt-24 rounded-card border-token border-line p-4 text-sm" }, h("a", { href: "#cookies", "data-skin-part": "link", className: "font-semibold text-link underline underline-offset-2" }, t("cookies.manage")))), pre("p-priv")));

  // Accueil fluide (page.tsx du cœur) : des morceaux de chaque taille
  const cell = (size, children, isolated = false) => h("div", { "data-skin-part": "home-cell", "data-size": size, className: `vh-cell vh-${size}${isolated ? " vh-isolated" : ""}` }, isolated ? h("div", { className: "vh-solo" }, children) : children);
  const P = panelBlocks(L);
  const home = [
    ["full", [hero]], ["large", [P[0]]], ["medium", [{ type: "entries-demo" }]], ["medium", [P[2]]], ["small", [{ type: "links", items: T.links.map((label) => ({ label, href: "/blog" })) }]],
    ["small", [{ type: "copy", label: T.copy.label, text: T.copy.text }]], ["small", [P[3]]],
  ];
  const cells = [];
  for (const [i, [size, bl]] of home.entries()) {
    const node = bl[0].type === "entries-demo"
      ? h("section", { "data-skin-part": "entries", className: "space-y-4" }, h("div", { className: "flex items-baseline justify-between gap-4" }, h("h2", { "data-skin-part": "heading", "data-level": "2", "data-marker": "", className: "text-2xl font-semibold" }, T.listName), h("a", { href: listPath, "data-skin-part": "link", className: "text-sm text-link hover:underline" }, t("site.seeAll"))), h(EntryList, { entries: entriesFor(L).slice(0, 2), collection: { display: "list", clickAction: "page" }, locale: L, defaultLocale: "fr" }))
      : await Blocks({ blocks: bl, locale: L });
    cells.push(cell(size, node, size === "small" && i === home.length - 1));
  }
  add(`${L}/page-home`, await render(h("div", { "data-skin-part": "home-flow", className: "vh-flow" }, ...cells.map((c, i) => h(React.Fragment, { key: i }, c))), pre("p-home")));
}

for (const L of ["fr", "en"]) await fragmentsFor(L);

fs.rmSync(OUT, { recursive: true, force: true });
for (const [name, html] of out) {
  const file = path.join(OUT, `${name}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html.endsWith("\n") ? html : `${html}\n`);
}
console.log(`${out.size} fragments écrits dans ${OUT}`);
process.exit(0);
