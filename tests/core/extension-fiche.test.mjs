// Fiche d'une extension : ce que fait le module d'abord (description, visuels, ce qu'il ajoute), les détails techniques repliés en dessous, une barre d'installation collée en bas.
// Rendu des pièces (HTML), logique pure (état de la barre, ce que le module ajoute, résumé) et ordre dans la page. Le comportement du clic (agrandir, flèches) se voit au navigateur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const { makeTranslator } = await import("@/core/i18n/dictionary");
const tr = makeTranslator("fr");
const en = makeTranslator("en");
const { AddsList, TechnicalDetails, InstallBar, InstallBlockedButton } = await import("@/components/admin/FicheParts");
const { PreviewGallery } = await import("@/components/admin/PreviewGallery");
const V = await import("@/core/modules/ficheView");
const { parseManifest } = await import("@/core/modules/manifest");

const read = (p) => fs.readFileSync(p, "utf8");
const manifest = (over = {}) => { const r = parseManifest({ apiVersion: 2, id: "demo-mod", name: "Démo", version: "1.0.0", ...over }); assert.ok(r.ok, r.error); return r.manifest; };
const L = (v) => (typeof v === "string" ? v : v.fr);

/* ───────────── logique : ce que le module ajoute, résumé, état de la barre ───────────── */

test("ce que le module ajoute : page, contenus, réglages, blocs d'accueil, éléments d'overlay (3 noms au plus), outils pour l'assistant IA ; rien à dire = liste vide", () => {
  assert.deepEqual(V.whatItAdds(manifest(), L), []);
  const full = manifest({
    page: true, content: { display: "cards", clickAction: "detail", features: [] }, permissions: ["admin", "mcp"], sections: [{ id: "home", label: "Accueil" }],
    overlayElements: ["a", "b", "c", "d"].map((id) => ({ id, label: { fr: `Élément ${id}`, en: id }, size: { width: 200, height: 100 } })), minCore: "0.5.0",
    mcp: [{ name: "list_things", description: "Liste" }, { name: "add_thing", description: "Ajoute" }],
  });
  const adds = V.whatItAdds(full, L);
  assert.deepEqual(adds.map((a) => a.kind), ["page", "content", "settings", "sections", "overlay", "tools"]);
  assert.equal(adds.find((a) => a.kind === "overlay").names, "Élément a, Élément b, Élément c…");
  assert.equal(adds.find((a) => a.kind === "tools").n, 2);
  assert.deepEqual(V.whatItAdds(manifest({ settings: [{ key: "titre", label: "Titre", type: "text" }] }), L).map((a) => a.kind), ["settings"]);
});

test("résumé d'une ligne des détails techniques : ce que le module garde, combien d'autorisations il demande", () => {
  assert.deepEqual(V.techSummary(manifest({ privacy: "Adresse IP", permissions: ["storage"] }), ["storage", "routes"]), { keeps: "privacy", asks: 2 });
  assert.deepEqual(V.techSummary(manifest({ permissions: ["storage"] }), ["storage"]), { keeps: "storage", asks: 1 });
  assert.deepEqual(V.techSummary(manifest(), []), { keeps: "none", asks: 0 });
  assert.equal(tr("fiche.tech.asks", { n: 3 }), "Demande 3 autorisations");
  assert.equal(tr("fiche.tech.asks", { n: 1 }), "Demande 1 autorisation");
  assert.equal(en("fiche.tech.asks", { n: 1 }), "Asks for 1 permission");
  assert.equal(tr("fiche.adds.tools", { n: 1 }), "1 outil pour votre assistant IA");
  assert.equal(tr("fiche.adds.overlay", { n: 3, names: "A, B" }), "3 éléments à placer dans vos pages d'overlay : A, B");
});

test("état de la barre : rien sans droit d'installer ni module lisible ; installé ; bloqué avec sa raison dans l'ordre ; prêt (avec case à cocher si non vérifié)", () => {
  const ok = { canInstall: true, hasModule: true, failed: false, installed: false, entry: { compatible: true, origin: "official" }, problems: 0 };
  assert.deepEqual(V.installBarState(ok), { kind: "ready", confirm: false });
  assert.deepEqual(V.installBarState({ ...ok, canInstall: false }), { kind: "hidden" });
  assert.deepEqual(V.installBarState({ ...ok, hasModule: false }), { kind: "hidden" });
  assert.deepEqual(V.installBarState({ ...ok, installed: true }), { kind: "installed" });
  assert.deepEqual(V.installBarState({ ...ok, entry: { compatible: true, origin: "extra" } }), { kind: "ready", confirm: true });
  assert.deepEqual(V.installBarState({ ...ok, entry: undefined }), { kind: "ready", confirm: true }, "dépôt personnel : confirmation");
  assert.deepEqual(V.installBarState({ ...ok, failed: true }), { kind: "blocked", reason: "read" });
  assert.deepEqual(V.installBarState({ ...ok, entry: { compatible: false, origin: "official" } }), { kind: "blocked", reason: "incompatible" });
  assert.deepEqual(V.installBarState({ ...ok, entry: { compatible: true, needsNewerCore: "0.9.0", origin: "official" } }), { kind: "blocked", reason: "core" });
  assert.deepEqual(V.installBarState({ ...ok, problems: 2 }), { kind: "blocked", reason: "deps" });
  assert.deepEqual(V.installBarState({ ...ok, failed: true, problems: 2 }), { kind: "blocked", reason: "read" }, "la première raison l'emporte");
});

