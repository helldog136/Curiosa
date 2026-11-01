// Contrôle du contenu — l'écran « Santé de mon site », les textes (FR + EN) et les droits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const PANEL = "src/app/admin/(panel)/maintenance/content";
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { describeGroup, notCheckedList, verdictOf } = await import("@/core/maintenance/content/view");

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const GROUP_IDS = [...new Set([...read("src/core/maintenance/content/scan.ts").matchAll(/groups\.add\("(\w+)"/g)].map((m) => m[1]))];
const LINK_IDS = ["link_gone", "img_gone", "link_down", "link_loop", "link_blocked", "link_moved", "link_insecure", "link_unverified"];
const ALL_IDS = [...GROUP_IDS, ...LINK_IDS];

test("chaque remarque a sa phrase (avec variante au singulier si elle compte) et son « pourquoi », en français et en anglais, avec les mêmes variables", () => {
  assert.ok(GROUP_IDS.length >= 14, GROUP_IDS.join());
  for (const id of ALL_IDS) {
    for (const k of [`content.g.${id}`, `content.why.${id}`]) for (const d of [fr, en]) assert.ok(d[k], `clé manquante ${k}`);
    for (const d of [fr, en]) {
      if (/\{n\}/.test(d[`content.g.${id}`])) assert.ok(d[`content.g.${id}.one`], `${id} : variante au singulier`);
      assert.equal(vars(d[`content.g.${id}`]), vars(d[`content.g.${id}.one`] ?? d[`content.g.${id}`]).replace(/^$/, ""), id);
    }
    assert.equal(vars(fr[`content.g.${id}`]), vars(en[`content.g.${id}`]), id);
  }
});

test("toutes les clés `content.*` : mêmes clés en FR et EN, mêmes variables, aucun « (s) », aucun texte vide", () => {
  const frKeys = Object.keys(fr).filter((k) => k.startsWith("content.")), enKeys = Object.keys(en).filter((k) => k.startsWith("content."));
  assert.deepEqual(frKeys, enKeys);
  assert.ok(frKeys.length > 100);
  for (const k of frKeys) {
    assert.ok(fr[k].trim() && en[k].trim(), k);
    assert.equal(vars(fr[k]), vars(en[k]), k);
    assert.ok(!/\w\((s|es)\)/.test(fr[k] + en[k]), k);
  }
});

test("les textes cités par la page, l'action et le bouton existent partout", () => {
  const keys = new Set();
  for (const f of [`${PANEL}/page.tsx`, `${PANEL}/actions.ts`, "src/app/admin/(panel)/page.tsx", "src/app/admin/(panel)/layout.tsx"]) for (const m of read(f).matchAll(/\bt\(\s*"([\w.]+)"/g)) if (/^(content|dashboard\.content|nav\.health)/.test(m[1])) keys.add(m[1]);
  for (const s of ["important", "advised", "info"]) { keys.add(`content.sev.${s}`); keys.add(`content.sev.${s}.help`); }
  assert.ok(keys.size > 25, [...keys].join());
  for (const k of keys) { assert.ok(fr[k], `fr ${k}`); assert.ok(en[k], `en ${k}`); }
  for (const k of ["nav.health", "dashboard.contentLook", "dashboard.contentOpen", "audit.action.content.check", "aim.action.content_check_run", "aim.tool.content_check", "aim.tool.content_check_run", "progress.step.links"]) {
    assert.ok(fr[k] && en[k], k);
  }
});

test("chaque remarque se lit en phrases complètes dans les deux langues : aucune clé brute ni variable laissée à l'écran, ligne par ligne", () => {
  const samples = {
    alt: [{ k: "a", t: "Ma page", w: "Pages", d: ["imgs", 3] }], title_empty: [{ k: "a", t: "", w: "Blog" }], title_dup: [{ k: "a", t: "Titre", w: "Blog", d: ["dup", 2] }], summary: [{ k: "a", t: "Titre", w: "Blog" }],
    translation_missing: [{ k: "a", t: "Titre", w: "Blog", d: ["fallback", "fr"] }, { k: "b", t: "Titre", w: "Blog", d: ["hidden", "fr, nl"] }], translation_same: [{ k: "a", t: "Titre", w: "Blog", d: ["same", "fr, en"] }],
    internal: [{ k: "a", t: "Page", w: "Blog", d: ["path", "/blog/x", "texte"] }], menu_broken: [{ k: "a", t: "Menu", w: "menu", d: ["path", "/x"] }], menu_empty: [{ k: "a", t: "" }],
    upload_missing: [{ k: "a", t: "Page", w: "Blog", d: ["file", "x.png"] }], expired_linked: [{ k: "a", t: "Page", w: "Blog", d: ["path", "/blog/x", "t"] }], home: [{ k: "a", t: "" }], contact: [{ k: "a", t: "" }],
    empty: [{ k: "a", t: "" }], site_http: [{ k: "a", t: "http://x.example.org" }], cover_alone: [{ k: "a", t: "", w: "Blog" }],
    link_gone: [{ k: "a", t: "Lien", u: "https://x.example.org/a", w: "Page", d: ["gone", 404, "", ""] }], img_gone: [{ k: "a", t: "Image", u: "https://x.example.org/a.png", d: ["gone", 410, "", ""] }],
    link_down: [{ k: "a", t: "L", u: "https://x.example.org/", d: ["down", "", "dns", ""] }, { k: "b", t: "L", d: ["down", 503, "server", ""] }, { k: "c", t: "L", d: ["down", "", "timeout", ""] }, { k: "d", t: "L", d: ["down", "", "", ""] }],
    link_loop: [{ k: "a", t: "L", d: ["loop", "", "", ""] }], link_blocked: [{ k: "a", t: "L", d: ["blocked", 403, "", ""] }], link_moved: [{ k: "a", t: "L", d: ["moved", "", "", "https://nouveau.example.org/p"] }],
    link_insecure: [{ k: "a", t: "L", d: ["ok", "", "", ""] }],
    link_unverified: ["rate", "perhost", "ignored", "private", "redirect_private", "dns", "insecure", "circuit", "busy", "port", ""].map((w, i) => ({ k: `u${i}`, t: "L", d: ["unverified", "", w, ""] })),
  };
  for (const id of ALL_IDS) assert.ok(samples[id], `exemple manquant pour ${id}`);
  for (const lang of ["fr", "en"]) {
    const t = makeTranslator(lang);
    for (const id of ALL_IDS) {
      for (const count of [1, 5]) {
        const v = describeGroup({ id, loc: id.includes("link") || ["home", "contact", "empty", "menu_empty", "menu_broken", "site_http"].includes(id) ? null : "en", sev: "advised", count, total: count + 2, items: samples[id] }, t, "fr");
        for (const text of [v.sentence, v.why, ...v.items.flatMap((i) => [i.title, i.where, i.detail])]) {
          assert.ok(!/content\.|\{\w+\}|undefined|NaN|\[object/.test(text), `${lang} ${id} : « ${text} »`);
        }
        assert.ok(v.sentence.length > 8 && v.why.length > 20, `${lang} ${id}`);
        if (id !== "link_unverified") for (const it of v.items) assert.ok(it.title, `${lang} ${id} : titre de ligne`);
      }
      const v = describeGroup({ id, loc: null, sev: "info", count: 1, items: samples[id] }, t, "fr");
      assert.ok(v.items.length > 0 && v.items.every((i) => i.title), `${lang} ${id}`);
    }
  }
  // Le singulier et le pluriel se distinguent.
  const t = makeTranslator("fr");
  assert.match(describeGroup({ id: "summary", loc: "fr", sev: "advised", count: 1, items: [] }, t, "fr").sentence, /^1 page n'a pas/);
  assert.match(describeGroup({ id: "summary", loc: "fr", sev: "advised", count: 3, items: [] }, t, "fr").sentence, /^3 pages n'ont pas/);
  assert.match(describeGroup({ id: "translation_missing", loc: "en", sev: "advised", count: 2, items: [] }, t, "fr").sentence, /\(English\)$/, "la langue concernée est dite");
});

test("pas de note chiffrée : le verdict est un mot ; seules les remarques « important / conseillé » changent le résumé", () => {
  assert.equal(verdictOf(null), "none");
  assert.equal(verdictOf({ important: 0, advised: 0, info: 0 }), "good");
  assert.equal(verdictOf({ important: 0, advised: 0, info: 9 }), "good", "pour info seulement : tout va bien");
  assert.equal(verdictOf({ important: 0, advised: 1, info: 0 }), "look");
  assert.equal(verdictOf({ important: 2, advised: 0, info: 0 }), "look");
  for (const k of ["content.verdict.good", "content.verdict.look", "content.verdict.none", "content.verdict.goodHelp", "content.verdict.lookHelp"]) for (const d of [fr, en]) assert.ok(!/\d+\s*(\/|%)|score|note\b|grade/i.test(d[k]), `${k} : ${d[k]}`);
  assert.equal(fr["content.verdict.good"], "Tout va bien.");
  assert.equal(fr["content.verdict.look"], "Quelques petites choses à regarder.");
});

test("« Ce que je n'ai pas pu regarder » : toujours les limites permanentes ; les limites de cette fois quand elles s'appliquent", () => {
  const base = { cid: "c", at: "x", finished: true, stats: {}, linkTotals: { found: 10, from: 0, count: 10, window: false }, notes: { capped: false, unreadable: [], skipped: { host: 0, ignored: 0 }, modulePages: false, multi: false }, locales: ["fr"], linksOff: false, groups: [], progress: null };
  assert.deepEqual(notCheckedList(null, { linksOn: true }), []);
  const keys = (r, o = { linksOn: true }) => notCheckedList(r, o).map((n) => n.key);
  assert.deepEqual(keys(base), ["private", "behindLogin"]);
  const heavy = { ...base, linksOff: true, notes: { capped: true, unreadable: ["x"], skipped: { host: 3, ignored: 2 }, modulePages: true, multi: true }, linkTotals: { found: 300, from: 0, count: 200, window: true } };
  assert.deepEqual(keys(heavy), ["linksOff", "capped", "unreadable", "modulePages", "window", "perhost", "skipHosts", "private", "behindLogin"]);
  for (const n of notCheckedList(heavy, { linksOn: true })) for (const lang of ["fr", "en"]) assert.ok(!/content\.nc|\{\w+\}/.test(makeTranslator(lang)(`content.nc.${n.key}`, n.vars)), `${lang} ${n.key}`);
});

test("la page : résumé, pastilles, remarques groupées avec « Corriger » et « Ignorer », « Tout réafficher », historique, « Ce que je n'ai pas pu regarder », réglages — dans l'ordre", () => {
  const page = read(`${PANEL}/page.tsx`);
  const order = ["content-verdict", "content-chips", "content-run", "content-section-", "content-ignored", "content-not-checked", "content-history", "content-settings"].map((id) => page.indexOf(id));
  assert.ok(order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])), order.join());
  for (const needle of ["content.fix", "content.ignore", "content.showAll", "describeGroup", "ContentCheckButton", "notCheckedList", "visibleGroups", "readHistory"]) assert.ok(page.includes(needle), needle);
  assert.match(page, /adminCtx\("admin"\)/);
  assert.ok(!/(placeholder|aria-label|title|alt)="[A-Za-zÀ-ÿ]/.test(page), "aucun texte en dur dans les attributs");
  // Cibles de 44 px au moins pour « Corriger » et « Ignorer » ; rien qui force un défilement horizontal.
  assert.match(page, /ui\.btn\} min-h-11/);
  assert.match(page, /variant="link"/);
  assert.ok(!/whitespace-nowrap|overflow-x-scroll|min-w-\[\d{3,}/.test(page));
  assert.match(page, /break-words/);
});

test("le bouton « Vérifier maintenant » : barre de progression du cœur, enchaînement borné, rien en arrière-plan", () => {
  const b = read("src/components/admin/ContentCheckButton.tsx");
  assert.match(b, /OperationProgress/);
  assert.match(b, /useTrackedRun/);
  assert.match(b, /unitTemplate/);
  assert.match(b, /MAX_BATCHES = \d+/);
  assert.match(b, /disabled=\{busy\}/);
  assert.match(b, /role="status"/);
  assert.ok(!/setInterval|setTimeout/.test(b), "aucun minuteur : seul le clic lance, la boucle s'arrête avec la page");
});

test("droits : la page et CHAQUE action sont réservées aux administrateurs ; l'action de vérification est suivie par le cœur ; rien n'est planifié", () => {
  const actions = read(`${PANEL}/actions.ts`);
  const fns = [...actions.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)];
  assert.equal(fns.length, 4, fns.map((f) => f[1]).join());
  for (const [, name, first] of fns) assert.match(first, /adminCtx\("admin"\)/, `${name} vérifie le droit en premier`);
  assert.match(actions, /trackOperation\(user, \{ kind: "content-check"/);
  assert.match(actions, /audit\(user\.email, "content\.check"/);
  assert.ok(read("src/core/operations/tracker.ts").includes('"content-check": ["links"]'), "étape annoncée au suivi d'opérations");
  for (const d of [fr, en]) assert.ok(d["progress.step.links"]);
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.match(layout, /health: <NavLink key="health" href="\/admin\/maintenance\/content">/);
});

test("tableau de bord : une ligne sobre (ton « info »), seulement pour les administrateurs, jamais d'alarme", () => {
  const page = read("src/app/admin/(panel)/page.tsx");
  assert.match(page, /contentLook = hasRole\(user, "admin"\)/);
  const block = page.slice(page.indexOf("{contentLook &&"), page.indexOf("{(todo.length"));
  assert.match(block, /tone="info"/);
  assert.ok(!/warn|danger/.test(block));
  assert.match(block, /\/admin\/maintenance\/content/);
});
