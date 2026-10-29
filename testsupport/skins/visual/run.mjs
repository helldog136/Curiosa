// NIVEAU NAVIGATEUR du kit (`skin:check --visual`, docs/SKINS.md §13) : un site de démonstration minimal avec le skin, dans un vrai Chromium.
//   - mêmes textes, liens, images, titres, éléments cliquables que sous le skin de base ; rien de masqué, recouvert, repoussé hors de l'écran, aucun texte ajouté ;
//   - ordre visuel / ordre de tabulation ; cibles, taille et interligne du texte ; focus visible ; contraste RENDU ; défilement horizontal ; texte coupé ;
//   - menu mobile (ouvrir, Échap) et sous-menu ; bascule clair/sombre ; mouvement réduit ; aucune requête extérieure ; polices vraiment chargées ;
//   - régression de basic (pixel pour pixel) ; captures facultatives (`shots`).
// Une règle que le skin de base enfreint aussi (par exemple une cible de 28 px dans le menu large) n'est reprochée au skin que s'il fait PIRE : la même constatation
// est alors donnée en conseil. Tout est mesuré sur la feuille ASSAINIE (celle que le site appliquerait), pas sur le fichier de l'auteur.
import fs from "node:fs";
import path from "node:path";
import { kitIssue } from "../messages.mjs";
import { DEMO_PAGES, prepareSite, startDemoServer } from "../bench/site.mjs";
import { judgeOrder, tabOrderMetrics } from "./order.mjs";
import { diffCount, focusChange, rawOf, worstContrast } from "./pixels.mjs";
import * as inpage from "./inpage.mjs";

const DEFAULT_WIDTHS = [390, 768, 1280, 1920];
const CONTRAST_WIDTHS = [390, 1280];
const FOCUS_WIDTHS = [390, 1280];
const FOCUS_PAGES = ["home", "form", "blog"];
const FOCUS_CAP = 14;
const PORT_BASE = Number(process.env.SKIN_PORT_BASE || 3560);

const pageLabel = (p) => p.title;
const modeLabel = (m) => ({ fr: m === "dark" ? "sombre" : "clair", en: m });

/** Rassemble les constatations répétées (même problème, autres largeurs ou modes) en une seule. */
class Bag {
  constructor() { this.map = new Map(); }
  add(code, params, extraKey = "") {
    const { width, mode, page, ...rest } = params;
    const key = `${code}|${extraKey}|${JSON.stringify(rest)}|${page?.en ?? ""}`;
    const e = this.map.get(key) ?? { code, rest, page, widths: new Set(), modes: new Set() };
    if (width !== undefined) e.widths.add(width);
    if (mode) e.modes.add(mode);
    this.map.set(key, e);
  }
  issues(downgrade = () => false) {
    return [...this.map.values()].map((e) => {
      const i = kitIssue(e.code, { ...e.rest, page: e.page ?? "", width: [...e.widths].sort((a, b) => a - b).join(", "), mode: e.modes.size ? { fr: [...e.modes].map((m) => modeLabel(m).fr).join(" et "), en: [...e.modes].join(" and ") } : "" });
      if (downgrade(e) && i.severity !== "advice") { i.severity = "advice"; i.message = { fr: `${i.message.fr} (le skin de base fait pareil)`, en: `${i.message.en} (the basic skin does the same)` }; }
      return i;
    });
  }
}

let basicRegressionMemo = null;

