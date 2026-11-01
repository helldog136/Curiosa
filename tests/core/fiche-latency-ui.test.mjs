// Ouverture d'une fiche d'extension : ce que la personne voit entre le clic et la fiche (R23). Rendu des pièces (HTML) et branchements de la page ;
// l'enchaînement réel (clic, fenêtre, fiche qui arrive) se mesure au navigateur (voir la PR).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const read = (p) => fs.readFileSync(p, "utf8");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const fr = makeTranslator("fr");
const { FicheSkeleton, GallerySkeleton } = await import("@/components/admin/FicheSkeleton");
const { createClickGuard } = await import("@/components/admin/clickGuard");
const { PROGRESS_LABEL_KEYS } = await import("@/components/admin/progressLabelKeys");

test("squelette : le nom et la description déjà connus sont là, avec une phrase d'attente annoncée au lecteur d'écran", () => {
  const html = renderToStaticMarkup(h(FicheSkeleton, { text: fr("fiche.loading"), embedded: true, back: "Retour", name: "Réseaux sociaux", icon: "🔗", description: "Une phrase." }));
  assert.match(html, /data-testid="fiche-loading"/);
  assert.match(html, /role="status"/);
  assert.match(html, /Réseaux sociaux/);
  assert.match(html, /Une phrase\./);
  assert.match(html, /Lecture de la fiche en cours/);
  assert.doesNotMatch(html, /href=/, "dans la fenêtre : pas de lien de retour");
  assert.match(renderToStaticMarkup(h(FicheSkeleton, { text: "x", embedded: false, back: "Retour au catalogue" })), /Retour au catalogue/);
  assert.match(renderToStaticMarkup(h(GallerySkeleton, { label: "Chargement", count: 5 })), /data-testid="gallery-loading"/);
});

test("double clic : le premier clic ouvre, les suivants sont ignorés tant que la fiche n'est pas là", () => {
  const g = createClickGuard();
  assert.deepEqual([g.begin(), g.begin(), g.begin()], [true, false, false]);
  g.reset();
  assert.equal(g.begin(), true, "après l'ouverture (ou la fermeture), le clic compte de nouveau");
});

test("page du catalogue : le bouton « Voir le détail » réchauffe la fiche et répond tout de suite ; la fenêtre a son écran de chargement", () => {
  const page = read("src/app/admin/(panel)/extensions/add/page.tsx");
  assert.match(page, /<CatalogueDetailsLink[^>]*query=/);
  assert.match(page, /pendingLabel=\{t\("progress\.opening"\)\}/);
  assert.ok(fs.existsSync("src/app/admin/(panel)/extensions/add/@modal/(.)details/loading.tsx"));
  assert.ok(fs.existsSync("src/app/admin/(panel)/extensions/add/details/loading.tsx"));
  // loading.tsx ne doit rien attendre (sinon il retarderait ce qu'il est censé montrer tout de suite).
  for (const f of ["src/app/admin/(panel)/extensions/add/@modal/(.)details/loading.tsx", "src/app/admin/(panel)/extensions/add/details/loading.tsx"]) assert.doesNotMatch(read(f), /await|async/);
  const link = read("src/components/admin/CatalogueDetailsLink.tsx");
  assert.match(link, /onPointerEnter/); assert.match(link, /onFocus/); assert.match(link, /onTouchStart/); assert.match(link, /useLinkStatus/);
  for (const k of ["opening", "ficheBack", "ficheClose", "ficheLabel"]) assert.ok(PROGRESS_LABEL_KEYS.includes(k), k);
});

test("fiche : le dépôt est lu dans un Suspense (le nom et la description s'affichent avant), avec attente bornée, galerie à part et « Réessayer » en cas d'échec", () => {
  const view = read("src/app/admin/(panel)/extensions/add/details/DetailsView.tsx");
  assert.match(view, /<Suspense fallback=\{<FicheSkeleton/);
  assert.match(view, /getModulePreview\(target, \{ waitMs: PREVIEW_WAIT_MS \}\)/);
  assert.match(view, /staleOk: true/);
  assert.match(view, /<RemoteGallery/);
  assert.doesNotMatch(view, /preview\??\.images/, "les octets des images n'entrent plus dans la fiche");
  const fiche = read("src/components/admin/ExtensionFiche.tsx");
  assert.match(fiche, /<RetryButton/);
  assert.match(read("src/app/api/admin/extension-warm/route.ts"), /hasRole\(user, "admin"\)/);
  assert.match(read("src/app/admin/(panel)/extensions/add/actions.ts"), /clearPreviewCache\(\)/, "« Actualiser » relit aussi les fiches");
});
