import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("src/components/admin/ActionForm.tsx", "utf8");

test("formulaires admin : après « Enregistrer », les champs gardent la valeur enregistrée (pas de remise à zéro automatique de React)", () => {
  assert.ok(!/<form[^>]*\baction=/.test(src), "pas de <form action> : React remettrait les champs à leur ancienne valeur");
  assert.match(src, /onSubmit=\{onSubmit\}/);
  assert.match(src, /e\.preventDefault\(\)/);
  assert.match(src, /startTransition\(\(\) => formAction\(data\)\)/);
  assert.match(src, /new FormData\(e\.currentTarget, submitter/, "le bouton qui a envoyé le formulaire est pris en compte");
});

test("formulaires admin : la confirmation reste demandée, les mots de passe sont vidés, seuls les formulaires de création se vident", () => {
  assert.match(src, /window\.confirm\(confirmMessage\)\) return/);
  assert.match(src, /input\[type=password\]/);
  assert.match(src, /if \(reset\) ref\.current\.reset\(\)/);
  for (const f of ["users/page.tsx", "redirects/page.tsx", "mcp/page.tsx"]) {
    const page = fs.readFileSync(`src/app/admin/(panel)/${f}`, "utf8");
    assert.match(page, /<ActionForm action=\{create\w+\}[^>]*\breset\b/, f);
  }
  for (const f of ["settings/page.tsx", "navigation/page.tsx", "home/page.tsx", "instances/[id]/page.tsx"])
    assert.ok(!/<ActionForm[^>]*\breset\b/.test(fs.readFileSync(`src/app/admin/(panel)/${f}`, "utf8")), `${f} : un formulaire de réglages ne se vide jamais`);
});

test("réglages : une page à onglets (site, langues, apparence, confidentialité, e-mail) au lieu d'une page interminable ; un seul formulaire, onglets mémorisés dans l'adresse", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  for (const id of ["site", "languages", "appearance", "privacy", "mail"]) assert.match(page, new RegExp(`data-tab="${id}"`));
  assert.match(page, /submitTabs="site languages appearance privacy"/, "pas de bouton « Enregistrer » sur l'onglet e-mail (autre formulaire)");
  const tabs = fs.readFileSync("src/components/admin/Tabs.tsx", "utf8");
  assert.match(tabs, /window\.location\.hash/);
  assert.match(tabs, /addEventListener\("invalid"/, "un champ obligatoire invalide dans un onglet caché fait basculer sur cet onglet");
  assert.match(tabs, /display:none/);
  assert.ok(!/hidden=\{/.test(tabs), "masquage par CSS : les champs masqués restent dans le formulaire");
});
