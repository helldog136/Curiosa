#!/usr/bin/env node
// Preuve qu'un skin ne change QUE l'apparence : mêmes textes, mêmes liens, mêmes éléments focalisables, même ordre de tabulation, rien de masqué, avec et sans le skin d'essai.
//   VISUAL_SKIN_DIR=<dossier> VISUAL_SKIN_ID=<id> node scripts/visual/skin-proof.mjs [--widths 390,768,1280,1920]
// Compare le profil `night` (basic) au profil `skin-test` (le skin installé à la main) sur l'accueil, la confidentialité, la page introuvable, des listes, une fiche et des pages de modules.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PORT_BASE } from "./config.mjs";
import { PROFILE_ORDER } from "./profiles.mjs";
import { loadPlaywright, chromiumPath, CHROMIUM_ARGS } from "./lib/playwright.mjs";

if (!PROFILE_ORDER.includes("skin-test")) { console.error("Pose VISUAL_SKIN_DIR et VISUAL_SKIN_ID (voir le README du harnais)."); process.exit(2); }
const SITE = fileURLToPath(new URL("./site.mjs", import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const widths = opt("widths", "390,768,1280,1920").split(",").map(Number);
const PATHS = ["/", "/privacy", "/page-introuvable", "/blog", "/events", "/faq", "/galeries", "/a-propos"];
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });

async function collect(profile) {
  const port = PORT_BASE + PROFILE_ORDER.indexOf(profile);
  execFileSync("node", [SITE, "up", profile], { stdio: "ignore", env: { ...process.env, NODE_OPTIONS: "" } });
  const out = {};
  try {
    const base = `http://127.0.0.1:${port}`;
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, locale: "fr-FR", reducedMotion: "reduce" });
      await ctx.addCookies([{ name: "curiosa_cookies", value: "no", domain: "127.0.0.1", path: "/", expires: Math.floor(Date.now() / 1000) + 86400 }]);
      const probe = await ctx.newPage(); await probe.goto(base + "/blog", { waitUntil: "load" });
      const entry = await probe.evaluate(() => document.querySelector('[data-skin-part="list"] a[href^="/blog/"]')?.getAttribute("href") ?? null); await probe.close();
      for (const p of entry ? [...PATHS, entry] : PATHS) {
        const tab = await ctx.newPage();
        const resp = await tab.goto(base + p, { waitUntil: "load" }); await tab.waitForTimeout(250);
        const data = await tab.evaluate(() => {
          const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
          const sel = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';
          const all = [...document.querySelectorAll(sel)];
          const box = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
          // les éléments cachés AVANT tout skin (par le cœur : menu fermé, bascule sans script, piège à robots) : on les range à part
          const label = (e) => norm(e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.getAttribute("href") || e.name);
          return {
            // le texte visible et lisible (sans scripts, feuilles de style ni données structurées, qui portent l'adresse du serveur : un port différent par profil)
            text: (() => { const c = document.body.cloneNode(true); c.querySelectorAll("script, style, noscript").forEach((e) => e.remove()); return norm(c.textContent); })(),
            links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
            controls: all.map((e) => `${e.tagName.toLowerCase()}:${label(e).slice(0, 60)}`),
            visible: all.filter(box).map((e) => `${e.tagName.toLowerCase()}:${label(e).slice(0, 60)}`),
            // le logo suit la luminance du fond (variante claire ou sombre : règle du cœur, pas du skin) : on compare ses textes (alt), pas son fichier
            images: [...document.images].filter((i) => !i.closest('[data-skin-part="brand"]')).map((i) => i.getAttribute("src")).filter(Boolean),
            brandAlts: [...document.querySelectorAll('[data-skin-part="brand"] img')].map((i) => i.getAttribute("alt")),
            headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => `${h.tagName}:${norm(h.textContent)}`),
            scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          };
        });
        // ordre de tabulation réel
        const seen = [];
        await tab.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
        for (let i = 0; i < 120; i++) {
          await tab.keyboard.press("Tab");
          const l = await tab.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; return `${a.tagName.toLowerCase()}:${(a.getAttribute("aria-label") || a.textContent || a.getAttribute("href") || "").replace(/\s+/g, " ").trim().slice(0, 60)}`; });
          if (l === null) break;
          if (seen.length && seen[0] === l && seen.length > 3) break;
          seen.push(l);
        }
        data.tabOrder = seen; data.status = resp?.status() ?? 0;
        out[`${width}${p}`] = data;
        await tab.close();
      }
      await ctx.close();
    }
  } finally { execFileSync("node", [SITE, "down", profile], { stdio: "ignore", env: { ...process.env, NODE_OPTIONS: "" } }); }
  return out;
}

const basic = await collect("night");
const skin = await collect("skin-test");
await browser.close();
let bad = 0, pages = 0;
const note = (m) => { bad++; console.log("  ÉCART :", m); };
for (const key of Object.keys(basic)) {
  pages++;
  const a = basic[key], b = skin[key];
  if (!b) { note(`${key} : absente avec le skin`); continue; }
  if (a.status !== b.status) note(`${key} : statut ${a.status} → ${b.status}`);
  if (a.text !== b.text) { let i = 0; while (i < a.text.length && a.text[i] === b.text[i]) i++; note(`${key} : le texte (textContent) diffère vers « ${a.text.slice(Math.max(0, i - 30), i + 50)} » / « ${b.text.slice(Math.max(0, i - 30), i + 50)} »`); }
  if (JSON.stringify(a.brandAlts) !== JSON.stringify(b.brandAlts)) note(`${key} : le nom de la marque diffère`);
  if (JSON.stringify(a.links) !== JSON.stringify(b.links)) note(`${key} : les liens diffèrent`);
  if (JSON.stringify(a.controls) !== JSON.stringify(b.controls)) note(`${key} : les éléments focalisables diffèrent`);
  if (JSON.stringify(a.images) !== JSON.stringify(b.images)) note(`${key} : les images diffèrent`);
  if (JSON.stringify(a.headings) !== JSON.stringify(b.headings)) note(`${key} : les titres diffèrent`);
  // rien de masqué par le skin : tout élément visible sous basic est visible avec le skin
  const lost = a.visible.filter((v) => !b.visible.includes(v));
  if (lost.length) note(`${key} : éléments visibles sous basic, masqués avec le skin : ${lost.slice(0, 4).join(" | ")}`);
  if (JSON.stringify(a.tabOrder) !== JSON.stringify(b.tabOrder)) note(`${key} : l'ordre de tabulation diffère (${a.tabOrder.length} / ${b.tabOrder.length} arrêts)`);
  if (b.scrollX) note(`${key} : défilement horizontal de la page avec le skin`);
}
console.log(`\n${pages} pages × (texte, liens, éléments focalisables, images, titres, éléments visibles, ordre de tabulation) : ${bad} écart(s)`);
process.exit(bad ? 1 : 0);
