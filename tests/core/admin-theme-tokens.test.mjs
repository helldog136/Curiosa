// Le contrat des jetons visuels de l'admin (docs/ideas/skins-admin.md) : noms figés, contrastes, CSS sûr pour les pages secrètes des modules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const T = await import("@/core/adminTheme");
const { contrast } = await import("@/core/color");

// Liste FIGÉE. Ajouter un jeton : l'ajouter ici ET dans adminTheme.ts. En retirer ou renommer un : interdit (des modules l'emploient).
const FROZEN = [
  "--cur-bg", "--cur-fg", "--cur-muted", "--cur-surface", "--cur-line", "--cur-accent", "--cur-accent-fg",
  "--cur-ok", "--cur-ok-fg", "--cur-warn", "--cur-warn-fg", "--cur-danger", "--cur-danger-fg", "--cur-focus",
  "--cur-radius", "--cur-radius-lg", "--cur-shadow", "--cur-space", "--cur-font",
  "--cur-line-strong", "--cur-accent-text", "--cur-accent-tint", "--cur-ok-text", "--cur-ok-soft", "--cur-warn-text", "--cur-warn-soft",
  "--cur-danger-text", "--cur-danger-soft", "--cur-neutral-text", "--cur-neutral-soft",
];

test("jetons de l'admin : noms stables (un nom retiré ou renommé = test rouge)", () => {
  for (const name of FROZEN) assert.ok(T.ADMIN_TOKENS.includes(name), `jeton retiré ou renommé : ${name}`);
  assert.deepEqual([...T.ADMIN_TOKENS].sort(), [...FROZEN].sort(), "un jeton ajouté doit l'être aussi à la liste figée de ce test");
  assert.ok(T.ADMIN_TOKENS.every((n) => /^--cur-[a-z0-9-]+$/.test(n)), "préfixe --cur- et minuscules");
  for (const scheme of ["light", "dark"]) {
    const v = T.adminTokens(scheme);
    assert.deepEqual(Object.keys(v).sort(), [...FROZEN].sort(), `${scheme} : chaque jeton a une valeur`);
    for (const [k, val] of Object.entries(v)) assert.ok(val && !/url\(|https?:|@import/i.test(val), `${scheme} ${k} : valeur sans adresse`);
  }
});

test("jetons de l'admin : contrastes WCAG AA, clair et sombre", () => {
  for (const scheme of ["light", "dark"]) {
    const t = T.adminTokens(scheme);
    for (const surface of [t["--cur-bg"], t["--cur-surface"]]) {
      for (const text of ["--cur-fg", "--cur-muted", "--cur-ok", "--cur-warn", "--cur-danger"])
        assert.ok(contrast(t[text], surface) >= 4.5, `${scheme} : ${text} sur ${surface} = ${contrast(t[text], surface).toFixed(2)} (4,5 attendu)`);
      for (const ui of ["--cur-accent", "--cur-focus"]) assert.ok(contrast(t[ui], surface) >= 3, `${scheme} : ${ui} sur ${surface} = ${contrast(t[ui], surface).toFixed(2)} (3 attendu)`);
    }
    for (const [fill, text] of [["--cur-accent", "--cur-accent-fg"], ["--cur-ok", "--cur-ok-fg"], ["--cur-warn", "--cur-warn-fg"], ["--cur-danger", "--cur-danger-fg"]])
      assert.ok(contrast(t[fill], t[text]) >= 4.5, `${scheme} : ${text} sur ${fill} = ${contrast(t[fill], t[text]).toFixed(2)}`);
  }
});

// Chaque paire (premier plan, fond) que l'admin peint avec ces jetons, et le seuil WCAG AA qu'elle doit tenir : 4,5:1 pour du texte, 3:1 pour une bordure de contrôle.
// Un jeton qu'on assombrit ou éclaircit à la légère fait rougir ce test avant de faire rougir l'audit d'accessibilité (F-A11Y-004).
const TEXT = 4.5, UI = 3;
const SURFACES = ["--cur-bg", "--cur-surface"];
const PAIRS = [
  ...SURFACES.map((bg) => ["--cur-muted", bg, TEXT]),
  ["--cur-muted", "--cur-neutral-soft", TEXT],
  ...[...SURFACES, "--cur-accent-tint"].map((bg) => ["--cur-accent-text", bg, TEXT]),
  ["--cur-ok-text", "--cur-ok-soft", TEXT],
  ["--cur-warn-text", "--cur-warn-soft", TEXT],
  ["--cur-danger-text", "--cur-danger-soft", TEXT],
  ["--cur-neutral-text", "--cur-neutral-soft", TEXT],
  ...SURFACES.map((bg) => ["--cur-line-strong", bg, UI]),
];

test("jetons de l'admin : paires texte/fond et bordures de contrôle tiennent AA, clair et sombre", () => {
  for (const scheme of ["light", "dark"]) {
    const t = T.adminTokens(scheme);
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= min, `${scheme} : ${fg} (${t[fg]}) sur ${bg} (${t[bg]}) = ${ratio.toFixed(2)} (${min} attendu)`);
    }
  }
});

test("jetons de l'admin : le texte secondaire reste lisible sur le fond survolé des listes (clair et sombre)", () => {
  // `--cur-hover` n'est pas un jeton : le survol des lignes mélange fond et filet ; on vérifie le pire cas, le filet à 60 % sur le fond.
  for (const scheme of ["light", "dark"]) {
    const t = T.adminTokens(scheme);
    const mix = (a, b, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * k + parseInt(b.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, "0")).join("");
    const hover = mix(t["--cur-line"], t["--cur-bg"], 0.6);
    assert.ok(contrast(t["--cur-muted"], hover) >= TEXT, `${scheme} : muted sur ${hover} = ${contrast(t["--cur-muted"], hover).toFixed(2)}`);
  }
});

