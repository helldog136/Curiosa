#!/usr/bin/env node
// Contrôle du DOM stable dans un vrai navigateur (docs/SKINS.md §9, lot S2).
//   node scripts/visual/dom-check.mjs [--profiles night,layout-minimal,layout-tworows,layout-centered] [--widths 390,1280]
// Pour chaque profil (un serveur) et chaque largeur : régions et pièces présentes sur chaque type de page, tous les noms connus de la liste blanche de l'assainisseur,
// ordre du DOM (bannière, en-tête, contenu, pied), ordre de tabulation = ordre du DOM, lien d'évitement premier, menu mobile (ouvrir, fermer, Échap, clic ailleurs),
// menu large (survol, ↓, Échap), aucun élément de menu masqué. Aucune capture n'est écrite. Code de sortie 1 au moindre écart.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_DIR, PORT_BASE } from "./config.mjs";
import { PROFILE_ORDER } from "./profiles.mjs";
import { loadPlaywright, chromiumPath, CHROMIUM_ARGS } from "./lib/playwright.mjs";

const SITE = fileURLToPath(new URL("./site.mjs", import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const profiles = opt("profiles", "night,layout-minimal,layout-tworows,layout-centered").split(",");
const widths = opt("widths", "390,1280").split(",").map(Number);

// Les listes de la liste blanche, lues dans le source (le script est du JavaScript pur, l'allowlist est en TypeScript).
const allow = fs.readFileSync(`${CORE_DIR}/src/core/skins/allowlist.ts`, "utf8");
const listOf = (name) => [...new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(allow)[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
const REGIONS = listOf("REGIONS"), PARTS = listOf("PARTS");

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
const failures = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

async function visit(ctx, base, path) {
  const tab = await ctx.newPage();
  const resp = await tab.goto(base + path, { waitUntil: "load", timeout: 45000 });
  await tab.waitForTimeout(300);
  return { tab, status: resp?.status() ?? 0 };
}

/** Les éléments focalisables VISIBLES, dans l'ordre du DOM, puis l'ordre dans lequel Tab les parcourt. */
async function tabOrder(tab) {
  const dom = await tab.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]") && !e.closest("[inert]"); };
    const all = [...document.querySelectorAll(sel)].filter(vis);
    all.forEach((e, i) => e.setAttribute("data-dc-i", String(i)));
    return all.length;
  });
  await tab.evaluate(() => { (document.activeElement)?.blur?.(); window.scrollTo(0, 0); });
  const seen = [];
  for (let i = 0; i < Math.min(dom + 3, 140); i++) {
    await tab.keyboard.press("Tab");
    const idx = await tab.evaluate(() => { const a = document.activeElement; return a && a.hasAttribute("data-dc-i") ? Number(a.getAttribute("data-dc-i")) : -1; });
    if (idx === -1) continue;
    if (seen.includes(idx)) break;
    seen.push(idx);
  }
  return { dom, seen };
}

for (const profile of profiles) {
  if (!PROFILE_ORDER.includes(profile)) { console.log(`profil inconnu ignoré : ${profile}`); continue; }
  const port = PORT_BASE + PROFILE_ORDER.indexOf(profile);
  console.log(`\n== ${profile} (port ${port}) ==`);
  execFileSync("node", [SITE, "up", profile], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, locale: "fr-FR", reducedMotion: "reduce" });
      await ctx.addCookies([{ name: "curiosa_cookies", value: "no", domain: "127.0.0.1", path: "/", expires: Math.floor(Date.now() / 1000) + 86400 }]);
      // les pages types : accueil, confidentialité, introuvable, liste, entrée, page de module
      const paths = ["/", "/privacy", "/page-introuvable", "/blog", "/events", "/faq", "/galeries", "/a-propos"];
      const first = await visit(ctx, base, "/blog");
      const entry = await first.tab.evaluate(() => document.querySelector('[data-skin-part="list"] a[href^="/blog/"]')?.getAttribute("href") ?? null);
      await first.tab.close();
      if (entry) paths.push(entry);
      for (const p of paths) {
        const { tab, status } = await visit(ctx, base, p);
        const tag = `${profile} ${width}px ${p}`;
        if (status >= 500 || (status === 404 && p !== "/page-introuvable")) { await tab.close(); if (status >= 500) failures.push(`${tag} : HTTP ${status}`); continue; }
        const info = await tab.evaluate(() => {
          const q = (s) => [...document.querySelectorAll(s)];
          const pos = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
          const one = (r) => document.querySelector(`[data-skin-region="${r}"]`);
          const regions = q("[data-skin-region]").map((e) => e.getAttribute("data-skin-region"));
          const parts = q("[data-skin-part]").map((e) => e.getAttribute("data-skin-part"));
          const shell = one("shell"), banner = one("banner"), header = one("header"), nav = one("nav"), tools = one("tools"), main = one("main"), content = one("content"), footer = one("footer");
          const skip = document.querySelector('[data-skin-part="skip-link"]');
          return {
            regions, parts, hasRoot: document.body.hasAttribute("data-skin-root"), skinAttr: document.documentElement.getAttribute("data-skin"),
            mains: q("main").length, mainId: main?.id, skipHref: skip?.getAttribute("href"),
            order: pos(banner, header) && pos(header, main) && pos(main, footer) && pos(skip, shell),
            nesting: shell?.contains(banner) && shell?.contains(header) && shell?.contains(main) && shell?.contains(footer) && header?.contains(nav) && header?.contains(tools) && main?.contains(content) && !header?.contains(main),
            brandInHeader: !!header?.querySelector('[data-skin-part="brand"]'),
            h1: q('[data-skin-part="heading"][data-level="1"]').length,
            navLinks: q('[data-skin-part="nav-link"]').length, footerLinks: q('[data-skin-part="footer-link"]').length, credit: !!document.querySelector('[data-skin-part="credit"]'),
            shellDisplay: shell ? getComputedStyle(shell).display : null,
            mainWidth: content ? Math.round(content.getBoundingClientRect().width) : null,
          };
        });
        for (const r of ["shell", "banner", "header", "nav", "tools", "main", "content", "footer"]) ok(info.regions.includes(r), `${tag} : région « ${r} » absente`);
        for (const r of new Set(info.regions)) ok(REGIONS.includes(r), `${tag} : région inconnue de l'assainisseur : ${r}`);
        for (const r of new Set(info.parts)) ok(PARTS.includes(r) || r.includes("."), `${tag} : pièce inconnue de l'assainisseur : ${r}`);
        for (const part of ["brand", "footer-link", "credit", "skip-link"]) ok(info.parts.includes(part), `${tag} : pièce « ${part} » absente`);
        ok(info.hasRoot, `${tag} : body sans data-skin-root`);
        ok(info.skinAttr === "basic" || !!info.skinAttr, `${tag} : html sans data-skin`);
        ok(info.mains === 1 && info.mainId === "content" && info.skipHref === "#content", `${tag} : main / lien d'évitement (${info.mains} main, id ${info.mainId}, href ${info.skipHref})`);
        ok(info.order, `${tag} : l'ordre du DOM n'est pas lien d'évitement, bannière, en-tête, contenu, pied`);
        ok(info.nesting, `${tag} : emboîtement des régions incorrect`);
        ok(info.brandInHeader, `${tag} : la marque n'est pas dans l'en-tête`);
        ok(info.credit && info.footerLinks >= 1, `${tag} : crédit ou lien du pied absent`);
        ok(info.navLinks >= 1, `${tag} : aucun lien de menu`);
        ok(info.shellDisplay === "block", `${tag} : la coquille de basic doit être en display:block (est : ${info.shellDisplay})`);
        if (p !== "/") ok(info.h1 >= 1 || p === "/page-introuvable", `${tag} : pas de titre de niveau 1`);
        // ordre de tabulation = ordre du DOM, et chaque élément visible est atteint
        const { dom, seen } = await tabOrder(tab);
        const sorted = [...seen].every((v, i) => i === 0 || v > seen[i - 1]);
        ok(sorted, `${tag} : l'ordre de tabulation ne suit pas l'ordre du DOM (${seen.slice(0, 30).join(",")})`);
        ok(seen.length >= Math.min(dom, 100) - 1, `${tag} : Tab n'atteint que ${seen.length} éléments sur ${dom}`);
        ok(seen[0] === 0, `${tag} : le premier élément atteint n'est pas le lien d'évitement (${seen[0]})`);
        await tab.close();
      }
      // le menu
      if (profile === "night") {
        const { tab } = await visit(ctx, base, "/");
        const box = async (sel) => tab.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return { w: r.width, h: r.height, display: st.display, vis: st.visibility }; }, sel);
        const tag = `menu ${width}px`;
        const toggle = '[data-skin-part="menu-toggle"]', list = '[data-site-nav] [data-skin-part="nav-list"]';
        if (width < 640) {
          const t = await box(toggle), l = await box(list);
          ok(t && t.w > 0, `${tag} : bouton « Menu » invisible`);
          ok(l && l.display === "none", `${tag} : la liste devrait être fermée au départ`);
          ok((await tab.getAttribute(list, "data-open")) === "false" && (await tab.getAttribute(toggle, "aria-expanded")) === "false", `${tag} : état fermé (data-open / aria-expanded)`);
          await tab.click(toggle);
          const l2 = await box(list);
          ok(l2 && l2.w > 0 && l2.h > 0, `${tag} : la liste ne s'ouvre pas`);
          ok((await tab.getAttribute(list, "data-open")) === "true" && (await tab.getAttribute(toggle, "aria-expanded")) === "true", `${tag} : état ouvert (data-open / aria-expanded)`);
          const hidden = await tab.evaluate((s) => [...document.querySelectorAll(`${s} > li > [data-skin-part="nav-link"]`)].filter((a) => a.getBoundingClientRect().width === 0).length, list);
          ok(hidden === 0, `${tag} : ${hidden} lien(s) de menu sans boîte une fois ouvert`);
          await tab.keyboard.press("Escape");
          ok((await tab.getAttribute(list, "data-open")) === "false", `${tag} : Échap ne ferme pas le menu`);
          ok(await tab.evaluate(() => document.activeElement?.getAttribute("data-skin-part") === "menu-toggle"), `${tag} : Échap ne rend pas le focus au bouton « Menu »`);
          await tab.click(toggle);
          await tab.mouse.click(5, 700);
          ok((await tab.getAttribute(list, "data-open")) === "false", `${tag} : un clic ailleurs ne ferme pas le menu`);
        } else {
          const t = await box(toggle), l = await box(list);
          ok(!t || t.display === "none", `${tag} : le bouton « Menu » devrait disparaître sur grand écran`);
          ok(l && l.w > 0 && l.display === "flex", `${tag} : la liste devrait être visible (rangée)`);
          const sub = await tab.evaluate(() => { const b = document.querySelector('[data-site-nav] [data-skin-part="submenu-toggle"], [data-site-nav] button[data-trigger]'); return b ? b.getAttribute("data-trigger") : null; });
          ok(sub !== null, `${tag} : le jeu de données de démonstration n'a pas de sous-menu à tester`);
          if (sub !== null) {
            const subSel = `[data-site-nav] [data-sub="${sub}"]`;
            ok(((await box(subSel))?.display) === "none", `${tag} : le sous-menu devrait être fermé`);
            await tab.hover(`[data-site-nav] [data-row="${sub}"]`);
            ok(((await box(subSel))?.display) === "block", `${tag} : le survol n'ouvre pas le sous-menu`);
            await tab.mouse.move(5, 5);
            await tab.focus(`[data-site-nav] [data-trigger="${sub}"]`);
            await tab.keyboard.press("ArrowDown");
            ok((await tab.getAttribute(subSel, "data-open")) === "true", `${tag} : ↓ n'ouvre pas le sous-menu`);
            ok(await tab.evaluate((s) => document.querySelector(s)?.contains(document.activeElement), subSel), `${tag} : ↓ ne place pas le focus dans le sous-menu`);
            await tab.keyboard.press("Escape");
            ok((await tab.getAttribute(subSel, "data-open")) === "false", `${tag} : Échap ne ferme pas le sous-menu`);
            ok(await tab.evaluate((i) => document.activeElement?.getAttribute("data-trigger") === i, sub), `${tag} : Échap ne rend pas le focus au bouton du sous-menu`);
          }
        }
        await tab.close();
      }
      await ctx.close();
    }
  } finally {
    execFileSync("node", [SITE, "down", profile], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } });
  }
}
await browser.close();
console.log(`\n${checks} contrôles, ${failures.length} écart(s)`);
for (const f of failures.slice(0, 60)) console.log("  ÉCART :", f);
process.exit(failures.length ? 1 : 0);
