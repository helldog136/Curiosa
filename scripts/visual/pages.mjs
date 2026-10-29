// Liste des pages à capturer : DÉCOUVERTE automatique (plan du site), plus les pages fixes et les états. Rien n'est codé en dur pour un module en particulier,
// sauf la liste des formulaires à soumettre vides et les pages « échantillon » des variantes de mise en page.
import { LOCALES } from "./config.mjs";

/** Nom de fichier stable d'une page : "/" → "home", "/blog/mon-billet" → "blog__mon-billet". */
export function pageId(p) {
  const clean = p.replace(/\?.*$/, "").replace(/^\/+|\/+$/g, "");
  const base = clean === "" ? "home" : clean.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\//g, "__");
  const q = /\?(.+)$/.exec(p)?.[1];
  return q ? `${base}~${q.replace(/[^A-Za-z0-9=&_-]+/g, "").replace(/[=&]/g, "-")}` : base;
}

/** Plan du site → liste de { path, locale, depth }. Les adresses absolues sont ramenées à un chemin ; `/en/...` est la langue anglaise. */
export async function discover(base) {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const locs = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].replaceAll("&amp;", "&")).pathname);
  const seen = new Set();
  const out = [];
  for (const raw of locs) {
    const path = raw.replace(/\/+$/, "") || "/";
    if (seen.has(path)) continue;
    seen.add(path);
    const m = /^\/(\w{2})(\/.*)?$/.exec(path);
    const locale = m && LOCALES.includes(m[1]) && m[1] !== LOCALES[0] ? m[1] : LOCALES[0];
    const bare = locale === LOCALES[0] ? path : (m[2] || "/");
    out.push({ path, locale, bare, depth: bare === "/" ? 0 : bare.split("/").filter(Boolean).length });
  }
  return out;
}

/** Pages réellement capturées pour un profil. `entries` : nombre d'adresses profondes gardées par module. */
export function selectPages(found, { scope, locale, entries = 2 }) {
  const mine = found.filter((p) => p.locale === locale);
  const perGroup = new Map();
  const kept = [];
  for (const p of mine) {
    if (p.depth <= 1) { kept.push(p); continue; }
    const g = p.bare.split("/")[1];
    const n = perGroup.get(g) ?? 0;
    if (n < entries) { perGroup.set(g, n + 1); kept.push(p); }
  }
  if (scope === "sample") return kept.filter((p) => p.bare === "/" || p.bare === "/privacy" || ["/blog", "/events", "/faq", "/galeries"].includes(p.bare) || /^\/(blog|events)\/[^/]+$/.test(p.bare)).slice(0, 12);
  if (locale !== LOCALES[0]) return kept.filter((p) => p.depth <= 1);
  return kept;
}

/**
 * États d'une page (en plus de la capture normale). `when(page)` choisit les pages, `widths` restreint les largeurs, `fresh` = visiteur sans cookie de choix.
 * `run(tab)` met la page dans l'état voulu (clics, saisies) AVANT la capture ; il ne doit rien dépendre de l'heure ni du hasard.
 */
export const STATES = [
  { id: "menu-open", when: (p) => p.bare === "/", widths: [390], run: async (t) => { await t.click("[data-panel-button]"); } },
  { id: "submenu-open", when: (p) => p.bare === "/", widths: [768, 1280, 1920], run: async (t) => { if (await t.locator("[data-trigger]").count()) await t.locator("[data-trigger]").first().click(); } },
  { id: "cookies", when: (p) => p.bare === "/" || p.bare === "/privacy", fresh: true, run: async () => {} },
  { id: "focus", when: (p) => p.bare === "/", run: async (t) => { await t.keyboard.press("Tab"); } },
  // Formulaire de contact de l'accueil envoyé avec un e-mail refusé par le serveur : l'erreur s'affiche sous le formulaire.
  { id: "form-error", when: (p) => p.bare === "/", run: async (t) => {
    const f = t.locator("form.space-y-3").first();
    if (!(await f.count())) return;
    await f.locator("input[name=name]").fill("A");
    await f.locator("input[name=email]").fill("a@b");
    await f.locator("textarea[name=message]").fill("x");
    // requestSubmit : même chemin que le bouton, mais sans dépendre d'un élément flottant qui le recouvrirait selon la largeur.
    await f.evaluate((form) => form.requestSubmit());
    await t.waitForTimeout(2500);
  } },
  { id: "focus2", when: (p) => p.bare === "/", run: async (t) => { await t.keyboard.press("Tab"); await t.keyboard.press("Tab"); } },
];


const SKIP = /^\/(admin|api|m|go|uploads|overlays|feed|_next|icon|favicon|robots|sitemap|llms)/;
/** Complète la découverte : liens internes d'une page de liste (fiches d'événements, d'albums, de sondages, de questions…), sans les chercher dans le plan du site. */
export async function crawl(base, found, { perGroup = 3 } = {}) {
  const have = new Set(found.map((p) => p.path));
  const extra = [];
  for (const p of found.filter((x) => x.locale === LOCALES[0] && x.depth === 1 && x.bare !== "/privacy")) {
    let html = "";
    try { html = await (await fetch(base + p.path)).text(); } catch { continue; }
    const root = p.bare.split("/")[1];
    const links = [...new Set([...html.matchAll(/<a [^>]*href="(\/[^"#?]*)"/g)].map((m) => m[1].replace(/\/+$/, "")))]
      .filter((h) => h && !SKIP.test(h) && !have.has(h) && h.startsWith(`/${root}/`) && h.split("/").length === 3);
    for (const h of links.slice(0, perGroup)) { have.add(h); extra.push({ path: h, locale: LOCALES[0], bare: h, depth: 2, crawled: true }); }
  }
  return [...found, ...extra];
}
