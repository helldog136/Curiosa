// Le SITE DE DÉMONSTRATION minimal (docs/SKINS.md §14) : la coquille réelle du site public (mêmes régions et pièces, `src/app/(site)/layout.tsx`) remplie des
// fragments générés par les vrais composants du cœur, avec la feuille de style du cœur compilée et la feuille du skin composée par `composeSkin` + `renderSheet`
// (donc le même assainissement et le même repli que le site réel). Pas de base de données, pas de Next. Le banc d'essai (`skin:bench`) et le niveau navigateur
// du kit (`skin:check --visual`) servent ce même site.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderSvg } from "./assets.mjs";
import { boardContent } from "./board.mjs";
import { coreCss } from "./corecss.mjs";
import { fragment } from "./fragments.mjs";
import { benchUi } from "./ui.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Les pages-types du site de démonstration : chemin (sans langue) → fragment, nom court et titre. */
export const DEMO_PAGES = [
  { id: "home", path: "/", fragment: "page-home", title: { fr: "Accueil", en: "Home" } },
  { id: "blog", path: "/blog", fragment: "page-list", title: { fr: "Blog (liste)", en: "Blog (list)" } },
  { id: "article", path: "/blog/article-1", fragment: "page-article", title: { fr: "Article", en: "Article" } },
  { id: "form", path: "/contact", fragment: "page-contact", title: { fr: "Formulaire", en: "Form" } },
  { id: "notfound", path: "/page-introuvable", fragment: "page-notfound", status: 404, title: { fr: "Page introuvable (404)", en: "Not found (404)" } },
  { id: "privacy", path: "/privacy", fragment: "page-privacy", title: { fr: "Confidentialité", en: "Privacy" } },
];
/** Pages liées par le menu (existent pour que la navigation ne mène pas à une 404). */
const EXTRA_PAGES = [
  { path: "/a-propos", fragment: "page-list-plain" }, { path: "/a-propos/equipe", fragment: "page-article" }, { path: "/a-propos/presse", fragment: "page-article" },
  { path: "/links", fragment: "page-list-links" },
];
export const BOARD_PATH = "/bench";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Active le menu ouvert dans un fragment d'en-tête (le cœur ne rend que `data-open="false"` : l'ouverture est une action de la personne qui visite). */
function openMenu(html) {
  return html
    .replace('data-skin-part="nav-list" data-open="false"', 'data-skin-part="nav-list" data-open="true"')
    .replace(/(data-panel-button="" data-skin-part="menu-toggle" aria-expanded=")false"/, '$1true"')
    .replace('data-skin-part="submenu" data-open="false"', 'data-skin-part="submenu" data-open="true"')
    .replace(/(data-trigger="2" aria-expanded=")false"/, '$1true"');
}

/**
 * Construit la page HTML d'une adresse du site de démonstration.
 * `site` : { look, skinId, coreCss, legacy?, unsafeCss?, modules?, layer?, theme? } · `req` : { path, query }
 * Rend { status, html } ou { status, type, body } pour un fichier.
 */
export function renderDemoPage(site, req) {
  const m = /^\/en(\/.*)?$/.exec(req.path);
  const L = m ? "en" : "fr";
  const route = m ? (m[1] ?? "/") : req.path;
  const q = req.query ?? {};
  const known = [...DEMO_PAGES, ...EXTRA_PAGES, { id: "board", path: BOARD_PATH }].find((p) => p.path === route.replace(/\/$/, "") || (route === "/" && p.path === "/"));
  const page = known ?? { id: "notfound", path: route, fragment: "page-notfound", status: 404 };

  const look = site.look;
  const sw = look.switchAvailable || site.forceSwitch === true;
  const layout = ["classic", "twoRows", "centered", "minimal"].includes(q.layout) ? q.layout : look.headerLayout;
  let header = layout === "classic" && q.logo ? fragment(L, "header-classic-logo") : fragment(L, `header-${layout}${sw ? "-switch" : ""}`);
  const menuOpen = q.menu === "open";
  if (menuOpen) header = layout === "minimal" ? fragment(L, `header-minimal-open${sw ? "-switch" : ""}`) : openMenu(header);
  const panel = layout === "minimal" ? /<nav id="site-menu".*?<\/nav>/s.exec(fragment(L, `header-minimal-open${sw ? "-switch" : ""}`))?.[0] : null;
  const footer = fragment(L, "footer");
  const tray = fragment(L, q.tray === "1" ? "tray" : "tray-closed");
  const skip = L === "fr" ? "Aller au contenu" : "Skip to content";
  const content = page.id === "board" ? boardContent(site, L) : fragment(L, page.fragment);
  const banner = q.banner === "1" ? fragment(L, "block-banners") : "";
  const title = page.title?.[L] ?? (L === "fr" ? "Mon site" : "My site");
  const root = site.legacy
    ? `<html lang="${L}">`
    : `<html lang="${L}" data-skin="${esc(look.composed.skinId)}"${look.composed.hasAccent2 ? ' data-accent2="1"' : ""}${look.composed.hasChosenSurface ? ' data-surface="1"' : ""}${q.mode === "dark" || q.mode === "light" ? ` data-mode="${q.mode}"` : ""}>`;
  const backdrop = !site.legacy && look.layers.length ? `<div class="cbg" aria-hidden="true" data-skin-region="backdrop">${look.layers.map(() => "<i></i>").join("")}</div>` : "";
  const html = `<!doctype html>
${root}<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)} | ${L === "fr" ? "Mon site" : "My site"}</title>
${(look.switchAvailable || site.forceSwitch) && !site.legacy ? `<script src="${site.modeScriptUrl}"></script>` : ""}<style>${site.coreCss}</style><style>${site.sheet}${site.unsafeCss ?? ""}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased" data-skin-root="">${backdrop}<a href="#content" data-skin-part="skip-link" class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-fg">${skip}</a>${tray}<div data-skin-region="shell"><div data-skin-region="banner">${banner}</div>${header}<main id="content" data-skin-region="main"><div data-skin-region="content">${content}</div></main>${footer}</div>${panel ? `<template id="bench-minimal-panel">${panel}</template>` : ""}<script src="/__bench/client.js"></script></body></html>`;
  return { status: page.status ?? 200, html };
}

/** Fichiers ordinaires de `fonts/` et `images/` d'un dossier de skin (jamais de lien symbolique), pour servir un skin refusé dans le banc. */
function readSkinMedia(dir) {
  const out = [];
  if (!dir) return out;
  for (const sub of ["fonts", "images"]) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
    for (const n of names.slice(0, 60)) {
      const f = path.join(dir, sub, n);
      try { const st = fs.lstatSync(f); if (st.isFile() && st.size <= 2 * 1024 * 1024) out.push({ path: `${sub}/${n}`, content: fs.readFileSync(f) }); } catch { /* fichier illisible : ignoré */ }
    }
  }
  return out;
}

/**
 * Prépare un site de démonstration pour un skin déjà contrôlé.
 * `check` : résultat de `staticCheck()` ; `opts` : { legacy, unsafeCss, options, retouches }. Pour basic : `check` = null.
 */
export async function prepareSite(check, opts = {}) {
  const { buildLook } = await import("./look.mjs");
  const { MODE_SCRIPT, MODE_SCRIPT_URL } = await import("../../../src/core/skins/modeScript.ts");
  let skin = null;
  const files = new Map();
  if (check?.manifest && check.tokens) {
    const { toSkinDefinition } = await import("../../../src/core/skins/folder.ts");
    skin = toSkinDefinition({ id: check.manifest.id, version: check.manifest.version, manifest: check.manifest, css: check.css, tokens: check.tokens });
    // Un skin refusé n'a pas de fichiers à installer (`installFiles` vide) : on sert alors ceux du dossier, pour que le navigateur montre le vrai rendu et que le rapport
    // ne s'encombre pas de « fichier introuvable » qui cacheraient la vraie cause (lisibilité, etc.). Fichiers ordinaires de fonts/ et images/ seulement, 2 Mo au plus.
    const served = check.validation.installFiles.length ? check.validation.installFiles : readSkinMedia(check.dir);
    for (const f of served) {
      if (/^(fonts|images)\//.test(f.path)) files.set(`/skins/${check.manifest.id}/${check.manifest.version}/${f.path}`, f.content);
    }
  }
  const look = await buildLook(opts.legacy ? null : skin, check?.layer ?? null, { options: opts.options, retouches: opts.retouches });
  let sheet = look.sheet;
  if (opts.legacy) {
    const { buildTheme, themeCss } = await import("../../../src/core/color.ts");
    sheet = themeCss(buildTheme("#121214", "#e8a23b", "sans"));
  }
  return {
    look, sheet, files, check, legacy: !!opts.legacy, forceSwitch: !!opts.forceSwitch, unsafeCss: opts.unsafeCss, coreCss: await coreCss(), modeScript: MODE_SCRIPT, modeScriptUrl: MODE_SCRIPT_URL,
    modules: check?.modules ?? [], layer: check?.layer ?? null, skinId: look.composed.skinId, manifest: check?.manifest ?? null, issues: check?.issues ?? [],
  };
}

const TYPES = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".avif": "image/avif", ".woff2": "font/woff2" };

/** Démarre le serveur HTTP du site de démonstration (127.0.0.1). Rend { url, port, close() }. `port: 0` : un port libre. */
export async function startDemoServer(siteOrGetter, { port = 0, host = "127.0.0.1", log = () => {} } = {}) {
  const getSite = typeof siteOrGetter === "function" ? siteOrGetter : () => siteOrGetter;
  const clientJs = fs.readFileSync(path.join(HERE, "client.js"));
  const server = http.createServer(async (req, res) => {
    try {
      const site = await getSite();
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = decodeURIComponent(url.pathname);
      const query = Object.fromEntries(url.searchParams);
      const send = (status, type, body, extra = {}) => { res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra }); res.end(body); };
      if (p === "/skins/mode.js") return send(200, "text/javascript; charset=utf-8", site.modeScript);
      if (p === "/__bench/client.js") return send(200, "text/javascript; charset=utf-8", clientJs);
      if (p === "/__bench" || p === "/__bench/") return send(200, "text/html; charset=utf-8", benchUi(site, query));
      if (p === "/__bench/state.json") return send(200, "application/json", JSON.stringify({ skin: site.skinId, issues: site.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })) }));
      if (p.startsWith("/uploads/")) return send(200, "image/svg+xml", placeholderSvg(path.basename(p)));
      if (p.startsWith("/bench/logo-")) return send(200, "image/svg+xml", placeholderSvg(path.basename(p), 400, 100));
      if (site.files.has(p)) return send(200, TYPES[path.extname(p)] ?? "application/octet-stream", site.files.get(p));
      if (p === "/favicon.ico") return send(204, "image/x-icon", "");
      const page = renderDemoPage(site, { path: p, query });
      return send(page.status, "text/html; charset=utf-8", page.html);
    } catch (e) {
      log(`erreur : ${e?.stack ?? e}`);
      res.writeHead(500, { "content-type": "text/plain" }); res.end("Erreur du banc d'essai");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const addr = server.address();
  return {
    port: addr.port, url: `http://${host}:${addr.port}`,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
