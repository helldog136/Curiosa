import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk("src/components"), ...walk("src/app")];

// ── 1. Tableaux : le conteneur défilant contient ses enfants positionnés (texte pour lecteur d'écran, `sr-only` = position absolue) ──

test("tableaux : tout conteneur défilant d'un tableau est `relative` (sinon le texte sr-only des boutons de ligne agrandit la page sur téléphone)", () => {
  let tables = 0;
  for (const f of files) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      if (!/<table\b/.test(line)) return;
      tables++;
      // Le conteneur est la ligne d'avant (ou la même ligne) : il défile ET il est positionné.
      const box = /<div[^>]*overflow-x-auto/.test(line) ? line : lines[i - 1] ?? "";
      assert.match(box, /overflow-x-auto/, `${f}:${i + 1} : un tableau sans conteneur défilant déborde de l'écran`);
      assert.match(box, /\brelative\b/, `${f}:${i + 1} : conteneur défilant sans « relative »`);
    });
  }
  assert.ok(tables >= 3, "les tableaux de blocs de module, du journal et des redirections sont vérifiés");
});

test("tableaux : le bloc « table » des modules et le bouton de ligne sont bien ceux qui portent sr-only", () => {
  assert.match(read("src/components/site/Blocks.tsx"), /<div key=\{i\} className="relative overflow-x-auto">\s*<table/);
  assert.match(read("src/components/admin/PendingButton.tsx"), /sr-only/, "la cause : le bouton de ligne contient un texte sr-only (position: absolute)");
});

// ── 2. Texte conservé après une erreur ──

test("formulaires : aucun formulaire piloté par useActionState n'utilise <form action> (React 19 viderait les champs même après une erreur)", () => {
  for (const f of files) {
    const s = read(f);
    if (!/useActionState\(/.test(s)) continue;
    assert.ok(!/<form\b[^>]*\baction=\{(?!.*\.bind\()/.test(s), `${f} : <form action={…}> avec useActionState vide les champs après une erreur ; utiliser submitKeepingValues`);
  }
});

test("formulaires : les formulaires de module, de connexion, d'installation et de jeton envoient sans remise à zéro", () => {
  for (const f of ["src/components/admin/AdminBlocks.tsx", "src/components/admin/LoginForm.tsx", "src/components/admin/McpTokenCreator.tsx", "src/app/admin/(auth)/setup/SetupWizard.tsx"])
    assert.match(read(f), /onSubmit=\{submitKeepingValues\(/, f);
});

test("formulaires : submitKeepingValues empêche l'envoi natif, garde le bouton d'envoi et passe par une transition", () => {
  const s = read("src/components/admin/keepValues.ts");
  assert.match(s, /e\.preventDefault\(\)/);
  assert.match(s, /new FormData\(form, submitter/);
  assert.match(s, /startTransition\(\(\) => run\(data\)\)/);
});

test("formulaires : les mots de passe sont vidés après une erreur comme après un succès ; un formulaire de création se vide seulement après un succès", () => {
  const form = read("src/components/admin/ActionForm.tsx");
  assert.match(form, /if \(state\.ok && reset\) ref\.current\.reset\(\);\s*\n?\s*(\/\/[^\n]*\n\s*)?else clearSecrets\(ref\.current\)/);
  assert.match(read("src/components/admin/keepValues.ts"), /input\[type=password\]/);
  const blocks = read("src/components/admin/AdminBlocks.tsx");
  assert.match(blocks, /if \(!state\?\.ok \|\| !formRef\.current\) return;\s*\n\s*if \(block\.cancelHref\) clearSecrets\(formRef\.current\); else formRef\.current\.reset\(\)/, "vidé seulement après un succès");
  const login = read("src/components/admin/LoginForm.tsx");
  assert.match(login, /clearSecrets\(formRef\.current\)/);
});

// ── 3. Textes en dur ──

// Symboles, adresses (https://…), chemins (/contact) et mots seuls : identiques dans toutes les langues. Une phrase (plusieurs mots) ne l'est pas.
const NEUTRAL_RE = (lit) => /^\S+$/.test(lit) || !/\p{L}/u.test(lit.replace(/https?:\/\/\S*|\/[\w./~-]*/g, ""));
const ATTR = /\b(placeholder|aria-label|title|alt|aria-description|aria-placeholder)=(?:"([^"{}]*)"|\{([^{}]*)\})/g;

test("textes en dur : aucun placeholder / aria-label / title / alt en phrase dans l'interface (tout passe par les messages FR+EN)", () => {
  const bad = [];
  for (const f of files) {
    if (/^src\/app\/\(site\)\/\[/.test(f)) continue;
    const s = read(f);
    for (const m of s.matchAll(ATTR)) {
      const literals = m[2] !== undefined ? [m[2]] : [...m[3].matchAll(/(?<![\w$])"([^"]*)"/g)].map((x) => x[1]);
      for (const lit of literals) {
        if (!lit || /^[\s•…\-–—/:.·]*$/.test(lit) || NEUTRAL_RE(lit)) continue;
        bad.push(`${f} : ${m[1]}="${lit}"`);
      }
    }
  }
  assert.deepEqual(bad, [], "ces textes doivent passer par t(...) ou par un libellé fourni par la page");
});

test("textes en dur : le champ image traduit son exemple d'adresse (français ET anglais)", () => {
  assert.ok(!/ou \/uploads/.test(read("src/components/admin/ImageField.tsx")));
  assert.match(read("src/components/admin/ImageField.tsx"), /c\("urlPlaceholder"\)/);
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  assert.match(fr["crop.urlPlaceholder"], / ou /);
  assert.match(en["crop.urlPlaceholder"], / or /);
  for (const k of ["nav.adminLabel", "audit.pagination", "site.nav.main", "site.nav.language"]) {
    assert.ok(fr[k] && en[k], k);
  }
});