/** @returns {Promise<{ issues: object[], info: object }>} */
export async function visualCheck(st, options = {}) {
  const issues = [];
  const info = { widths: [], modes: [], pages: [], shots: 0 };
  let browser, playwright;
  try {
    const pw = await import("../../../scripts/visual/lib/playwright.mjs");
    playwright = pw.loadPlaywright();
    browser = await playwright.chromium.launch({ executablePath: pw.chromiumPath(), args: pw.CHROMIUM_ARGS });
  } catch (e) {
    return { issues: [kitIssue("kit-browser-unavailable", { reason: String(e?.message ?? e).split("\n")[0].slice(0, 160) })], info };
  }
  const servers = [];
  try {
    const skinSite = await prepareSite(st.manifest ? st : null, { unsafeCss: options.unsafeCss });
    const dual = skinSite.look.composed.modes.length === 2;
    // basic n'a pas de bascule ; pour comparer à armes égales avec un skin à deux modes, sa page porte la même (le cœur la pose pour tout skin à deux modes)
    const basicSite = await prepareSite(null, { forceSwitch: dual });
    const sk = await startDemoServer(skinSite, { port: await freePort() }); servers.push(sk);
    const bs = await startDemoServer(basicSite, { port: await freePort(sk.port + 1) }); servers.push(bs);

    const bps = (st.manifest?.breakpoints ?? []).filter((w) => !DEFAULT_WIDTHS.includes(w));
    const widths = options.widths?.length ? options.widths : [...DEFAULT_WIDTHS, ...bps];
    const modes = skinSite.look.composed.modes.map((m) => m.mode);
    const pages = DEMO_PAGES.filter((p) => !options.onlyPages || options.onlyPages.includes(p.id));
    Object.assign(info, { widths, modes, pages: pages.map((p) => p.id), port: sk.port });

    const bag = new Bag();
    const basicBag = new Bag();            // les mêmes mesures sur basic : ce que basic fait aussi n'est pas reproché au skin
    const fontStatus = new Map();           // famille → Set(statuts)
    const external = new Set(), failed = new Set(), consoleErrors = new Map();
    const hasBackdrop = /backdrop-filter/.test(skinSite.sheet);
    const shotDir = options.shots ? path.resolve(options.shots) : null;
    if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

    const newCtx = async (server, width, scheme, extra = {}) => {
      const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, colorScheme: scheme, reducedMotion: "reduce", locale: "fr-FR", timezoneId: "UTC", ...extra });
      await ctx.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === "127.0.0.1" && Number(u.port) === server.port) return route.continue();
        if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
        external.add(`${u.origin}${u.pathname}`.slice(0, 120));
        return route.abort();
      });
      return ctx;
    };
    const visit = async (ctx, server, def, query = "") => {
      const page = await ctx.newPage();
      page.on("console", (m) => { if (m.type() === "error" && server === sk && !/ERR_FAILED|Failed to load resource/.test(m.text())) consoleErrors.set(def.id, m.text().slice(0, 120)); });
      page.on("response", (r) => { if (server === sk && r.status() >= 400 && new URL(r.url()).pathname.startsWith("/skins/")) failed.add(new URL(r.url()).pathname); });
      const resp = await page.goto(`${server.url}${def.path}${query}`, { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; });
      return { page, status: resp?.status() ?? 0 };
    };
    const collectFonts = async (page) => {
      const list = await page.evaluate(() => [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ""), status: f.status })));
      for (const f of list) (fontStatus.get(f.family) ?? fontStatus.set(f.family, new Set()).get(f.family)).add(f.status);
    };

    // ── basic : la référence de chaque page à chaque largeur (et le suivi de ses propres mesures)
    const baseline = new Map();
    for (const width of widths) {
      const ctx = await newCtx(bs, width, "dark");
      for (const def of pages) {
        // basic est montré avec l'en-tête par défaut du skin : une mise en page d'en-tête (ex. deux rangées) ordonne autrement les liens, ce n'est pas un changement de contenu
        const { page } = await visit(ctx, bs, def, `?layout=${skinSite.look.headerLayout}`);
        const data = await page.evaluate(inpage.collectPage);
        data.covered = await page.evaluate(inpage.findCovered);
        baseline.set(`${width}|${def.id}`, data);
        measure(basicBag, data, def, width, "dark");
        await page.close();
      }
      await ctx.close();
    }

    // ── le skin, mode par mode
    for (const mode of modes) {
      for (const width of widths) {
        const ctx = await newCtx(sk, width, mode);
        for (const def of pages) {
          const { page, status } = await visit(ctx, sk, def);
          if (status !== (def.status ?? 200)) bag.add("kit-page-error", { page: pageLabel(def), status });
          const data = await page.evaluate(inpage.collectPage);
          data.covered = await page.evaluate(inpage.findCovered);
          const base = baseline.get(`${width}|${def.id}`);
          compare(bag, base, data, def, width, mode);
          measure(bag, data, def, width, mode);
          await collectFonts(page);
          if (width === widths[0] || width === 1280) { const moving = await page.evaluate(inpage.runningMotion); if (moving.length) bag.add("kit-reduced-motion", { what: moving.join(", "), page: pageLabel(def), width }); }

          if (CONTRAST_WIDTHS.includes(width) || options.allContrast) await contrast(page, bag, def, width, mode, false);
          if (hasBackdrop && CONTRAST_WIDTHS.includes(width)) await contrast(page, bag, def, width, mode, true);
          if (FOCUS_WIDTHS.includes(width) && FOCUS_PAGES.includes(def.id) && mode === modes[0]) await focus(page, bag, data, def, width);
          if (shotDir) { await page.screenshot({ path: path.join(shotDir, `${st.manifest?.id ?? "skin"}-${def.id}-${width}-${mode}.png`), fullPage: true }); info.shots++; }
          await page.close();
        }
        // menu, bascule : une page d'accueil par largeur et par mode
        const home = pages.find((p) => p.id === "home") ?? pages[0];
        if (home) {
          const { page } = await visit(ctx, sk, home);
          await menuChecks(page, bag, width, home);
          await page.mouse.move(0, 0); await page.keyboard.press("Escape"); await page.waitForTimeout(60);
          if (modes.length === 2 && mode === modes[0]) await switchChecks(page, bag, width, home);
          await page.close();
        }
        await ctx.close();
      }
    }

    // ── fichiers du skin et polices
    for (const url of external) issues.push(kitIssue("kit-external-request", { url, page: "" }));
    for (const url of failed) issues.push(kitIssue("kit-request-failed", { url, page: "" }));
    for (const a of (st.manifest?.assets ?? []).filter((x) => x.kind === "font" && x.family)) {
      const s = fontStatus.get(a.family);
      if (!s) issues.push(kitIssue("kit-font-not-used", { family: a.family }));
      else if (s.has("error") && !s.has("loaded")) issues.push(kitIssue("kit-font-not-loaded", { family: a.family, reason: { fr: "le navigateur n'a pas pu lire le fichier", en: "the browser could not read the file" } }));
      else if (!s.has("loaded")) issues.push(kitIssue("kit-font-not-used", { family: a.family }));
    }
    for (const [pid, text] of consoleErrors) issues.push(kitIssue("kit-console-error", { page: pid, text }));

    // ── régression de basic (une fois par exécution)
    if (options.basicRegression !== false) issues.push(...(await basicRegression(browser, widths.filter((w) => DEFAULT_WIDTHS.includes(w)), pages, newCtx, visit, servers)));

    const basicKeys = new Set([...basicBag.map.values()].map((e) => `${e.code}|${JSON.stringify(e.rest)}|${e.page?.en ?? ""}`));
    issues.push(...bag.issues((e) => basicKeys.has(`${e.code}|${JSON.stringify(e.rest)}|${e.page?.en ?? ""}`) && !/^kit-(hidden|text-changed|structure-changed|injected-text|covered|offscreen|font|external|request|page-error|mode-switch|focus-missing)/.test(e.code)));
  } catch (e) {
    issues.push(kitIssue("kit-browser-unavailable", { reason: String(e?.stack ?? e).split("\n").slice(0, 2).join(" ").slice(0, 200) }));
  } finally {
    for (const s of servers) await s.close();
    await browser.close();
  }
  return { issues: dedupe(issues), info };
}

