// Banc d'essai (docs/SKINS.md §14, lot S8) : fragments à jour, planche complète, site de démonstration, dépôt de départ, guide.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { goodSkin } from "../helpers/skin-defects.mjs";
import { copySkin } from "../helpers/skins.mjs";

const { staticCheck } = await import("../../testsupport/skins/static.mjs");
const { prepareSite, startDemoServer, renderDemoPage, DEMO_PAGES } = await import("../../testsupport/skins/bench/site.mjs");
const { loadFragments, FRAGMENTS_DIR } = await import("../../testsupport/skins/bench/fragments.mjs");
const { boardContent, coverage, cleanDemo, genericPart, moduleSection, SECTIONS } = await import("../../testsupport/skins/bench/board.mjs");
const { checkOne } = await import("../../testsupport/skins/check.mjs");
const { PARTS, REGIONS } = await import("@/core/skins/allowlist");
const { MODE_SCRIPT } = await import("@/core/skins/modeScript");
const read = (p) => fs.readFileSync(p, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-bench-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const partsOf = (html) => new Set([...html.matchAll(/data-skin-(?:part|region)="([a-z0-9.-]+)"/g)].map((m) => m[1]));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("les fragments versionnés sont À JOUR : les régénérer à partir des composants du cœur donne exactement les mêmes fichiers", () => {
  const out = path.join(tmp, "fresh");
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./testsupport/skins/bench/register.mjs", "testsupport/skins/bench/refresh.mjs", "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rel = (d) => walk(d).map((f) => path.relative(d, f)).sort();
  assert.deepEqual(rel(out), rel(FRAGMENTS_DIR), "mêmes fichiers (relancez `npm run skin:bench:refresh`)");
  for (const f of rel(FRAGMENTS_DIR)) assert.equal(read(path.join(out, f)), read(path.join(FRAGMENTS_DIR, f)), `${f} n'est plus à jour : relancez \`npm run skin:bench:refresh\` et versionnez le résultat`);
});

test("les fragments viennent des vrais composants : FR et EN en parité, chacun est une balise du cœur, rien d'extérieur n'est chargé", () => {
  const all = loadFragments();
  assert.deepEqual(Object.keys(all[`fr`]).sort(), Object.keys(all.en).sort());
  assert.ok(Object.keys(all.fr).length >= 40);
  for (const [L, list] of Object.entries(all)) {
    for (const [name, html] of Object.entries(list)) {
      assert.ok(html.length > 20, `${L}/${name}`);
      assert.doesNotMatch(html, /<script|<iframe|\son[a-z]+=/i, `${L}/${name} : ni script ni gestionnaire`);
      assert.doesNotMatch(html, /\s(?:src|poster)="(?:https?:)?\/\//, `${L}/${name} : aucune ressource extérieure`);
      assert.doesNotMatch(html, /url\(["']?https?:/, `${L}/${name}`);
    }
  }
  // quelques marques du vrai rendu
  assert.match(all.fr["header-classic"], /^<header data-skin-region="header"[^>]*data-header-layout="classic"/);
  assert.match(all.fr["header-classic-switch"], /data-skin-part="mode-switch"/);
  assert.match(all.fr["header-minimal-open"], /id="site-menu"/);
  assert.doesNotMatch(all.fr["header-minimal"], /id="site-menu"/, "fermé : le panneau n'est pas dans le DOM (comme dans le cœur)");
  assert.match(all.fr["form-error"], /data-skin-part="field-error"/);
  assert.match(all.fr["form-sending"], /disabled=""/);
  assert.match(all.fr.tray, /data-skin-part="cookie-tray"/);
  assert.match(all.fr.footer, /data-skin-part="credit"/);
  assert.match(all.en["page-privacy"], /Privacy/);
});

test("la PLANCHE montre toutes les régions et pièces du contrat (rien d'oublié quand le cœur en ajoute une)", async () => {
  const site = await prepareSite(null);
  for (const L of ["fr", "en"]) {
    const cov = await coverage(site, L);
    assert.deepEqual(cov.missing, [], `pièces ou régions que la planche (${L}) ne montre pas : ${cov.missing.join(", ")}`);
    assert.equal(cov.total, REGIONS.length + PARTS.length);
  }
  // les sections de la planche et le contenu
  const html = boardContent(site, "fr");
  for (const [id] of SECTIONS) assert.match(html, new RegExp(`data-bench-section="${id}"`));
  assert.match(html, /<p data-bench-chrome>entries-cards<\/p>/, "chaque fragment a sa légende, hors des mesures (data-bench-chrome)");
});

test("garde-fou : les pièces que les fichiers de pages du cœur écrivent (accueil, liste, fiche, 404, confidentialité) sont dans les fragments de pages transcrits", () => {
  const all = loadFragments();
  const fr = { ...all.fr, "page-article": all.fr["page-article"] + all.en["page-article"] };   // le message de repli de langue n'apparaît que dans une autre langue
  const sourceParts = (f) => new Set([...read(f).matchAll(/data-skin-part="([a-z0-9-]+)"/g)].map((m) => m[1]));
  const check = (file, fragments, ignore = []) => {
    const have = new Set(fragments.flatMap((n) => [...partsOf(fr[n])]));
    for (const p of sourceParts(file)) if (!ignore.includes(p)) assert.ok(have.has(p), `${file} écrit la pièce « ${p} » absente de ${fragments.join(", ")} : mettez à jour testsupport/skins/bench/refresh.mjs`);
  };
  check("src/app/(site)/not-found.tsx", ["page-notfound"]);
  check("src/app/(site)/privacy/page.tsx", ["page-privacy"]);
  check("src/app/(site)/page.tsx", ["page-home"]);
  // la page « liste / fiche / module » : le fichier contient aussi la page de module (autre fragment)
  check("src/app/(site)/[...path]/page.tsx", ["page-list", "page-article", "page-contact"]);
});

test("la coquille du site de démonstration est celle du cœur : mêmes régions, même ordre, mêmes attributs que layout.tsx", async () => {
  const site = await prepareSite(null);
  const { html, status } = renderDemoPage(site, { path: "/", query: {} });
  assert.equal(status, 200);
  const body = html.slice(html.indexOf("<body"));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, s); return i; };
  const order = ['data-skin-part="skip-link"', 'data-skin-region="tray"', 'data-skin-region="shell"', 'data-skin-region="banner"', 'data-skin-region="header"', '<main id="content" data-skin-region="main">', 'data-skin-region="content"', 'data-skin-region="footer"'];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} avant ${order[i]}`);
  assert.match(html, /<body class="min-h-screen bg-bg text-fg antialiased" data-skin-root="">/);
  assert.match(html, /<html lang="fr" data-skin="basic">/);
  // le même squelette que layout.tsx
  const layout = read("src/app/(site)/layout.tsx");
  for (const s of ['data-skin-region="shell"', 'data-skin-region="banner"', '<main id="content" data-skin-region="main">', 'data-skin-region="content"', 'href="#content"', "data-skin-root"]) assert.ok(layout.includes(s), s);
  // une seule feuille de skin, après celle du cœur
  assert.ok(html.indexOf("tailwindcss") < html.indexOf(':root[data-skin="basic"]'));
  assert.doesNotMatch(html, /<script src="\/skins\/mode\.js/, "basic n'a pas la bascule");
});

test("serveur de démonstration : pages-types, 404, anglais, images, script de bascule du cœur, ressources du skin, planche, interface du banc", async () => {
  const dir = path.join(tmp, "dual");
  const fontBytes = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64)]);
  copySkin("plain-light", dir, { id: "dual", patch: (m) => { m.modes = ["light", "dark"]; m.assets = [{ file: "fonts/x.woff2", kind: "font", license: "OFL-1.1", licenseFile: "LICENSES/x.txt", author: "A", source: "https://example.org", family: "Skin X" }]; }, files: { "fonts/x.woff2": fontBytes, "LICENSES/x.txt": "l\n", "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#fff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: { "--v-bg": "#16161a", "--v-surface": "#202026", "--v-fg": "#f2f2f5", "--v-accent": "#8ab4ff" }, common: {}, modules: {} }) } });
  const st = await staticCheck(dir, { coreVersion: "0.4.0" });
  const site = await prepareSite(st);
  const srv = await startDemoServer(site, { port: 0 });
  try {
    const get = async (p, init) => fetch(srv.url + p, init);
    for (const p of DEMO_PAGES) {
      const res = await get(p.path);
      assert.equal(res.status, p.status ?? 200, p.path);
      const html = await res.text();
      assert.match(html, /<html lang="fr" data-skin="dual">/);
      assert.match(html, /<script src="\/skins\/mode\.js\?v=[0-9a-f]+"><\/script>/, "skin à deux modes : le script du cœur, bloquant, avant la feuille");
      assert.ok(html.indexOf("/skins/mode.js") < html.indexOf("<style>"));
      assert.match(html, /data-skin-part="mode-switch"/);
      assert.match(html, /<h1 [^>]*data-skin-part="heading"/);
    }
    const en = await (await get("/en/blog")).text();
    assert.match(en, /<html lang="en" data-skin="dual">/);
    assert.match(en, /Blog/);
    assert.equal((await get("/n-importe-quoi")).status, 404);
    assert.equal((await get("/a-propos/equipe")).status, 200, "les liens du menu ne mènent pas à une 404");
    const mode = await get("/skins/mode.js");
    assert.equal(await mode.text(), MODE_SCRIPT, "c'est le script du cœur, tel quel");
    const font = await get("/skins/dual/1.0.0/fonts/x.woff2");
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal(font.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await font.arrayBuffer()), fontBytes);
    assert.equal((await get("/skins/dual/1.0.0/skin.css")).status, 404, "la feuille n'est jamais servie en fichier");
    assert.equal((await get("/skins/dual/1.0.0/previews/home.webp")).status, 404);
    const img = await get("/uploads/00000000-0000-4000-8000-000000000001.png");
    assert.equal(img.headers.get("content-type"), "image/svg+xml");
    const board = await (await get("/bench")).text();
    assert.match(board, /data-bench-board/);
    assert.match(board, /data-skin-part="cookie-tray"|data-skin-region="tray"/);
    const ui = await (await get("/__bench/")).text();
    assert.match(ui, /<iframe id="f"/);
    assert.match(ui, /id="mode"/, "skin à deux modes : sélecteur clair / sombre / appareil");
    for (const w of [390, 768, 1280, 1920]) assert.match(ui, new RegExp(`value="${w}"`));
    assert.match(ui, /value="640"/, "les points de rupture du skin sont proposés");
    const query = await (await get("/?layout=minimal&menu=open&tray=1&banner=1&mode=dark")).text();
    assert.match(query, /data-header-layout="minimal"/);
    assert.match(query, /id="site-menu"/);
    assert.match(query, /data-skin-part="cookie-tray"/);
    assert.match(query, /data-mode="dark"/);
    const state = await (await get("/__bench/state.json")).json();
    assert.equal(state.skin, "dual");
    // aucune adresse extérieure dans les pages (hors liens de navigation)
    const home = await (await get("/")).text();
    assert.doesNotMatch(home, /\s(?:src|poster)="https?:/);
    assert.doesNotMatch(home, /url\(["']?https?:/);
  } finally { await srv.close(); }
});

test("rechargement : le site relit le skin quand un fichier change (fonction passée au serveur)", async () => {
  const dir = goodSkin(tmp, "reload");
  let calls = 0;
  const load = async () => { calls++; return prepareSite(await staticCheck(dir, { coreVersion: "0.4.0" })); };
  const srv = await startDemoServer(load, { port: 0 });
  try {
    await fetch(`${srv.url}/`);
    fs.writeFileSync(path.join(dir, "skin.css"), '[data-skin-region="header"] { border-bottom: 9px solid red; }\n');
    const html = await (await fetch(`${srv.url}/`)).text();
    assert.match(html, /border-bottom:9px solid red/);
    assert.equal(calls, 2);
  } finally { await srv.close(); }
});

test("pièces de modules : exemple `demo` nettoyé, gabarit générique selon `kind`, jetons visibles sans le CSS du module", async () => {
  assert.equal(cleanDemo('<div onclick="x()"><script>alert(1)</script><style>a{}</style><img src="https://exemple.org/a.png"><a href="//exemple.org/">x</a><link rel="stylesheet" href="x.css"></div>'), '<div><img src="#"><a href="#">x</a></div>');
  const part = { id: "demo.card", moduleId: "demo", kind: "card", name: { fr: "Carte", en: "Card" }, description: { fr: "Une carte.", en: "A card." }, tokens: ["--sk-m-demo-card-bg", "--sk-m-demo-card-radius"] };
  assert.match(genericPart(part), /data-skin-part="demo\.card"/);
  assert.match(genericPart({ ...part, kind: "button" }), /^<a href="#" data-skin-part="demo\.card">/);
  assert.match(genericPart({ ...part, kind: "badge" }), /^<span/);
  assert.match(genericPart({ ...part, kind: undefined }), /^<div/);
  const mods = path.join(tmp, "mods2");
  fs.mkdirSync(path.join(mods, "demo"), { recursive: true });
  fs.writeFileSync(path.join(mods, "demo/module.json"), JSON.stringify({ apiVersion: 2, id: "demo", skin: { since: 1, demo: "skin-demo.html", parts: [{ id: "demo.card", kind: "card", name: { fr: "Carte", en: "Card" }, description: { fr: "Une carte.", en: "A card." }, tokens: [{ name: "--sk-m-demo-card-bg", type: "color", default: "var(--v-surface)" }, { name: "--sk-m-demo-card-radius", type: "length", default: "var(--sk-radius-card)" }] }] } }));
  fs.writeFileSync(path.join(mods, "demo/skin-demo.html"), '<article data-skin-part="demo.card"><h3>Exemple du module</h3><script>x()</script></article>');
  const st = await staticCheck(goodSkin(tmp, "withmods"), { coreVersion: "0.4.0", modules: mods });
  const site = await prepareSite(st);
  const sec = moduleSection(site, "fr");
  assert.deepEqual(sec.parts, ["demo.card"]);
  assert.match(sec.html, /Exemple du module/);
  assert.doesNotMatch(sec.html, /<script>x\(\)/);
  assert.match(sec.html, /\[data-bench-modules\] \[data-skin-part="demo\.card"\]\{background:var\(--sk-m-demo-card-bg\);border-radius:var\(--sk-m-demo-card-radius\)\}/);
  assert.match(boardContent(site, "fr"), /data-bench-modules/);
  assert.equal(moduleSection(await prepareSite(null), "fr").html, "", "sans module : pas de section");
  // la feuille du skin peut cibler la pièce du module quand le dossier de modules est donné, et pas autrement
  const css = '[data-skin-part="demo.card"] { border: 1px solid currentColor; }\n';
  const dir = path.join(tmp, "targets-module"); copySkin("plain-light", dir, { id: "targets-module", files: { "skin.css": css } });
  const withModules = await checkOne(dir, { coreVersion: "0.4.0", modules: mods });
  assert.deepEqual(withModules.issues.filter((i) => i.severity === "error"), []);
});

test("le client du banc imite le JavaScript du cœur sur les MÊMES attributs (garde-fou : ils existent toujours dans les composants)", () => {
  const client = read("testsupport/skins/bench/client.js");
  const nav = read("src/components/site/SiteNav.tsx"), toggle = read("src/components/site/MenuToggle.tsx"), tray = read("src/components/site/CookieTray.tsx");
  for (const a of ["data-panel-button", "data-trigger", "data-sub", "data-open", "aria-expanded"]) { assert.ok(nav.includes(a), `SiteNav : ${a}`); assert.ok(client.includes(a), `client : ${a}`); }
  assert.ok(toggle.includes('id="site-menu"') && client.includes("site-menu"));
  assert.ok(tray.includes("data-testid=\"cookie-") === false || client.includes("cookie-"));
  assert.match(client, /Escape/);
  assert.doesNotMatch(client, /fetch\(|XMLHttpRequest|localStorage|document\.cookie/, "le client ne parle à personne");
});

test("les deux écarts d'état initial du chargeur (menu sobre ouvert, formulaire en erreur) visent des motifs qui existent encore dans le cœur", () => {
  const hooks = read("testsupport/skins/bench/hooks.mjs");
  assert.ok(read("src/components/site/MenuToggle.tsx").includes("useState(false)"));
  const form = read("src/components/site/ModuleForm.tsx");
  assert.ok(form.includes('useState<"idle" | "sending" | "done" | "error">("idle")') && form.includes("useState<string | null>(null)"));
  assert.match(hooks, /Le banc d'essai ne retrouve plus/);
});

test("dépôt de départ docs/skin-starter : un skin valide (statique, --strict), commenté, avec son contrôle automatique", async () => {
  const root = "docs/skin-starter";
  for (const f of ["README.md", "LICENSE", ".gitignore", ".github/workflows/ci.yml", "docs/skin.commente.jsonc", "skins/mon-skin/skin.json", "skins/mon-skin/tokens.json", "skins/mon-skin/skin.css", "skins/mon-skin/LICENSE", "skins/mon-skin/README.md", "skins/mon-skin/previews/home-light.webp", "skins/mon-skin/previews/home-dark.webp"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const r = await checkOne(path.join(root, "skins/mon-skin"), { coreVersion: "0.4.0" });
  assert.deepEqual(r.issues.filter((i) => i.severity !== "advice"), [], "aucune erreur ni avertissement (le dépôt de départ passe --strict)");
  assert.equal(r.id, "mon-skin");
  // la copie annotée dit la même chose que skin.json
  const jsonc = read(path.join(root, "docs/skin.commente.jsonc")).replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  assert.deepEqual(JSON.parse(jsonc), JSON.parse(read(path.join(root, "skins/mon-skin/skin.json"))));
  const ci = read(path.join(root, ".github/workflows/ci.yml"));
  assert.match(ci, /git ls-remote --tags/, "contre la dernière version publiée du cœur");
  assert.match(ci, /npm run skin:check -- "\$GITHUB_WORKSPACE" --visual --strict/);
  assert.match(ci, /playwright install/);
  assert.doesNotMatch(read(path.join(root, "skins/mon-skin/skin.css")) + read(path.join(root, "skins/mon-skin/tokens.json")), /https?:/);
  // l'aperçu est un vrai WebP 1280 × 800 de moins de 150 Ko
  const { imageSize } = await import("../../testsupport/skins/imageinfo.mjs");
  for (const f of ["home-light", "home-dark"]) { const b = fs.readFileSync(path.join(root, `skins/mon-skin/previews/${f}.webp`)); assert.deepEqual(imageSize(b), { width: 1280, height: 800 }); assert.ok(b.length <= 150 * 1024); }
});

test("guide docs/CREER-UN-SKIN.md : les commandes existent, les liens relatifs mènent quelque part, les sections attendues y sont (dont la partie pour une IA)", () => {
  const doc = read("docs/CREER-UN-SKIN.md");
  const pkg = JSON.parse(read("package.json"));
  for (const s of ["skin:check", "skin:bench", "skin:bench:refresh"]) assert.ok(pkg.scripts[s], s);
  for (const s of ["npm run skin:check", "npm run skin:bench", "--visual", "--json", "--strict", "--shots", "--previews", "--modules", "catalogue/index.json", "30 minutes", "Pour une IA qui crée un skin", "English summary", "principe fondateur", "Apparence → Ajouter depuis une adresse", "docs/skin-starter", "prefers-reduced-motion"]) assert.ok(doc.includes(s), s);
  const stripped = doc.replace(/```[\s\S]*?```/g, "");
  for (const m of stripped.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) assert.ok(fs.existsSync(path.resolve("docs", m[1])), `lien cassé : ${m[1]}`);
  // les seuils annoncés sont ceux du code
  assert.match(doc, /\*\*3 %\*\*.*\*\*10 %\*\*/s);
  assert.match(read("docs/SKINS.md"), /CREER-UN-SKIN\.md/, "SKINS.md renvoie au guide");
});
