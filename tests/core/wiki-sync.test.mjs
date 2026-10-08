import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const W = await import("../../scripts/wiki-sync.mjs");
const REPO = "exemple/depot";

test("wiki : les liens entre documents deviennent des liens de pages ; les autres fichiers du dépôt pointent vers GitHub ; le reste est intact", () => {
  const md = "[a](MODULES.md) [b](MODULES.md#settings) [c](../modules-examples/guestbook) [d](../LICENSE) [e](https://x.test/y.md) [f](#ancre) [g](PRIVACY.md)";
  const out = W.rewriteLinks(md, "docs/CREATE-A-MODULE.md", REPO);
  assert.match(out, /\[a\]\(Référence-des-modules\)/);
  assert.match(out, /\[b\]\(Référence-des-modules#settings\)/);
  assert.match(out, /\[c\]\(https:\/\/github\.com\/exemple\/depot\/blob\/master\/modules-examples\/guestbook\)/);
  assert.match(out, /\[d\]\(https:\/\/github\.com\/exemple\/depot\/blob\/master\/LICENSE\)/);
  assert.match(out, /\[e\]\(https:\/\/x\.test\/y\.md\)/);
  assert.match(out, /\[f\]\(#ancre\)/);
  assert.match(out, /\[g\]\(Vie-privée-et-cookies\)/);
});

test("wiki : toutes les pages listées existent dans le dépôt ; chaque page porte le bandeau « reflet » ; accueil et barre latérale générés", () => {
  for (const p of W.PAGES) assert.ok(fs.existsSync(p.file), `${p.file} introuvable`);
  const wiki = W.buildWiki(REPO);
  for (const p of W.PAGES) assert.ok(wiki[`${p.page}.md`].startsWith("> 📌 Cette page est un **reflet**"), p.page);
  assert.ok(wiki["Home.md"].includes("[Créer un module](Créer-un-module)"));
  assert.ok(wiki["_Sidebar.md"].includes("](Installer)"));
  assert.equal(Object.keys(wiki).length, W.PAGES.length + 2);
});

test("wiki : aucun lien de page ne reste vers un fichier .md du dépôt ni vers un chemin relatif cassé", () => {
  const wiki = W.buildWiki(REPO);
  const names = new Set(Object.keys(wiki).map((n) => n.replace(/\.md$/, "")));
  for (const [file, text] of Object.entries(wiki)) {
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|#|mailto:)/.test(target)) continue;
      assert.ok(names.has(target.split("#")[0]), `${file} : lien relatif sans page du wiki → ${target}`);
    }
  }
});

test("wiki : le workflow ne casse rien si le wiki n'est pas initialisé, ne s'exécute que sur master, et le dépôt reste la source de vérité", () => {
  const wf = fs.readFileSync(".github/workflows/wiki.yml", "utf8");
  assert.match(wf, /branches: \[master, main\]/);
  assert.match(wf, /::notice::Le wiki n'est pas encore initialisé/);
  assert.match(wf, /if: steps\.wiki\.outputs\.ready == 'true'/);
  assert.match(wf, /\.wiki\.git/);
});

test("documentation du module : l'exemple du README est un vrai module (manifeste valide, code qui s'exécute)", async () => {
  const readme = fs.readFileSync("README.md", "utf8");
  const section = readme.slice(readme.indexOf("## Développer son propre module"), readme.indexOf("## Toute la documentation"));
  const manifest = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(section)[1]);
  const js = /```js\n([\s\S]*?)\n```/.exec(section)[1];
  const { parseManifest } = await import("@/core/modules/manifest");
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(r.manifest.permissions, ["slots"]);
  const def = (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).default;
  const { fakeCtx } = await import("../helpers/fakeCtx.mjs");
  assert.deepEqual(def.slots["layout.banner"](fakeCtx({ settings: { text: "Salut" } })), [{ type: "banner", text: "Salut" }]);
  for (const link of ["docs/CREATE-A-MODULE.md", "docs/MODULES.md", "modules-examples/guestbook", "catalogue/README.md"]) {
    assert.ok(section.includes(link), `la section doit renvoyer vers ${link}`);
    assert.ok(fs.existsSync(link), link);
  }
});
