// Test d'auteur : la suite de conformité du cœur, puis les tests propres à CE module.
//
// Lancer (depuis le dossier du cœur, ou avec CURIOSA_DIR=/chemin/vers/le/cœur) :
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test testsupport/template/my-module.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = process.env.CURIOSA_DIR ?? path.resolve(here, "../.."); // le dossier du cœur ; en dehors du cœur : CURIOSA_DIR
const { registerConformanceTests, fakeCtx, loadModuleDir } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

// 1) Tout module doit réussir ceci : une exigence = un test nommé. Les « obligatoires » font échouer le test ; les « conseils » s'affichent en remarque.
registerConformanceTests(here, { test });

// 2) Ce qui est propre à votre module : trois exemples à adapter.
const { definition: def } = await loadModuleDir(here);

test("la section affiche le message réglé, sans signature quand elle est vide", async () => {
  const ctx = fakeCtx({ settings: { message: "Coucou" } });
  assert.deepEqual(await def.sections.welcome(ctx), [{ type: "html", html: "<p>Coucou</p>" }]);
});

test("un texte hostile dans le message est échappé", async () => {
  const ctx = fakeCtx({ settings: { message: "<script>alert(1)</script>", signature: '"><img src=x>' } });
  const [block] = await def.sections.welcome(ctx);
  assert.ok(!block.html.includes("<script>") && !block.html.includes("<img"), block.html);
});

test("sans message réglé, le texte de repli traduit s'affiche", async () => {
  const ctx = fakeCtx({ settings: { message: "" }, messages: { fallback: "Bienvenue !" } });
  assert.match((await def.sections.welcome(ctx))[0].html, /Bienvenue/);
});
