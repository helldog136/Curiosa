import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const H = await import("@/core/homeBlocks");
const IMG = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png";
const LOC = ["fr", "en"];

test("blocs du cœur : cinq types ; une valeur inconnue ou invalide est ramenée à une valeur sûre, jamais acceptée", () => {
  assert.deepEqual([...H.BLOCK_KINDS], ["media", "tabs", "stats", "cta", "video"]);
  const d = H.normalizeBlockDef({
    kind: "n'importe quoi", tone: "x", imageSide: "haut", images: [IMG, "javascript:alert(1)", "http://x.test/a.png", "https://x.test/a.png", IMG, IMG],
    buttonUrl: "javascript:alert(1)", video: "https://evil.test/v.mp4", poster: "data:image/png;base64,AAAA",
    bg: { src: IMG, size: "100px; x:y", position: "50% 50%", veil: "rouge" }, videoSound: "oui",
  }, LOC);
  assert.equal(d.kind, "media");
  assert.equal(d.tone, "plain");
  assert.equal(d.imageSide, "right");
  assert.deepEqual(d.images, [IMG, "https://x.test/a.png", IMG], "images valables seulement, 3 au plus");
  assert.equal(d.buttonUrl, "");
  assert.equal(d.video, "", "vidéo : fichier du site seulement");
  assert.equal(d.poster, "");
  assert.deepEqual(d.bg, { src: IMG, size: "cover", position: "center", veil: "none" }, "listes fermées : aucun CSS libre");
  assert.equal(d.videoSound, false);
  assert.equal(H.normalizeBlockDef(null, LOC).kind, "media");
  assert.equal(H.normalizeBlockDef({ bg: { src: 'x"); evil' } }, LOC).bg, null);
});

test("blocs du cœur : textes par langue du site seulement, bornés, nettoyés ; éléments sans titre ignorés ; 24 au plus", () => {
  const d = H.normalizeBlockDef({
    kind: "tabs", title: { fr: "  Bonjour \n tous ", en: "", de: "Hallo" }, eyebrow: { fr: "x".repeat(500) },
    items: [{ title: { fr: "Événements" }, heading: { fr: "Titre" }, text: { fr: "Un **texte**" }, image: IMG }, { title: {}, text: { fr: "sans titre" } }, ...Array.from({ length: 40 }, (_, i) => ({ title: { fr: "t" + i } }))],
  }, LOC);
  assert.deepEqual(d.title, { fr: "Bonjour tous" }, "espaces normalisés, langue inconnue (de) et texte vide ignorés");
  assert.equal(d.eyebrow.fr.length, 120);
  assert.equal(d.items.length, 24);
  assert.equal(d.items[0].image, IMG);
  assert.ok(!d.items.some((i) => i.text.fr === "sans titre"));
});

test("blocs du cœur : rendu — le texte de la langue, sinon celle par défaut ; bouton seulement avec texte ET lien ; bloc vide = rien", () => {
  const d = H.normalizeBlockDef({ kind: "cta", title: { fr: "Rejoignez-nous", en: "Join us" }, buttonLabel: { fr: "Go" }, buttonUrl: "/contact" }, LOC);
  const [fr] = H.blockToBlocks(d, "fr", "fr");
  assert.equal(fr.type, "panel");
  assert.equal(fr.title, "Rejoignez-nous");
  assert.deepEqual(fr.button, { label: "Go", href: "/contact" });
  const [en] = H.blockToBlocks(d, "en", "fr");
  assert.equal(en.title, "Join us");
  assert.equal(en.button.label, "Go", "libellé absent en anglais : repli sur la langue par défaut");
  assert.equal(H.blockToBlocks(H.normalizeBlockDef({ kind: "cta", title: { fr: "x" }, buttonUrl: "/c" }, LOC), "fr", "fr")[0].button, undefined, "sans libellé, pas de bouton");
  assert.deepEqual(H.blockToBlocks(H.emptyBlock("media"), "fr", "fr"), []);
  assert.deepEqual(H.blockToBlocks(H.emptyBlock("tabs"), "fr", "fr"), []);
  const U = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.webm";
  const [v] = H.blockToBlocks(H.normalizeBlockDef({ kind: "video", video: U, videoSound: true, title: { fr: "T" } }, LOC), "fr", "fr");
  assert.equal(v.video, U);
  assert.equal(v.videoSound, true);
});

test("blocs du cœur : créés dans Page d'accueil (sans module), enregistrés après relecture, rendus par le cœur", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  const actions = read("src/app/admin/(panel)/home/actions.ts");
  assert.match(actions, /instanceKey === CORE_INSTANCE/);
  assert.match(actions, /normalizeBlockDef\(\{ \.\.\.\(raw as object\), kind: sectionId \}, config\.locales\)/, "la définition du navigateur est relue, le type vient de la liste");
  assert.match(read("src/core/modules/runtime.ts"), /instanceKey === CORE_INSTANCE[\s\S]*blockToBlocks\(normalizeBlockDef\(options\.block/);
  const page = read("src/app/admin/(panel)/home/page.tsx");
  assert.match(page, /core: kind/);
  assert.match(read("src/components/admin/HomeBuilder.tsx"), /data-testid=\{`add-\$\{c\.core\}`\}/);
  assert.ok(!fs.existsSync("src/modules-builtin/blocks"), "plus de module « Blocs de page »");
});

test("blocs du cœur : plusieurs blocs du même type se distinguent dans l'éditeur par leur propre titre", () => {
  const builder = fs.readFileSync("src/components/admin/HomeBuilder.tsx", "utf8");
  assert.match(builder, /c\.core \? \(Object\.values\(\(\(b\.options\.block as BlockDef \| undefined\)\?\.title \?\? \{\}\)\)\.find\(Boolean\) \|\| c\.subtitle\)/);
});
