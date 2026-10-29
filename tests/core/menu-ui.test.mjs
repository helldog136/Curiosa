import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Accessibilité et branchements du menu, vérifiés dans le code source (le rendu réel est vu au navigateur par ailleurs).
const read = (p) => fs.readFileSync(p, "utf8");
const nav = read("src/components/site/SiteNav.tsx");
const header = read("src/components/site/Header.tsx");
const editor = read("src/components/admin/NavEditor.tsx");
const picker = read("src/components/admin/NavPicker.tsx");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ─── En-tête public ───────────────────────────────────────────────────────────

test("en-tête : les sous-menus sont de vrais liens dans la page (repli sans JavaScript), jamais construits seulement à l'ouverture", () => {
  const code = noComments(nav);
  assert.match(code, /<ul id=\{subId\} data-sub=\{i\}/, "la liste du sous-menu est toujours dans le HTML");
  assert.ok(!/isOpen && \(\s*<ul/.test(code), "pas de rendu conditionnel de la liste");
  assert.match(code, /<a href=\{c\.href\}/);
  assert.match(code, /<noscript>[\s\S]*<style>[\s\S]*ul\[data-sub\][\s\S]*display:block/, "sans JavaScript, tout est visible");
  assert.match(code, /button\{display:none!important\}/, "sans JavaScript, les boutons inutiles disparaissent");
  assert.match(code, /ul\[data-nav-list\]\{display:flex!important/, "et le panneau mobile aussi est déplié");
});

test("en-tête : clavier — Entrée/Espace (vrai <button>), ↓ ouvre, ↑ ↓ Début Fin dans le sous-menu, Échap ferme et rend le focus, Tab hors du menu ferme", () => {
  assert.match(nav, /<button type="button" data-trigger=\{i\} aria-expanded=\{isOpen\}/, "bouton natif : Entrée et Espace marchent");
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) assert.ok(nav.includes(`"${key}"`), key);
  assert.match(nav, /trigger\(i\)\?\.focus\(\)/, "Échap rend le focus au bouton");
  assert.match(nav, /onBlur=\{\(e\) => \{ const to = e\.relatedTarget as Node \| null; if \(to && !e\.currentTarget\.contains\(to\)\) setOpen\(null\)/, "le focus qui sort du menu le ferme");
  assert.match(nav, /aria-controls=\{subId\}/);
  assert.match(nav, /aria-expanded=\{panel\}/, "le bouton « Menu » du panneau mobile dit son état");
});

test("en-tête : toucher — un premier toucher ouvre, un second suit le lien ; clavier et souris suivent toujours le lien", () => {
  assert.match(nav, /e\.detail > 0 && pointer\.current !== "mouse" && pointer\.current !== "" && !isOpen\) \{ e\.preventDefault\(\); setOpen\(i\)/);
  assert.match(nav, /onPointerDown=\{\(e\) => \{ pointer\.current = e\.pointerType; \}\}/);
  assert.match(read("src/app/globals.css"), /@media \(hover: hover\) \{\s*\[data-site-nav\] \[data-row\]:hover \[data-skin-part="submenu"\] \{ display: block; \}/, "la souris ouvre au survol, en CSS pur (feuille du cœur)");
});

test("en-tête : sans minuteur, mouvement réduit respecté, focus visible, cibles de 44 px, panneau sur petit écran", () => {
  const code = noComments(nav);
  for (const banned of ["setTimeout", "setInterval", "requestAnimationFrame", "dangerouslySetInnerHTML"]) assert.ok(!code.includes(banned), banned);
  assert.match(code, /motion-reduce:transition-none/);
  assert.match(code, /min-h-target/);
  const css = read("src/app/globals.css");
  assert.match(css, /@media \(width >= 40rem\) \{\s*\[data-site-nav\] \[data-skin-part="menu-toggle"\] \{ display: none; \}/, "bouton Menu seulement sur petit écran");
  assert.match(code, /data-open=\{panel \? "true" : "false"\}/);
  assert.match(css, /@media \(width < 40rem\) \{[^}]*\}\s*\[data-site-nav\] \[data-skin-part="nav-list"\]\[data-open="false"\] \{ display: none; \}/, "le panneau se replie sur petit écran, jamais sur grand écran");
  assert.match(read("src/app/globals.css"), /a:focus-visible,[\s\S]*button:focus-visible/, "le focus clavier est visible partout");
  assert.match(code, /document\.addEventListener\("pointerdown", away\)/);
  assert.match(code, /document\.removeEventListener\("pointerdown", away\)/, "l'écouteur est retiré");
});

test("en-tête : le menu vient du réglage composé par la personne ; plus aucune page ajoutée d'office par le cœur", () => {
  assert.match(header, /resolvePublicMenu\(locale, config\.defaultLocale\)/);
  assert.ok(!/showInNav|getActiveInstances|instanceHasNews/.test(header), "l'en-tête ne décide plus rien lui-même");
  assert.ok(!/config\.nav\b/.test(header), "l'ancien réglage nav.custom n'est plus lu qu'à la migration");
  assert.match(header, /<SiteNav items=\{items\}[^>]*aria|<SiteNav items=\{items\}/);
  const minimal = header.slice(header.indexOf('case "minimal"'));
  assert.match(minimal, /item\.href\s*\?\s*<a href=\{item\.href\}/, "le menu simple (panneau) montre aussi le parent comme lien");
  assert.match(minimal, /item\.children &&[\s\S]*<a href=\{c\.href\}/, "et ses sous-éléments comme liens ordinaires");
});

test("rendu public : les adresses sont revalidées à chaque affichage (jamais de lien dangereux), lectures bornées", () => {
  const src = read("src/core/menuResolve.ts");
  assert.match(src, /isSafeExternalUrl\(href\)/);
  assert.match(src, /safeHref\(path\)/);
  assert.match(src, /take: entryIds\.length/);
  assert.match(src, /take: redirectIds\.length/);
  assert.match(src, /status: "published", publishedAt: \{ lte: new Date\(\) \}/, "seule une entrée publiée apparaît");
  assert.match(src, /active: true/, "un raccourci désactivé disparaît");
});

// ─── Éditeur d'administration ─────────────────────────────────────────────────

test("éditeur : tout se fait au bouton (clavier et toucher) — monter, descendre, mettre dans, sortir, retirer ; le glisser-déposer n'est pas nécessaire", () => {
  for (const action of ["up", "down", "into", "out", "remove"]) assert.ok(editor.includes(`data-action="${action}"`), action);
  assert.ok(!/draggable|onDragStart|onDrop/.test(editor), "aucun glisser-déposer obligatoire");
  assert.ok((editor.match(/<button type="button"/g) ?? []).length >= 8, "des vrais boutons, jamais submit par accident");
  assert.ok(!/<button(?![^>]*type=)/.test(editor), "tous les boutons ont un type");
  assert.match(editor, /min-h-11/, "cibles de 44 px");
  assert.match(editor, /disabled=\{!m\.up\}/);
  assert.match(editor, /disabled=\{!m\.into\.ok\}/);
});

test("éditeur : chaque geste est annoncé aux lecteurs d'écran et le focus reste sur l'élément déplacé", () => {
  assert.match(editor, /role="status" aria-live="polite" className="sr-only"/);
  for (const k of ["moved", "movedInto", "movedOut", "added", "removed"]) assert.ok(editor.includes(`strings.${k}`), k);
  assert.match(editor, /focusReq\.current = \{ uid: uidToFocus, prefer \}/);
  assert.match(editor, /btn\.focus\(\)/);
});

test("éditeur : les plafonds sont montrés et appliqués (ajout désactivé au plafond, message en mots simples)", () => {
  assert.match(editor, /const full = totalOf\(tree\) >= Math\.min\(limits\.total, MENU_MAX_TOTAL\)/);
  assert.match(editor, /disabled=\{full\}/);
  assert.match(editor, /strings\.limits/);
  assert.match(read("src/app/admin/(panel)/navigation/page.tsx"), /limits=\{\{ total: MENU_MAX_TOTAL, children: MENU_MAX_CHILDREN \}\}/);
});

test("sélecteur « Ajouter au menu » : recherche tapée, résultats rangés par origine, « déjà dans le menu » marqué, pagination, focus conservé", () => {
  assert.match(picker, /type="search"/);
  assert.match(picker, /<label htmlFor=\{`\$\{base\}-q`\}/, "champ étiqueté");
  assert.match(picker, /aria-describedby=\{`\$\{base\}-help`\}/);
  assert.match(picker, /role="status" aria-live="polite"/, "résultats annoncés");
  assert.match(picker, /const GROUPS: CatalogGroup\[\] = \["system", "instance", "entry", "redirect"\]/);
  assert.match(picker, /aria-disabled=\{done \|\| full\}/, "déjà au menu : le bouton reste atteignable, le focus ne se perd pas");
  assert.match(picker, /strings\.inMenu/);
  assert.match(picker, /if \(mine !== seq\.current\) return/, "seule la dernière recherche compte");
  assert.match(picker, /strings\.more/);
  assert.match(picker, /e\.key === "Escape"/);
  assert.match(picker, /maxLength=\{80\}/);
  assert.match(picker, /clearTimeout\(pending\.current\)/, "le délai de frappe est annulé à la fermeture");
});

test("recherche côté serveur : réservée à l'administration, groupe validé, requête bornée, erreurs sans détail", () => {
  const src = read("src/app/admin/(panel)/navigation/searchActions.ts");
  assert.match(src, /adminCtx\("admin"\)/);
  assert.match(src, /isCatalogGroup\(group\)/);
  const cat = read("src/core/menuCatalog.ts");
  assert.match(cat, /slice\(0, MAX_QUERY\)/);
  assert.match(cat, /MAX_SCAN = 1500/);
  assert.match(cat, /take: BATCH/);
  assert.match(cat, /ID_RE\.test\(c\)/, "le repère de pagination est validé");
  assert.match(src, /catch \(error\)[\s\S]*error as Error\)\?\.name/, "seul le nom de l'erreur est journalisé");
});

test("instance : la case « Afficher dans le menu de mon site » ajoute / retire la page du menu (une seule source de vérité)", () => {
  const view = read("src/app/admin/(panel)/instances/[id]/InstanceView.tsx");
  const actions = read("src/app/admin/(panel)/instances/actions.ts");
  assert.match(view, /isInstanceInMenu\(instance\.id\)/);
  assert.match(view, /defaultChecked=\{inMenu\}/);
  assert.match(view, /name="nav_was"/);
  assert.match(actions, /setInstanceInMenu\(id, want\)/);
  assert.match(actions, /menuEligible\(mod\.manifest\)/);
  assert.ok(!/navOrder/.test(view) && !/navOrder/.test(actions), "l'ordre dans le menu n'est plus un réglage d'instance");
  assert.match(actions, /errors: \{ showInNav: t\("navigation\.totalFull"\) \}/, "menu plein : message sous la case");
});

test("migration : lancée au démarrage et avant toute création d'instance ; l'assistant de départ retient les suggestions", () => {
  assert.match(read("src/instrumentation.ts"), /ensureMenuMigrated\(\)/);
  assert.match(read("src/core/instanceService.ts"), /await ensureMenuMigrated\(db\);\s*\n\s*let basePath/);
  assert.match(read("src/app/admin/(auth)/setup/actions.ts"), /menu: "suggested"/);
  assert.ok(!/menu: "suggested"/.test(read("src/app/admin/(panel)/modules/actions.ts")), "installer un module n'ajoute rien au menu");
  assert.ok(!/menu: "suggested"/.test(read("src/core/modules/defaultInstance.ts")), "ni une instance créée par une dépendance");
});

// ─── Textes ───────────────────────────────────────────────────────────────────

test("textes : toutes les clés de l'éditeur existent en français et en anglais, avec les mêmes variables", () => {
  const page = read("src/app/admin/(panel)/navigation/page.tsx");
  const list = [...page.slice(page.indexOf("const STRINGS"), page.indexOf("] as const")).matchAll(/"([\w.]+)"/g)].map((m) => `navigation.${m[1]}`);
  assert.ok(list.length > 50);
  const extra = ["navigation.error.children", "navigation.error.total", "navigation.error.label", "menu.system.home", "menu.system.privacy", "site.nav.submenu", "instances.showInNavHelp", "instances.suggestsNav", "error.badLink"];
  for (const k of [...list, ...extra]) {
    assert.ok(fr[k], `fr : ${k}`);
    assert.ok(en[k], `en : ${k}`);
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    assert.equal(vars(fr[k]), vars(en[k]), `variables de ${k}`);
  }
  assert.ok(!("navigation.addPage" in fr) && !("instances.navOrder" in fr), "textes de l'ancien éditeur retirés");
});

test("textes : pas de jargon pour Emma dans l'éditeur (ni « instance », ni « slug », ni « manifeste »)", () => {
  for (const [k, v] of Object.entries(fr)) if (k.startsWith("navigation.") || k.startsWith("menu.system.")) assert.ok(!/instance|slug|manifest|JSON/i.test(v), `${k} : ${v}`);
});

test("documentation : le menu du site, ses plafonds, la migration et la suggestion d'un module sont documentés", () => {
  const platform = read("docs/PLATFORM.md");
  assert.match(platform, /## Menu du site : une fonctionnalité du cœur/);
  for (const w of ["nav.menu", "8 éléments par sous-menu, 40 au total", "ensureMenuMigrated", "suggestInMenu", "Pages qui ne sont pas dans le menu", "menuEligibility", "n'est \\*\\*pas\\*\\* exposé aux assistants"]) assert.match(platform, new RegExp(w), w);
  assert.match(read("docs/MODULES.md"), /\| `suggestInMenu` \|/);
  assert.match(read("docs/SECURITE.md"), /## Menu du site/);
  assert.match(read("CHANGELOG.md"), /## 0\.2\.6[\s\S]*### Améliorations[\s\S]*### Pour les développeurs[\s\S]*## 0\.2\.5/);
});