/* ───────────── pièces ───────────── */

test("barre d'installation : région nommée, collée en bas (sticky), bouton ≥ 44 px, état lu par les lecteurs d'écran, marge sous l'écran des téléphones", () => {
  const page = html(h(InstallBar, { label: "Installation", embedded: false, status: h("span", null, "Installation possible · version 1.2.0") }, h("button", { type: "button" }, "Installer sur mon site")));
  assert.match(page, /role="region"[^>]*aria-label="Installation"|aria-label="Installation"[^>]*role="region"/);
  assert.match(page, /data-testid="install-bar"/);
  assert.match(page, /sticky bottom-0/);
  assert.match(page, /id="install-status"[^>]*role="status"|role="status"[^>]*id="install-status"/);
  assert.match(page, /Installation possible · version 1\.2\.0/);
  assert.match(page, /safe-area-inset-bottom/, "ne passe pas sous la barre des téléphones");
  assert.match(page, /-mx-6 -mb-6 md:-mx-10 md:-mb-10/, "page entière : sur toute la largeur de la zone de contenu");
  const modal = html(h(InstallBar, { label: "Installation", embedded: true, status: "x" }, "y"));
  assert.match(modal, /-mx-4 -mb-8 sm:-mx-8/, "dans la fenêtre : à la place de son pied");
  assert.doesNotMatch(page, /fixed /, "dans le flux (sticky), jamais en superposition permanente : la fin du contenu n'est jamais cachée");
});

