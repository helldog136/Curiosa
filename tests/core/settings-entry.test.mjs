// L'entrée « Réglages » : un seul lien dans le menu, des onglets (Nom et logo, Langues, Confidentialité, Recherche, Visibilité dans les IA, E-mail,
// Adresse web en mode avancé), les anciennes adresses qui mènent au bon onglet, plus de rappel qui double le menu.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const { RedirectError } = await import("next/navigation");
const L = await import("@/core/adminLinks");
const { setSetting } = await import("@/core/settings");

after(() => db.close());
const PANEL = "../../src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
let owner;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); await setSetting("setup.completed", true);
  owner = await prisma.user.create({ data: { email: "emma@example.org", name: "Emma", role: "owner", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
const setMode = (advanced) => prisma.user.update({ where: { id: owner.id }, data: { advanced } });
async function render(file, props = {}) {
  as(owner);
  const mod = await import(`${PANEL}/${file}`);
  try { return await renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}), ...props })); }
  catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}
const tabLabels = (html) => [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);

test("onglets des réglages en mode simple : sans « Adresse web »", async () => {
  await setMode(false);
  const html = await render("settings/page.tsx");
  assert.deepEqual(tabLabels(html), ["Nom et logo", "Langues", "Confidentialité", "Recherche", "Visibilité dans les IA", "E-mail"]);
  assert.match(html, /data-tab="ai"/);
  assert.doesNotMatch(html, /data-tab="address"/);
  assert.doesNotMatch(html, /data-testid="to-appearance"|data-testid="to-address"/, "plus de rappel qui double le menu");
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
});

test("onglets des réglages en mode avancé : « Adresse web » en plus, avec le bouton vers la marche à suivre", async () => {
  await setMode(true);
  const html = await render("settings/page.tsx");
  assert.deepEqual(tabLabels(html).at(-1), "Adresse web");
  assert.match(html, /data-testid="settings-address"/);
  assert.match(html, /<a[^>]*href="\/admin\/settings\/address"[^>]*data-testid="to-address"|data-testid="to-address"[^>]*href="\/admin\/settings\/address"/);
  await setMode(false);
});

test("le menu n'a plus « Visibilité dans les IA » : une seule entrée « Réglages »", async () => {
  const layout = read("src/app/admin/(panel)/layout.tsx");
  assert.ok(!layout.includes("AI_VISIBILITY_HREF") && !layout.includes("nav.aiVisibility"));
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  assert.equal(fr["nav.settings"], "Réglages"); assert.equal(en["nav.settings"], "Settings");
  assert.equal(fr["nav.aiVisibility"], undefined); assert.equal(en["nav.aiVisibility"], undefined);
});

test("anciennes adresses : /admin/ai-visibility mène à l'onglet, /admin/settings/address et /admin/settings/rawg-covers n'ont pas bougé", async () => {
  assert.equal(L.SETTINGS_AI_HREF, "/admin/settings#ai");
  assert.equal(await render("ai-visibility/page.tsx"), "redirect:/admin/settings#ai");
  assert.equal(await render("ai-visibility/page.tsx", { searchParams: Promise.resolve({ x: "1" }) }), "redirect:/admin/settings#ai", "même avec un paramètre inconnu");
  await setMode(true);
  const addr = await render("settings/address/page.tsx");
  assert.doesNotMatch(addr, /^redirect:/);
  assert.match(addr, /data-testid="address-back"/, "retour vers l'onglet Adresse web");
  await setMode(false);
  assert.equal(await render("settings/address/page.tsx"), "redirect:/admin/settings", "en mode simple : comme avant, retour aux réglages");
  assert.ok(fs.existsSync("src/app/admin/(panel)/settings/rawg-covers/page.tsx"));
  assert.ok(fs.existsSync("src/app/admin/(panel)/settings/address/after/page.tsx"));
});

test("anciennes ancres : #site #languages #privacy #search #mail sont des onglets, #appearance et #header mènent à leur nouvelle page", () => {
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  for (const id of ["site", "languages", "privacy", "search", "mail"]) assert.match(page, new RegExp(`id: "${id}"`), id);
  assert.match(page, /<LegacyHash map=\{\{ appearance: APPEARANCE_HREF, header: NAVIGATION_HEADER_HREF \}\} \/>/);
  assert.equal(L.SETTINGS_PRIVACY_HREF, "/admin/settings#privacy");
});

test("l'onglet « Visibilité dans les IA » : le formulaire du flux RSS est hors du formulaire des réglages, aucun titre h1 en double", () => {
  const panel = read("src/app/admin/(panel)/settings/AiVisibilityPanel.tsx");
  assert.doesNotMatch(panel, /<h1/);
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  const form = page.slice(page.indexOf("<ActionForm action={saveSettings}"), page.indexOf("</ActionForm>"));
  assert.ok(!form.includes("AiVisibilityPanel"), "pas de formulaire dans un formulaire");
  assert.match(page, /<Suspense[\s\S]*<AiVisibilityPanel \/>/, "ne retient pas l'affichage de la page");
});