const dedupe = (list) => { const seen = new Set(); return list.filter((i) => { const k = `${i.code}|${i.message.fr}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

async function freePort(from = PORT_BASE) {
  const net = await import("node:net");
  for (let p = from; p < from + 40; p++) {
    const ok = await new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.listen(p, "127.0.0.1", () => s.close(() => resolve(true))); });
    if (ok) return p;
  }
  return 0;
}

const firstDiff = (a, b) => { const A = a.split(" "), B = b.split(" "); let i = 0; while (i < A.length && A[i] === B[i]) i++; return `« ${A.slice(Math.max(0, i - 2), i + 3).join(" ")} » / « ${B.slice(Math.max(0, i - 2), i + 3).join(" ")} »`; };

/** Skin contre basic : mêmes textes, mêmes éléments ; rien de masqué, recouvert, hors de l'écran ; rien d'ajouté. */
function compare(bag, base, data, def, width, mode) {
  const p = pageLabel(def);
  if (data.text !== base.text) bag.add("kit-text-changed", { what: firstDiff(base.text, data.text), page: p, width, mode });
  for (const [k, what] of [["links", { fr: "liens", en: "links" }], ["images", { fr: "images", en: "images" }], ["headings", { fr: "titres", en: "headings" }], ["controls", { fr: "éléments cliquables", en: "clickable elements" }]]) {
    if (JSON.stringify(base[k]) !== JSON.stringify(data[k])) bag.add("kit-structure-changed", { what, page: p, width, mode });
  }
  const seenText = new Set(data.texts);
  const lostText = [...new Set(base.texts)].filter((t) => !seenText.has(t));
  if (lostText.length) bag.add("kit-hidden", { what: `« ${lostText[0]} »${lostText.length > 1 ? ` (+${lostText.length - 1})` : ""}`, page: p, width, mode });
  const visNow = new Map(data.focusables.map((f) => [f.key, f]));
  for (const f of base.focusables.filter((x) => x.visible)) {
    const now = visNow.get(f.key);
    if (!now || !now.visible) bag.add("kit-hidden", { what: f.key, page: p, width, mode });
    else if (!now.fixed && (now.right < 0 || now.left > data.scroll.innerWidth + 1)) bag.add("kit-offscreen", { what: f.key, page: p, width, mode });
  }
  for (const t of data.injected) bag.add("kit-injected-text", { text: t, page: p, width, mode });
  const baseCovered = new Set(base.covered);
  for (const c of data.covered) if (!baseCovered.has(c)) bag.add("kit-covered", { what: c, page: p, width, mode });
}

/** Les mesures qui ne demandent pas de comparaison : défilement, texte coupé, cibles, tailles, interligne, ordre de tabulation. */
function measure(bag, data, def, width, mode) {
  const p = pageLabel(def);
  const over = data.scroll.scrollWidth - data.scroll.innerWidth;
  if (over > 1) bag.add("kit-scroll-x", { over, page: p, width, mode });
  for (const c of data.clipped) bag.add("kit-text-clipped", { what: c, page: p, width, mode });
  for (const f of data.focusables) {
    if (!f.visible || f.inline || f.part === "skip-link") continue;
    const size = Math.round(Math.min(f.w, f.h));
    if (size < 24) bag.add("kit-target-size", { what: f.key, size, min: 24, page: p, width, mode });
    else if (width < 640 && (f.w < 43.5 || f.h < 43.5) && f.part !== "skip-link") bag.add("kit-target-size-warn", { what: f.key, size, page: p, width, mode });
  }
  for (const s of data.sizes) {
    if (s.fs < 12) bag.add("kit-text-size", { what: s.key, size: Math.round(s.fs * 10) / 10, min: 12, page: p, width, mode });
    else if (s.fs < 13.99 && s.body) bag.add("kit-text-size-warn", { what: s.key, size: Math.round(s.fs * 10) / 10, page: p, width, mode });
    if (s.body && s.lines >= 2 && s.lh / s.fs < 1.3) bag.add("kit-leading", { what: s.key, ratio: Math.round((s.lh / s.fs) * 100) / 100, min: 1.4, page: p, width, mode });
  }
  const vis = data.focusables.filter((f) => f.visible && f.path && f.region !== "skip");
  if (vis.length >= 4) {
    const m = tabOrderMetrics({ items: vis.map((f) => ({ region: f.region, path: f.path, label: f.key })), boxes: data.orderBoxes, columns: data.orderColumns });
    const j = judgeOrder(m);
    const reg = j.region ? { fr: regionName(j.region, "fr"), en: regionName(j.region, "en") } : "";
    if (process.env.DEBUG_KIT) console.error("order", width, def.id, m.percent, JSON.stringify(m.containers.slice(0, 2).map((c) => `${c.region}:${c.branches}br:${c.percent}`)), JSON.stringify(m.samples));
    if (j.level === "error") bag.add(j.region ? "kit-tab-order-region" : "kit-tab-order", { percent: j.percent, region: reg, page: p, width, mode });
    else if (j.level === "warning") bag.add("kit-tab-order-warn", { percent: j.percent, region: reg, page: p, width, mode }, "warn");
  }
}
const regionName = (r, L) => ({ header: L === "fr" ? "l'en-tête" : "the header", main: L === "fr" ? "le contenu" : "the content", footer: L === "fr" ? "le pied de page" : "the footer", banner: L === "fr" ? "le bandeau" : "the banner" }[r] ?? r);

/** Contraste rendu : le texte devient transparent, on lit les pixels qui sont réellement derrière chaque texte. */
async function contrast(page, bag, def, width, mode, noFilter) {
  const runs = await page.evaluate(inpage.prepareContrast, noFilter);
  try {
    const shot = await page.screenshot({ fullPage: true });
    const raw = await rawOf(shot);
    for (const run of runs) {
      const r = await worstContrast(raw, run);
      const min = run.large ? 3 : 4.5;
      if (r.ratio !== null && r.ratio < min - 0.05) bag.add(noFilter ? "kit-contrast-nofilter" : "kit-contrast-rendered", { what: `« ${run.text} »`, ratio: r.ratio, min, page: pageLabel(def), width, mode }, run.key);
    }
  } finally { await page.evaluate(inpage.unhide); }
}

/** Dans la page : l'élément qui a le focus (clé, boîte) ; il est mémorisé pour le retrouver après l'avoir quitté. */
function focusInfo() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  a.scrollIntoView({ block: "center" });
  window.__benchFocused = a;
  const r = a.getBoundingClientRect(); const part = a.getAttribute("data-skin-part") || "";
  let op = 1; for (let n = a; n; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
  return { dim: op < 0.99, key: `${a.tagName.toLowerCase()}${part ? `[${part}]` : ""}:${(a.getAttribute("aria-label") || a.textContent || a.getAttribute("href") || a.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 50)}`, x: r.left, y: r.top, w: r.width, h: r.height, skip: part === "skip-link" };
}

/** Focus visible : on atteint les éléments avec Tab ; chacun doit changer de façon visible (cadre, ombre, fond…). */
async function focus(page, bag, data, def, width) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.body.setAttribute("tabindex", "-1"); document.body.focus(); document.body.removeAttribute("tabindex"); });
  const seen = new Set();
  let count = 0;
  for (let i = 0; i < 60 && count < FOCUS_CAP; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(focusInfo);
    if (!info || seen.has(info.key)) break;
    seen.add(info.key);
    if (info.skip || info.dim || info.w < 2 || info.h < 2) continue;
    const pad = 10;
    const clip = { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: Math.min(info.w + 2 * pad, 700), height: Math.min(info.h + 2 * pad, 300) };
    const after = await rawOf(await page.screenshot({ clip }));
    await page.evaluate(() => { window.__benchFocused?.blur?.(); });
    const before = await rawOf(await page.screenshot({ clip }));
    const ch = await focusChange(before, after);
    if (process.env.DEBUG_KIT) console.error("focus", width, def.id, info.key, ch);
    const p = pageLabel(def);
    if (ch.changed < 12) bag.add("kit-focus-missing", { what: info.key, page: p, width });
    else if (ch.strong / ch.changed < 0.3) bag.add("kit-focus-weak", { what: info.key, ratio: "< 3", page: p, width }, "weak");
    count++;
    await page.evaluate(() => { window.__benchFocused?.focus({ focusVisible: true }); });
  }
}

/** Menu : petit écran (ouvrir, liens visibles, Échap) ou grand écran (sous-menu au survol). */
async function menuChecks(page, bag, width, def) {
  const p = pageLabel(def);
  const toggle = (await page.evaluate(inpage.boxes, "[data-skin-part=menu-toggle]"))[0];
  const topLinks = async () => (await page.evaluate(() => [...document.querySelectorAll("[data-skin-part=nav-link]")].filter((e) => !e.closest("[data-skin-part=submenu]")).map((e) => { const r = e.getBoundingClientRect(); let ok = r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) ok = false; } return { text: e.textContent.trim().slice(0, 30), ok }; })));
  if (width < 640) {
    if (!toggle) { bag.add("kit-menu-closed-unreachable", { what: { fr: "le bouton « Menu » est absent", en: "the “Menu” button is missing" }, page: p, width }); return; }
    if (toggle.visible) {
      await page.locator("[data-skin-part=menu-toggle]").first().click({ timeout: 3000 }).catch(() => bag.add("kit-menu-closed-unreachable", { what: { fr: "le bouton « Menu » ne peut pas être touché", en: "the “Menu” button cannot be touched" }, page: p, width }));
      await page.waitForTimeout(80);
      const links = await topLinks();
      const bad = links.filter((l) => !l.ok);
      if (!links.length || bad.length) bag.add("kit-menu-closed-unreachable", { what: { fr: `après avoir ouvert le menu, ${bad.length || "tous les"} lien(s) restent invisibles (${bad[0]?.text ?? ""})`, en: `after opening the menu, ${bad.length || "all"} link(s) stay invisible (${bad[0]?.text ?? ""})` }, page: p, width });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
      const after = await page.evaluate(() => document.querySelector("[data-site-nav] [data-skin-part=nav-list]")?.getAttribute("data-open") ?? "false");
      if (after === "true") bag.add("kit-menu-keyboard", { what: { fr: "Échap ne referme pas le menu", en: "Escape does not close the menu" }, page: p, width });
    } else {
      // bouton masqué (permis) : alors la liste doit être visible sans rien faire
      const links = await topLinks();
      if (!links.length || links.some((l) => !l.ok)) bag.add("kit-menu-closed-unreachable", { what: { fr: "le bouton « Menu » est masqué mais la liste ne s'affiche pas", en: "the “Menu” button is hidden but the list is not shown" }, page: p, width });
    }
  } else {
    const row = page.locator("[data-site-nav] [data-row]").first();
    if (await row.count()) {
      await row.hover({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(80);
      let subs = await page.evaluate(inpage.boxes, "[data-site-nav] [data-row] [data-skin-part=submenu] a");
      if (!subs.length || subs.some((s) => !s.visible)) {
        await page.locator("[data-site-nav] [data-trigger]").first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(60);
        subs = await page.evaluate(inpage.boxes, "[data-site-nav] [data-row] [data-skin-part=submenu] a");
      }
      if (!subs.length || subs.some((s) => !s.visible)) bag.add("kit-menu-keyboard", { what: { fr: "les liens du sous-menu restent invisibles au survol", en: "the submenu links stay invisible on hover" }, page: p, width });
    }
  }
}

/** Bascule clair/sombre : visible, opérable, trois états distincts, ne change que les couleurs. */
async function switchChecks(page, bag, width, def) {
  const p = pageLabel(def);
  const group = (await page.evaluate(inpage.boxes, "[data-skin-part=mode-switch]"))[0];
  const opts = await page.evaluate(inpage.boxes, "[data-skin-part=mode-option]");
  const fail = (fr, en) => bag.add("kit-mode-switch", { what: { fr, en }, page: p, width });
  if (!group || !group.visible) return fail("la bascule n'est pas visible", "the switch is not visible");
  if (opts.length !== 3 || opts.some((o) => !o.visible)) return fail("ses trois boutons ne sont pas tous visibles", "its three buttons are not all visible");
  const state = async () => page.evaluate(() => ({ mode: document.documentElement.getAttribute("data-mode"), bg: getComputedStyle(document.body).backgroundColor, pressed: [...document.querySelectorAll("[data-skin-part=mode-option]")].map((b) => b.getAttribute("aria-pressed")), text: document.body.innerText.replace(/\s+/g, " ").trim() }));
  const clickValue = async (v) => { await page.locator(`[data-skin-part=mode-option][data-mode-value=${v}]`).first().click({ timeout: 3000 }); await page.waitForTimeout(60); };
  try {
  await clickValue("light"); const a = await state();
  await clickValue("dark"); const b = await state();
  if (a.mode !== "light" || b.mode !== "dark") return fail("un clic ne change pas le mode", "a click does not change the mode");
  if (a.bg === b.bg) fail("le fond est le même en clair et en sombre", "the background is the same in light and dark");
  if (a.pressed.filter((x) => x === "true").length !== 1 || b.pressed.filter((x) => x === "true").length !== 1) fail("l'état choisi n'est pas annoncé (aria-pressed)", "the chosen state is not announced (aria-pressed)");
  if (a.text.replace(/\s+/g, "") !== b.text.replace(/\s+/g, "")) fail("basculer change des textes", "switching changes texts");
  await clickValue("auto");
  } catch (e) { fail("un des boutons de la bascule ne peut pas être touché (recouvert ou hors de l'écran)", "one of the switch buttons cannot be touched (covered or off-screen)"); if (process.env.DEBUG_KIT) console.error(String(e).slice(0, 600)); }
}

/** Basic : la page rendue avec ses jetons (composition) est identique, au pixel, à la page rendue seulement avec les couleurs d'origine du site (avant les skins). */
async function basicRegression(browser, widths, pages, newCtx, visit, servers) {
  if (basicRegressionMemo) return basicRegressionMemo;
  const out = [];
  const legacy = await startDemoServer(await prepareSite(null, { legacy: true }), { port: await freePort(3570) });
  const basic = await startDemoServer(await prepareSite(null), { port: await freePort(legacy.port + 1) });
  servers.push(legacy, basic);
  try {
    for (const width of widths) {
      const a = await newCtx(legacy, width, "dark"), b = await newCtx(basic, width, "dark");
      for (const def of pages) {
        const pa = await visit(a, legacy, def), pb = await visit(b, basic, def);
        const ra = await rawOf(await pa.page.screenshot({ fullPage: true })), rb = await rawOf(await pb.page.screenshot({ fullPage: true }));
        const n = diffCount(ra, rb);
        if (n) out.push(kitIssue("kit-basic-regression", { page: pageLabel(def), width, pixels: n }));
        await pa.page.close(); await pb.page.close();
      }
      await a.close(); await b.close();
    }
  } finally { await legacy.close(); await basic.close(); }
  basicRegressionMemo = out;
  return out;
}