test("jetons de l'admin : le CSS généré porte les nouveaux jetons dans les deux modes, et l'ancien --v-muted les lit", () => {
  const css = T.adminThemeCss();
  for (const n of ["--cur-line-strong", "--cur-accent-text", "--cur-ok-text", "--cur-danger-soft"]) assert.ok((css.match(new RegExp(`${n}:#`, "g")) ?? []).length >= 2, `${n} : clair et sombre`);
  assert.match(css, /--v-line-strong:var\(--cur-line-strong\)/);
  assert.match(css, /--v-muted:var\(--cur-muted\)/);
});

test("composants : champs, interrupteurs, pastilles et menu actif utilisent les jetons de contraste", () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  assert.match(read("src/components/admin/ui.ts"), /input: "[^"]*border-line-strong/);
  assert.match(read("src/components/admin/Switch.tsx"), /TRACK_OFF = "[^"]*border-line-strong/);
  assert.match(read("src/components/admin/NavLink.tsx"), /bg-accent-tint[^"]*text-accent-text/);
  const badge = read("src/components/admin/Badge.tsx");
  for (const tone of ["ok", "warn", "danger", "neutral"]) assert.match(badge, new RegExp(`${tone}: "bg-\\w+-soft text-\\w+-text"`), `pastille ${tone}`);
  assert.match(read("src/app/globals.css"), /--color-line-strong: var\(--v-line-strong, var\(--v-line\)\)/);
  assert.match(read("src/app/globals.css"), /data-admin-theme\] :is\(p[^{]*\) a:not\([^{]*\{ text-decoration: underline/);
});

test("CSS pour les modules : variables seulement, aucune adresse, aucune police, aucun import", () => {
  for (const scheme of ["light", "dark", "auto", undefined, "noir", 5]) {
    const { css, scheme: got, wordmark } = T.moduleAdminTheme({ scheme });
    assert.ok(["light", "dark", "auto"].includes(got));
    assert.ok(!/url\(|https?:|\/\/|@import|@font-face|<|\\|expression/i.test(css), `${scheme} : CSS sans adresse ni police`);
    const decls = [...css.replace(/@media \(prefers-color-scheme: dark\)\{/g, "").matchAll(/(?:^|[{;])\s*([a-z-]+):[^;}]*/g)].map((m) => m[1].trim());
    assert.ok(decls.length >= 14, "les déclarations sont bien lues");
    assert.ok(decls.every((d) => d.startsWith("--cur-") || d === "color-scheme"), `${scheme} : que des variables --cur-* (et color-scheme) : ${decls.filter((d) => !d.startsWith("--cur-"))}`);
    assert.ok(!/url\(|@import|@font-face/i.test(wordmark.css), "règle du nom sans adresse ni police chargée");
  }
  assert.equal(T.moduleAdminTheme({ scheme: "dark" }).scheme, "dark");
  assert.equal(T.moduleAdminTheme().scheme, "auto", "défaut : auto");
  assert.equal(T.moduleAdminTheme({ scheme: "noir" }).scheme, "auto", "valeur inconnue : auto");
  assert.match(T.moduleAdminTheme({ scheme: "dark" }).css, /^:root\{--cur-bg:#15141a;/);
  assert.match(T.moduleAdminTheme({ scheme: "light" }).css, /^:root\{--cur-bg:#faf7f2;/);
  const auto = T.moduleAdminTheme({ scheme: "auto" }).css;
  assert.match(auto, /^:root\{--cur-bg:#faf7f2;[^}]*color-scheme:light dark\}@media \(prefers-color-scheme: dark\)\{:root\{--cur-bg:#15141a;/);
  assert.equal(T.moduleAdminTheme({ scheme: "auto" }).css, auto, "même entrée, même sortie");
});

test("nom « Curiosa » pour un module : un lien verrouillé (repère, Fraunces italique 600), rien à réécrire", () => {
  const { wordmark } = T.moduleAdminTheme();
  assert.match(wordmark.html, /^<a class="cur-wordmark" data-curiosa-wordmark="" href="https:\/\/github\.com\/helldog136\/Curiosa" [^>]*rel="noopener">Curiosa<\/a>$/);
  assert.match(wordmark.css, /font-style:italic;font-weight:600/);
  assert.match(wordmark.css, /Fraunces/);
});

test("ctx.api.adminTheme : dans l'API des modules, le faux contexte et la documentation", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/core/modules/api.ts"), /adminTheme: \(opts\) => moduleAdminTheme\(opts\)/);
  assert.match(read("src/core/modules/types.ts"), /adminTheme\(opts\?: \{ scheme\?: "light" \| "dark" \| "auto" \}\): ModuleAdminTheme/);
  assert.match(read("testsupport/fakeCtx.mjs"), /adminTheme: \(o\) =>/);
  for (const f of ["docs/MODULES.md", "docs/CREATE-A-MODULE.md"]) assert.ok(read(f).includes("adminTheme"), `${f} documente adminTheme`);
  assert.match(read("docs/MODULES.md"), /Thème de l'admin pour vos pages secrètes/);
  assert.ok(read("docs/SKINS.md").includes("skins-admin.md"), "renvoi depuis SKINS.md");
  assert.ok(fs.existsSync("docs/ideas/skins-admin.md"));
});
