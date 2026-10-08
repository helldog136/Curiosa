import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertValidManifest } from "../helpers/builtinChecks.mjs";
import { fakeCtx } from "../helpers/fakeCtx.mjs";

const blocks = await import("@/modules-builtin/blocks");
const { sectionsOf } = await import("@/core/modules/registry");
const IMG = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png";

test("blocs de page : manifeste valide, sans page publique ni section « dernières entrées »", async () => {
  const m = await assertValidManifest(blocks.manifest);
  assert.equal(m.page, false);
  assert.deepEqual(sectionsOf(m).map((s) => s.id), ["block"]);
  assert.equal(m.instances, "multiple");
});

test("blocs de page : texte et images — champs recopiés, images filtrées (fichier du site ou https), lien de bouton vérifié", async () => {
  const ctx = fakeCtx({ settings: { kind: "media", title: "T", eyebrow: "E", text: "Salut **toi**", buttonLabel: "Go", buttonUrl: "/contact", image1: IMG, image2: "javascript:alert(1)", image3: "https://x.example/a.jpg", imageSide: "left", tone: "surface" } });
  const [b] = await blocks.definition.sections.block(ctx);
  assert.equal(b.type, "panel");
  assert.equal(b.kind, "media");
  assert.deepEqual(b.images, [IMG, "https://x.example/a.jpg"]);
  assert.deepEqual(b.button, { label: "Go", href: "/contact" });
  assert.equal(b.imageSide, "left");
  assert.equal(b.tone, "surface");
  assert.equal(b.items, undefined);
  const [bad] = await blocks.definition.sections.block(fakeCtx({ settings: { buttonLabel: "Go", buttonUrl: "javascript:alert(1)", kind: "n'importe quoi", tone: "x" } }));
  assert.equal(bad.button, undefined);
  assert.equal(bad.kind, "media", "type inconnu → texte et images");
  assert.equal(bad.tone, "plain");
});

test("blocs de page : onglets et chiffres — lus dans les entrées du bloc (titre, résumé, contenu, image)", async () => {
  const entries = [{ title: "Événements", summary: "Mémorables", body: "Le **texte**", cover: IMG }, { title: "Rabais", summary: "", body: "", cover: null }];
  const ctx = fakeCtx({ settings: { kind: "tabs" }, entries });
  const [b] = await blocks.definition.sections.block(ctx);
  assert.deepEqual(b.items, [{ title: "Événements", heading: "Mémorables", text: "Le **texte**", image: IMG }, { title: "Rabais", heading: undefined, text: undefined, image: undefined }]);
  const [s] = await blocks.definition.sections.block(fakeCtx({ settings: { kind: "stats" }, entries }));
  assert.equal(s.items.length, 2);
});

test("blocs de page : image de fond — validée, position/taille/voile dans des listes fermées (aucun CSS libre)", async () => {
  const [b] = await blocks.definition.sections.block(fakeCtx({ settings: { bgImage: IMG, bgSize: "contain", bgPosition: "top-right", bgVeil: "dark" } }));
  assert.deepEqual(b.bg, { src: IMG, size: "contain", position: "top-right", veil: "dark" });
  const [c] = await blocks.definition.sections.block(fakeCtx({ settings: { bgImage: IMG, bgSize: "100px; x:y", bgVeil: "red" } }));
  assert.equal(c.bg.size, "cover");
  assert.equal(c.bg.veil, "none");
  const [none] = await blocks.definition.sections.block(fakeCtx({ settings: { bgImage: 'x"); background:url(evil' } }));
  assert.equal(none.bg, undefined);
});

test("blocs de page : vidéo seulement si c'est un fichier envoyé sur le site", async () => {
  const U = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.webm";
  const [v] = await blocks.definition.sections.block(fakeCtx({ settings: { kind: "video", video: U, videoSound: true } }));
  assert.equal(v.video, U);
  assert.equal(v.videoSound, true);
  const [e] = await blocks.definition.sections.block(fakeCtx({ settings: { kind: "video", video: "https://evil.example/x.mp4" } }));
  assert.equal(e.video, undefined);
});

test("blocs de page : rendu — les URL d'image sont revérifiées, les onglets sont accessibles au clavier", () => {
  const panel = fs.readFileSync("src/components/site/Panel.tsx", "utf8");
  assert.match(panel, /export const safeImage/);
  assert.match(panel, /safeHref\(button\.href\)/);
  const tabs = fs.readFileSync("src/components/site/PanelTabs.tsx", "utf8");
  for (const k of ["role=\"tablist\"", "role=\"tab\"", "role=\"tabpanel\"", "ArrowDown", "aria-selected"]) assert.ok(tabs.includes(k), k);
});