test("bouton d'installation impossible : inactif pour tous, relié à la raison écrite, même taille (≥ 44 px) que le bouton d'installation", () => {
  const b = html(h(InstallBlockedButton, { label: "Installer sur mon site" }));
  assert.match(b, /<button[^>]*type="button"/);
  assert.match(b, / disabled=""/);
  assert.match(b, /aria-disabled="true"/);
  assert.match(b, /aria-describedby="install-status"/);
  assert.match(b, /min-h-12/);
  assert.match(b, /Installer sur mon site/);
  assert.match(read("src/components/admin/InstallButton.tsx"), /look="hero"/);
  assert.match(read("src/components/admin/AnimatedActionButton.tsx"), /hero: "min-h-12 min-w-48/, "même forme que le bouton réel");
});

test("détails techniques : repliés par défaut, résumé d'une ligne visible, ouverts quand quelque chose bloque ; clavier natif (summary)", () => {
  const closed = html(h(TechnicalDetails, { summary: "Garde des données de votre public · Demande 3 autorisations", open: false, t: tr }, h("p", null, "contenu")));
  assert.match(closed, /<details id="details-techniques"(?![^>]*\bopen)/);
  assert.match(closed, /<summary[^>]*min-h-11/);
  assert.match(closed, />Détails techniques</);
  assert.match(closed, /Garde des données de votre public · Demande 3 autorisations/);
  assert.match(html(h(TechnicalDetails, { summary: "x", open: true, t: tr }, "y")), /<details[^>]* open=""/);
});

test("ce que le module ajoute : section nommée, une ligne par ajout ; rien d'ajouté = aucun bloc vide", () => {
  assert.equal(html(h(AddsList, { items: [], t: tr })), "");
  const out = html(h(AddsList, { items: [{ kind: "page", icon: "🌐" }, { kind: "overlay", icon: "🎬", n: 2, names: "Alerte, Compteur" }], t: tr }));
  assert.match(out, /aria-labelledby="adds-title"/);
  assert.match(out, /Ce que ce module ajoute/);
  assert.match(out, /Une page sur votre site/);
  assert.match(out, /2 éléments à placer dans vos pages d&#x27;overlay : Alerte, Compteur/);
});

const items = [0, 1, 2].map((i) => ({ src: `/api/admin/extension-previews?id=demo-mod&n=${i}`, width: 1200, height: 750, caption: `Légende ${i}`, alt: `Description ${i}`, typeLabel: ["Page du site", "Administration", "Overlay"][i] }));
const labels = { title: "À quoi cela ressemble", open: "Agrandir l'image : {caption}", close: "Fermer l'image", prev: "Image précédente", next: "Image suivante", count: "Image {n} sur {total}", sample: "Exemples." };

test("galerie : chaque image a son texte alternatif et sa légende visible, chargement paresseux, dimensions déclarées (pas de saut de page), sources sur le site lui-même", () => {
  const out = html(h(PreviewGallery, { items, labels }));
  assert.equal((out.match(/<img /g) ?? []).length, 3);
  for (const i of [0, 1, 2]) {
    assert.match(out, new RegExp(`alt="Description ${i}"`));
    assert.match(out, new RegExp(`<figcaption[^>]*>[\\s\\S]*?Légende ${i}`));
  }
  assert.equal((out.match(/loading="lazy"/g) ?? []).length, 3);
  assert.equal((out.match(/width="1200" height="750"/g) ?? []).length, 3);
  assert.deepEqual([...out.matchAll(/ src="([^"]+)"/g)].map((m) => m[1].slice(0, 28)), ["/api/admin/extension-previews", "/api/admin/extension-previews", "/api/admin/extension-previews"].map((s) => s.slice(0, 28)));
  assert.doesNotMatch(out, /https?:\/\//, "aucune adresse vers un autre site");
  assert.match(out, /Page du site/, "ce que montre l'image est écrit");
  assert.match(out, /<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Agrandir l&#x27;image : Légende 0"|aria-label="Agrandir l&#x27;image : Légende 0"[^>]*aria-haspopup="dialog"/, "vignette = bouton nommé (clavier)");
  assert.match(out, /min-h-11/);
  assert.match(out, /<dialog[^>]*aria-label=/, "agrandissement dans une boîte native : Échap, focus gardé");
  assert.match(out, /aria-labelledby="gallery-title"/);
});

test("galerie : la première image est plus grande à partir de trois ; sans image, aucun bloc ; le clavier et l'agrandissement sont câblés", () => {
  assert.match(html(h(PreviewGallery, { items, labels })), /sm:col-span-2/);
  assert.doesNotMatch(html(h(PreviewGallery, { items: items.slice(0, 2), labels })), /sm:col-span-2/);
  assert.equal(html(h(PreviewGallery, { items: [], labels })), "", "sans visuel : pas de titre ni de cadre vide");
  const src = read("src/components/admin/PreviewGallery.tsx");
  assert.match(src, /showModal\(\)/);
  assert.match(src, /ArrowRight[\s\S]*step\(1\)[\s\S]*ArrowLeft[\s\S]*step\(-1\)/);
  assert.match(src, /onError=\{\(\) => setFailed/, "une image qui ne charge pas disparaît seule");
  assert.match(src, /aria-live="polite"/);
  assert.doesNotMatch(src, /animate-|transition-transform|duration-/, "aucune animation");
});

/* ───────────── la fiche : l'ordre ───────────── */

test("fiche avant installation : description, puis visuels, puis ce qu'il ajoute, puis présentation, puis détails techniques, puis la barre d'installation", () => {
  const view = read("src/app/admin/(panel)/extensions/add/details/DetailsView.tsx");
  const at = (s) => { const i = view.indexOf(s); assert.ok(i >= 0, s); return i; };
  const order = [at("L(entry.description)"), at("<PreviewGallery"), at("<AddsList"), at('t("catalogue.presentation")'), at("<TechnicalDetails"), at("<InstallBar")];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // Rien de technique avant les détails : ni les autorisations, ni les données, ni les dépendances, ni la version.
  const before = view.slice(0, at("<TechnicalDetails"));
  for (const tech of ["catalogue.asks.friendly", "catalogue.privacy.title", "<DependencyPlanBox", "fiche.tech.versionTitle"]) assert.ok(!before.includes(tech), `${tech} doit être sous « Détails techniques »`);
  assert.match(view, /<InstallBar [^>]*embedded=\{embedded\}/, "même barre en page entière et en fenêtre");
  assert.equal((view.match(/<InstallButton /g) ?? []).length, 1, "un seul bouton d'installation principal");
});

test("fiche d'un module installé : même ordre, détails techniques repliés sous les réglages", () => {
  const view = read("src/app/admin/(panel)/modules/[id]/ModuleView.tsx");
  const order = ["L(mod.manifest.description)", "<PreviewGallery", "<AddsList", "<TechnicalDetails", "<RemoveSection"].map((s) => view.indexOf(s));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(view, /readInstalledPreviews\(row\.id\)/, "images de son dossier : aucun réseau");
  assert.match(view, /open=\{false\}/);
});

test("textes : français et anglais de la fiche, ton neutre, aucun mot technique interdit (R9), libellés sans deux-points final", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const enj = JSON.parse(read("src/locales/en.json"));
  const keys = Object.keys(fr).filter((k) => k.startsWith("fiche."));
  assert.ok(keys.length >= 30);
  assert.deepEqual(keys.sort(), Object.keys(enj).filter((k) => k.startsWith("fiche.")).sort());
  const banned = /\b(clé|slug|instance|topic|token|jeton|webhook|eventsub|route|service|identifiant|payload|api|json|cache|hash|sse|oauth)\b/i;
  for (const k of keys) {
    assert.doesNotMatch(fr[k], banned, `${k} : mot technique`);
    assert.doesNotMatch(fr[k], /!|veuillez|:\s*$/i, k);
    assert.ok(fr[k].length <= 90, `${k} : trop long (${fr[k].length})`);
    assert.deepEqual([...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...enj[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${k} : variables`);
  }
});
