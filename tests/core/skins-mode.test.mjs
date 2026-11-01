// Bascule clair / sombre du visiteur (docs/SKINS.md §3.8) : script du cœur (faux DOM), route, pièce, logos à deux variantes, confidentialité, aucun cookie.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { makeTempDir } from "../helpers/tmp.mjs";

const S = await import("@/core/skins/modeScript");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { buildPrivacyPolicy } = await import("@/core/privacy");
const read = (p) => fs.readFileSync(p, "utf8");

// ── un faux DOM, juste assez pour le script
function makeDom({ stored, blocked = false } = {}) {
  const store = new Map(stored ? [["curiosa-mode", stored]] : []);
  const root = { attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, getAttribute(k) { return this.attrs.get(k) ?? null; } };
  const button = (value, pressed) => {
    const b = { attrs: new Map([["data-mode-value", value], ["aria-pressed", pressed]]), setAttribute(k, v) { this.attrs.set(k, v); }, getAttribute(k) { return this.attrs.get(k) ?? null; } };
    b.closest = (sel) => (sel === "[data-mode-value]" ? b : null);
    return b;
  };
  const group = { hidden: true, buttons: [button("auto", "true"), button("light", "false"), button("dark", "false")], querySelectorAll(sel) { return sel === "[data-mode-value]" ? this.buttons : []; } };
  const listeners = {};
  const doc = {
    documentElement: root, readyState: "loading",
    querySelectorAll(sel) { return sel === "[data-skin-part=mode-switch]" ? [group] : sel === "[data-mode-value]" ? group.buttons : []; },
    addEventListener(t, f) { (listeners[`doc:${t}`] ??= []).push(f); },
  };
  const calls = [];
  const localStorage = blocked
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { calls.push(["set", k, v]); store.set(k, v); }, removeItem: (k) => { calls.push(["remove", k]); store.delete(k); } };
  const win = { addEventListener(t, f) { (listeners[`win:${t}`] ??= []).push(f); } };
  const sandbox = { document: doc, localStorage, addEventListener: win.addEventListener };
  vm.runInNewContext(S.MODE_SCRIPT, sandbox, { timeout: 1000 });
  return {
    root, group, store, calls, listeners,
    ready() { for (const f of listeners["doc:DOMContentLoaded"] ?? []) f(); },
    click(i) { for (const f of listeners["doc:click"] ?? []) f({ target: group.buttons[i] }); },
    pressed: () => group.buttons.map((b) => b.getAttribute("aria-pressed")),
  };
}

test("script : lit le choix AVANT le premier rendu (data-mode posé tout de suite, sans attendre le DOM)", () => {
  const d = makeDom({ stored: "dark" });
  assert.equal(d.root.getAttribute("data-mode"), "dark", "posé pendant l'exécution du script bloquant");
  assert.equal(d.group.hidden, true, "la pièce n'existe pas encore : elle est révélée quand le DOM est prêt");
  d.ready();
  assert.equal(d.group.hidden, false, "hidden levé");
  assert.deepEqual(d.pressed(), ["false", "false", "true"], "état annoncé");
});

test("script : sans choix = Automatique (aucun data-mode) ; valeur étrangère ignorée", () => {
  for (const stored of [undefined, "auto", "purple", "", "DARK"]) {
    const d = makeDom({ stored });
    assert.equal(d.root.getAttribute("data-mode"), null, String(stored));
    d.ready();
    assert.deepEqual(d.pressed(), ["true", "false", "false"]);
  }
});

test("script : un clic garde le choix dans le stockage local, pose data-mode et met à jour aria-pressed ; Automatique l'efface", () => {
  const d = makeDom();
  d.ready();
  d.click(1);
  assert.equal(d.root.getAttribute("data-mode"), "light");
  assert.equal(d.store.get("curiosa-mode"), "light");
  assert.deepEqual(d.pressed(), ["false", "true", "false"]);
  d.click(2);
  assert.equal(d.root.getAttribute("data-mode"), "dark");
  assert.equal(d.store.get("curiosa-mode"), "dark");
  assert.deepEqual(d.pressed(), ["false", "false", "true"]);
  d.click(0);
  assert.equal(d.root.getAttribute("data-mode"), null);
  assert.equal(d.store.has("curiosa-mode"), false);
  assert.deepEqual(d.pressed(), ["true", "false", "false"]);
  // un clic ailleurs ne fait rien
  for (const f of d.listeners["doc:click"]) f({ target: { closest: () => null } });
  for (const f of d.listeners["doc:click"]) f({ target: {} });
  assert.equal(d.root.getAttribute("data-mode"), null);
  assert.deepEqual(d.calls.map((c) => c[0]), ["set", "set", "remove"]);
});

test("script : stockage bloqué (navigation privée) = pas d'erreur, le choix vaut pour la page", () => {
  const d = makeDom({ blocked: true });
  assert.equal(d.root.getAttribute("data-mode"), null);
  d.ready();
  d.click(2);
  assert.equal(d.root.getAttribute("data-mode"), "dark");
  assert.deepEqual(d.pressed(), ["false", "false", "true"]);
  d.click(0);
  assert.equal(d.root.getAttribute("data-mode"), null);
});

