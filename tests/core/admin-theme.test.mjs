import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const T = await import("@/core/adminTheme");

test("thème de l'admin : auto par défaut, valeurs inconnues ramenées à auto", () => {
  assert.deepEqual([...T.ADMIN_THEMES], ["auto", "light", "dark"]);
  for (const bad of [undefined, "", "noir", "DARK", null, 5]) assert.equal(T.parseAdminTheme(bad), "auto");
  for (const ok of ["auto", "light", "dark"]) assert.equal(T.parseAdminTheme(ok), ok);
});

test("thème de l'admin : clair par défaut ; sombre si choisi ; « auto » ne devient sombre que si le système l'est", () => {
  const css = T.adminThemeCss();
  // Les jetons `--cur-*` portent les valeurs (src/core/adminTheme.ts) ; `--v-*` (Tailwind) les lit.
  assert.match(css, /^:root\{--cur-bg:#faf7f2;/, "jetons clairs sur :root");
  assert.match(css, /:root\[data-admin-theme="dark"\]\{--cur-bg:#15141a;[^}]*color-scheme:dark\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root\[data-admin-theme="auto"\]\{--cur-bg:#15141a;/);
  for (const [v, cur] of [["bg", "bg"], ["fg", "fg"], ["surface", "surface"], ["line", "line"], ["muted", "muted"], ["accent", "accent"], ["accent-fg", "accent-fg"], ["success", "ok"], ["warning", "warn"], ["danger", "danger"], ["font", "font"]])
    assert.equal(css.split(`--v-${v}:var(--cur-${cur})`).length, 4, `--v-${v} lit --cur-${cur} (clair, sombre, auto)`);
  assert.ok(!/:root\[data-admin-theme="light"\]/.test(css), "« clair » = les variables par défaut");
});

test("thème de l'admin : chaque couleur d'état (erreur, succès, alerte) est éclaircie sur fond sombre — chaque sélecteur est préfixé par le thème", () => {
  const css = T.adminThemeCss();
  for (const scope of [':root[data-admin-theme="dark"]', ':root[data-admin-theme="auto"]']) {
    for (const cls of ["text-red-700", "text-red-600", "text-red-500", "text-emerald-700", "text-emerald-800", "text-emerald-900", "text-amber-700", "text-amber-900"])
      assert.ok(css.includes(`${scope} .${cls}`), `${scope} .${cls}`);
  }
  // aucune règle de classe « nue » hors du thème sombre (elle s'appliquerait aussi en clair)
  assert.ok(!/(^|\})\.text-(red|emerald|amber)/.test(css), css);
});

test("thème de l'admin : cookie, action, sélecteur dans le menu, attribut sur <html>", () => {
  assert.equal(T.ADMIN_THEME_COOKIE, "curiosa_admin_theme");
  const layout = fs.readFileSync("src/app/admin/layout.tsx", "utf8");
  assert.match(layout, /data-admin-theme=\{theme\}/);
  assert.match(layout, /<style dangerouslySetInnerHTML=\{\{ __html: CSS \}\} \/>/);
  const actions = fs.readFileSync("src/app/admin/(panel)/mode/actions.ts", "utf8");
  assert.match(actions, /export async function setAdminTheme/);
  assert.match(actions, /parseAdminTheme\(theme\)/, "valeur validée avant d'être écrite dans le cookie");
  // The selector moved from the sidebar footer to the Preferences of My account (tests/core/account-preferences.test.mjs).
  assert.match(fs.readFileSync("src/components/admin/AdminPreferences.tsx", "utf8"), /ADMIN_THEMES\.map/);
});