test("script : un changement fait dans un autre onglet est suivi", () => {
  const d = makeDom();
  d.ready();
  d.store.set("curiosa-mode", "light");
  for (const f of d.listeners["win:storage"]) f({ key: "curiosa-mode" });
  assert.equal(d.root.getAttribute("data-mode"), "light");
  for (const f of d.listeners["win:storage"]) f({ key: "autre" });
  assert.equal(d.root.getAttribute("data-mode"), "light", "autre clé : ignorée");
});

test("script : petit, ES5, sans réseau ni cookie ni évaluation ; adresse à empreinte", () => {
  const code = S.MODE_SCRIPT;
  assert.ok(Buffer.byteLength(code) < 1500, `${Buffer.byteLength(code)} octets`);
  assert.doesNotMatch(code, /\bcookie\b|fetch|XMLHttpRequest|sendBeacon|WebSocket|eval\(|Function\(|import\(|\bconst\b|\blet\b|=>|`/);
  assert.doesNotMatch(code, /sessionStorage|indexedDB/);
  assert.equal(S.MODE_STORAGE_KEY, "curiosa-mode");
  assert.match(S.MODE_SCRIPT_URL, /^\/skins\/mode\.js\?v=[0-9a-f]{10}$/);
  assert.equal(S.MODE_SCRIPT_VERSION, S.MODE_SCRIPT_URL.split("=")[1]);
  assert.doesNotThrow(() => new vm.Script(code));
});

test("route /skins/mode.js : même origine, JavaScript, immuable, nosniff, sans cookie", async () => {
  const { GET } = await import("@/app/skins/mode.js/route");
  const res = GET();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/javascript/);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(await res.text(), S.MODE_SCRIPT);
  const { RESERVED_PATHS } = await import("@/core/config");
  assert.ok(RESERVED_PATHS.has("skins"), "/skins est réservé : ni page ni lien court ne peut le prendre");
});

test("mise en page : script externe bloquant dans <head> (ni defer ni async), avant la feuille de jetons, seulement avec la bascule", () => {
  const layout = read("src/app/(site)/layout.tsx");
  assert.match(layout, /\{look\.modeScriptUrl && <script src=\{look\.modeScriptUrl\} \/>\}/);
  assert.ok(layout.indexOf("look.modeScriptUrl &&") < layout.indexOf("<style dangerouslySetInnerHTML"));
  assert.doesNotMatch(layout.slice(layout.indexOf("modeScriptUrl &&"), layout.indexOf("<style")), /defer|async/);
  // aucun script en ligne ajouté pour la bascule
  assert.doesNotMatch(layout, /localStorage/);
  // la politique de confidentialité ne dépend pas d'un cookie : le bandeau de cookies n'est pas touché
  for (const f of ["src/core/cookieTray.ts", "src/components/site/CookieTray.tsx"]) assert.doesNotMatch(read(f), /curiosa-mode|mode-switch|mode\.js/, f);
});

// ── pièces rendues (transpilées avec TypeScript, rendues avec react-dom/server)
async function load(files) {
  const ts = (await import("typescript")).default;
  const dir = makeTempDir("curiosa-mode-");
  for (const [src, out] of files) {
    const js = ts.transpileModule(read(src), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    fs.writeFileSync(path.join(dir, out), js);
  }
  fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"));
  return dir;
}

test("pièce mode-switch : groupe étiqueté, trois boutons avec état annoncé, libellés, cibles >= 44 px, masquée sans JavaScript, FR et EN", async () => {
  const dir = await load([["src/components/site/ModeSwitch.tsx", "ModeSwitch.mjs"]]);
  const { ModeSwitch } = await import(path.join(dir, "ModeSwitch.mjs"));
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  for (const [locale, labels] of [["fr", ["Apparence", "Automatique", "Clair", "Sombre"]], ["en", ["Appearance", "Automatic", "Light", "Dark"]]]) {
    const html = renderToStaticMarkup(React.createElement(ModeSwitch, { t: makeTranslator(locale) }));
    assert.match(html, /^<div data-skin-part="mode-switch" role="group" aria-label="/);
    assert.match(html, new RegExp(`aria-label="${labels[0]}"`));
    assert.match(html, / hidden=""/, "masquée tant que le script ne l'a pas révélée");
    assert.equal((html.match(/<button type="button"/g) ?? []).length, 3);
    for (const v of ["auto", "light", "dark"]) assert.match(html, new RegExp(`data-skin-part="mode-option" data-mode-value="${v}" aria-pressed="${v === "auto"}"`));
    for (const l of labels.slice(1)) assert.match(html, new RegExp(`<span class="sr-only">${l}</span>`), `libellé texte « ${l} »`);
    assert.equal((html.match(/min-h-target min-w-target/g) ?? []).length, 3, "cible d'au moins 44 px (jeton --sk-target)");
    assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 3, "pictogrammes cachés aux lecteurs d'écran");
    assert.doesNotMatch(html, /<script|onclick|style=/i);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("logos : une seule image comme avant, ou DEUX images data-for quand le logo a deux variantes et que la bascule existe", async () => {
  const dir = await load([["src/components/site/BrandLogos.tsx", "BrandLogos.mjs"]]);
  const { BrandLogos } = await import(path.join(dir, "BrandLogos.mjs"));
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  // React 19 ajoute des <link rel="preload"> pour les images d'un rendu statique : sans importance ici
  const render = (props) => renderToStaticMarkup(React.createElement(BrandLogos, { name: "Mon site", wide: null, icon: null, wideVariants: null, iconVariants: null, ...props })).replace(/<link [^>]*>/g, "");
  // comme avant
  assert.equal(render({ wide: "/uploads/w.png", icon: "/uploads/i.png" }), '<img src="/uploads/w.png" data-logo="wide" data-paired="" alt="Mon site" class="h-9 w-auto max-w-[14rem] object-contain"/><img src="/uploads/i.png" data-logo="icon" data-paired="" alt="" class="h-9 w-9 object-contain"/>');
  assert.equal(render({ wide: "/uploads/w.png" }), '<img src="/uploads/w.png" data-logo="wide" alt="Mon site" class="h-9 w-auto max-w-[14rem] object-contain"/>');
  assert.equal(render({}), "");
  // deux variantes
  const two = render({ wide: "/uploads/w-dark.png", icon: "/uploads/i-dark.png", wideVariants: ["/uploads/w.png", "/uploads/w-dark.png"], iconVariants: ["/uploads/i.png", "/uploads/i-dark.png"] });
  assert.equal((two.match(/<img /g) ?? []).length, 4);
  assert.match(two, /<img src="\/uploads\/w\.png" data-for="light" data-logo="wide" data-paired="" alt="Mon site"/);
  assert.match(two, /<img src="\/uploads\/w-dark\.png" data-for="dark" data-logo="wide" data-paired="" alt="Mon site"/);
  assert.match(two, /<img src="\/uploads\/i\.png" data-for="light" data-logo="icon" data-paired="" alt=""/);
  assert.match(two, /<img src="\/uploads\/i-dark\.png" data-for="dark" data-logo="icon" data-paired="" alt=""/);
  fs.rmSync(dir, { recursive: true, force: true });
  // les règles du cœur (jamais celles d'un skin) montrent la bonne variante selon le mode effectif
  const css = read("src/app/globals.css");
  assert.match(css, /:root\[data-mode="light"\] img\[data-for="dark"\], :root\[data-mode="dark"\] img\[data-for="light"\] \{ display: none; \}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-mode\]\) img\[data-for="light"\] \{ display: none; \} \}/);
  assert.match(css, /@media \(prefers-color-scheme: light\), \(prefers-color-scheme: no-preference\) \{ :root:not\(\[data-mode\]\) img\[data-for="dark"\] \{ display: none; \} \}/);
  // l'en-tête : pièce posée dans l'emplacement des outils (à côté de la langue) seulement avec la bascule
  const header = read("src/components/site/Header.tsx");
  assert.match(header, /const modeEl = modeSwitch \? <ModeSwitch t=\{t\} \/> : null;/);
  assert.equal((header.match(/\{modeEl\}/g) ?? []).length, 4, "classique, centré, sobre, et le groupe langue+bascule");
  assert.equal((header.match(/\{langTools\}/g) ?? []).length, 1, "deux rangées : langue+bascule ensemble");
});

test("confidentialité : la ligne sur le choix clair/sombre n'apparaît que si la bascule existe, en FR et en EN, et dit « pas un cookie »", () => {
  const input = (locale, modeSwitch) => ({ siteName: "Mon site", contactEmail: "", statsEnabled: true, newsToggle: false, modeSwitch, features: [], extra: "", t: makeTranslator(locale) });
  for (const locale of ["fr", "en"]) {
    const without = buildPrivacyPolicy(input(locale, false));
    const withIt = buildPrivacyPolicy(input(locale, true));
    assert.ok(!without.includes("curiosa-mode"), "site existant : texte inchangé");
    assert.equal(without, buildPrivacyPolicy({ ...input(locale, false), modeSwitch: undefined }), "absent = faux");
    assert.ok(withIt.includes("curiosa-mode"), locale);
    assert.ok(withIt.length > without.length);
    assert.match(withIt, locale === "fr" ? /Ce n'est pas un cookie/ : /It is not a cookie/);
    assert.match(withIt, locale === "fr" ? /jamais envoyé/ : /never sent/);
    assert.equal(withIt.replace(/- \*\*(Clair ou sombre|Light or dark)\*\*[^\n]*\n/, ""), without, "le reste du texte est identique");
  }
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["site.mode.group", "site.mode.auto", "site.mode.light", "site.mode.dark", "privacy.cookies.mode"]) assert.ok(fr[k] && en[k] && fr[k] !== en[k], k);
  // la page de confidentialité demande au rendu des skins si la bascule existe
  assert.match(read("src/app/(site)/privacy/page.tsx"), /modeSwitch = \(await resolveLook\(config\)\)\.appearance\.modeSwitch/);
  // documentation
  assert.match(read("docs/PRIVACY.md"), /curiosa-mode/);
});
