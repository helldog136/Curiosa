import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const P = await import("@/core/modules/menuPlacement");
const PF = await import("@/core/modules/platform");
const { parseManifest } = await import("@/core/modules/manifest");
const { overlayUrl } = await import("@/core/modules/overlayUrl");
const { getAdminNav } = await import("@/core/modules/adminNav");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { moduleSearchText, matchesQuery } = await import("@/core/modules/installedList");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

beforeEach(() => db.reset());
after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)";
const base = (over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", ...over });

// ─── Overlays : une famille à part ──────────────────────────────────────────────────────────────────────────────
test("règle : un module de type « overlay », ou qui déclare la permission « overlay », va dans la famille Overlays", () => {
  assert.equal(P.defaultPlacement({ type: "overlay" }), "overlays");
  assert.equal(P.defaultPlacement({ permissions: ["routes", "overlay"] }), "overlays", "la permission suffit, sans le type");
  assert.equal(P.defaultPlacement({ type: "utility", permissions: ["overlay"], mcp: [{}] }), "overlays", "prioritaire sur « données à gérer »");
  assert.equal(P.defaultPlacement({ type: "overlay", content: { display: "cards", clickAction: "detail" } }), "overlays");
  assert.equal(P.defaultPlacement({ type: "utility", permissions: ["routes"] }), "integrations", "sans overlay : inchangé");
  assert.equal(P.defaultPlacement({ type: "social" }), "integrations");
  assert.equal(P.isOverlayManifest({ type: "overlay" }), true);
  assert.equal(P.isOverlayManifest({}), false);
});

test("épinglage : menu | integrations | overlays ; le choix l'emporte, mais « overlays » n'existe que pour un overlay", () => {
  assert.deepEqual([...P.PLACEMENTS], ["menu", "integrations", "overlays"]);
  const overlay = { type: "overlay" };
  assert.equal(P.resolvePlacement(overlay, "menu"), "menu", "un overlay épinglé au menu y reste");
  assert.equal(P.resolvePlacement(overlay, "integrations"), "integrations", "ou rangé dans Intégrations");
  assert.equal(P.resolvePlacement(overlay, null), "overlays");
  assert.equal(P.resolvePlacement(overlay, "overlays"), "overlays");
  const twitch = { type: "utility" };
  assert.equal(P.resolvePlacement(twitch, "overlays"), "integrations", "pas d'adresse OBS : choix ignoré, la règle s'applique");
  assert.equal(P.resolvePlacement({ type: "widget", mcp: [{}] }, "overlays"), "menu");
  assert.deepEqual(P.placementsFor(overlay), ["menu", "integrations", "overlays"]);
  assert.deepEqual(P.placementsFor(twitch), ["menu", "integrations"]);
  assert.equal(P.parsePlacement("overlays"), "overlays");
});

test("menu : une seule entrée « Overlays (n) » qui compte toutes les instances rangées et cumule les pastilles de celles qui tournent", () => {
  const it = (id, over = {}) => ({ id, type: "overlay", placement: "overlays", enabled: true, error: false, badge: 0, content: false, ...over });
  const layout = P.buildMenuLayout([it("a", { badge: 2 }), it("b", { enabled: false, badge: 5 }), it("c", { error: true }), it("d", { placement: "menu", type: "utility" }), it("e", { placement: "integrations" })]);
  assert.equal(layout.overlays.count, 3);
  assert.equal(layout.overlays.badge, 2);
  assert.equal(layout.integrations.count, 1, "Intégrations ne compte pas les overlays");
  assert.deepEqual(layout.groups.flatMap((g) => g.items.map((i) => i.id)), ["d"], "un overlay rangé n'est pas dans le menu de travail");
  assert.equal(P.buildMenuLayout([]).overlays.count, 0);
});

test("adresse OBS : l'URL publique complète, construite avec l'adresse du site (sans double barre)", () => {
  assert.equal(overlayUrl("https://monsite.example", "alertes"), "https://monsite.example/overlays/alertes");
  assert.equal(overlayUrl("https://monsite.example/", "maze-2"), "https://monsite.example/overlays/maze-2");
  assert.equal(overlayUrl("http://localhost:3000", "x"), "http://localhost:3000/overlays/x");
});

test("page Overlays : une carte par overlay (nom, état, adresse OBS avec « Copier », réglages, interrupteur, épinglage), cherchable", () => {
  const page = read(`${PANEL}/overlays/page.tsx`);
  assert.match(page, /adminCtx\("admin"\)/);
  assert.match(page, /\.filter\(\(i\) => i\.placement === "overlays"\)/);
  assert.match(page, /overlayUrl\(siteUrl, i\.key\)/);
  assert.match(page, /<CopyText text=\{c\.url\}/);
  assert.match(page, /<InstanceState t=\{t\} state=\{c\.state\}/);
  assert.match(page, /href=\{`\/admin\/instances\/\$\{c\.id\}`\}/);
  assert.match(page, /toggleInstanceAction\.bind\(null, c\.id, !c\.enabled\)/);
  assert.match(page, /setPlacementAction\.bind\(null, c\.id, "menu"\)/);
  assert.match(page, /<CatalogueSearch/);
  assert.match(page, /data-catalogue-item data-search=\{c\.search\}/);
  const cards = [{ name: "Alertes", mod: "Alerts overlay (OBS)", state: "on" }, { name: "Labyrinthe", mod: "3D maze overlay (OBS)", state: "setup" }]
    .map((c) => ({ ...c, search: moduleSearchText([c.name, c.mod, `integrations.state.${c.state}`, "obs", "overlay"]) }));
  const find = (q) => cards.filter((c) => matchesQuery(c.search, q)).map((c) => c.name);
  assert.deepEqual(find("labyrinthe"), ["Labyrinthe"]);
  assert.deepEqual(find("obs"), ["Alertes", "Labyrinthe"]);
  assert.deepEqual(find("zzz"), []);
  // la page de l'instance affiche toujours la même adresse
  assert.match(read(`${PANEL}/instances/[id]/page.tsx`), /overlayUrl\(siteUrl, instance\.key\)/);
  // l'action d'épinglage refuse « overlays » pour un module qui n'est pas un overlay
  assert.match(read(`${PANEL}/integrations/actions.ts`), /placementsFor\(mod\.manifest\)\.includes\(chosen\)/);
  assert.match(read(`${PANEL}/instances/actions.ts`), /placementsFor\(mod\.manifest\)\.includes\(placement\)/);
});

test("entrée de menu « Overlays » : réservée aux rôles qui peuvent gérer, comme Intégrations ; l'ancienne route /overlays/<clé> est intacte", () => {
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /showOverlays = canManage && menu\.overlays\.count > 0/);
  assert.match(layout, /href="\/admin\/overlays"/);
  assert.match(layout, /nav\.overlays/);
  assert.match(layout, /badge=\{menu\.overlays\.badge\}/);
  assert.ok(fs.existsSync("src/app/overlays/[key]/page.tsx"));
});

test("de bout en bout : une instance non-overlay n'a pas de plateforme ni d'adresse OBS ; le choix d'épinglage est mémorisé", async () => {
  await db.fixture("hero");
  const manifest = FIXTURE_MODULES.find((b) => b.manifest.id === "hero").manifest;
  const hero = await createInstance(db.prisma, { manifest, names: { en: "Hero" } });
  let n = (await getAdminNav("en", "en")).find((i) => i.key === hero.key);
  assert.equal(n.platform, null);
  assert.equal(n.overlay, false);
  assert.deepEqual(n.placements, ["menu", "integrations"]);
  await setSetting(P.placementSettingKey(hero.id), "overlays");
  n = (await getAdminNav("en", "en")).find((i) => i.key === hero.key);
  assert.equal(n.placement, "integrations", "un choix « overlays » sur un module qui n'en est pas un est ignoré");
  assert.equal(n.pinned, null);
});

// ─── Champ `platform` ───────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : platform valide, absent (aucune plateforme) ou invalide (refusé avec un message clair)", () => {
  for (const ok of ["twitch", "discord", "youtube", "x", "ko-fi", "a1", "a".repeat(31)]) assert.equal(parseManifest(base({ platform: ok })).manifest.platform, ok, ok);
  const none = parseManifest(base());
  assert.equal(none.ok, true);
  assert.equal(none.manifest.platform, undefined);
  for (const bad of ["Twitch", "1twitch", "", "twitch tv", "-x", "a".repeat(32), "twitch_tv", "été", 3, ["twitch"]]) {
    const r = parseManifest(base({ platform: bad }));
    assert.equal(r.ok, false, `refusé : ${JSON.stringify(bad)}`);
    assert.match(r.error, /platform/);
  }
  assert.match(parseManifest(base({ platform: "Twitch" })).error, /lowercase identifier like twitch/);
});

test("libellés : plateformes connues avec leur écriture officielle ; inconnue = identifiant avec majuscule initiale", () => {
  const known = { twitch: "Twitch", discord: "Discord", youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X", github: "GitHub", kofi: "Ko-fi", "ko-fi": "Ko-fi", soundcloud: "SoundCloud", bluesky: "Bluesky" };
  for (const [id, label] of Object.entries(known)) assert.equal(PF.platformLabel(id), label);
  assert.equal(PF.platformLabel("monreseau"), "Monreseau");
  assert.equal(PF.platformLabel("mon-reseau"), "Mon-reseau");
  assert.equal(PF.platformLabel("constructor"), "Constructor", "pas de piège avec les clés héritées d'Object");
  for (const id of Object.keys(PF.PLATFORM_LABELS)) assert.match(id, PF.PLATFORM_PATTERN, `${id} : identifiant valide`);
  assert.equal(PF.platformOf({ platform: "twitch" }), "twitch");
  assert.equal(PF.platformOf({}), null);
  assert.equal(PF.platformOf({ platform: "Mal Formé" }), null, "jamais d'erreur pour un affichage");
});

test("regroupement : une section par plateforme dès 2 instances ; seule de sa plateforme ou sans plateforme → reste dans son type", () => {
  const c = (id, platform, type = "utility") => ({ id, platform, type });
  const split = PF.splitByPlatform([
    c("twitch-1", "twitch"), c("links", null, "social"), c("live", "twitch"), c("annonces", "discord"), c("discord", "discord"), c("yt", "youtube"), c("hero", null),
  ]);
  assert.deepEqual(split.platforms.map((p) => [p.platform, p.items.map((i) => i.id)]), [["discord", ["annonces", "discord"]], ["twitch", ["twitch-1", "live"]]], "ordre alphabétique des libellés, ordre des cartes conservé");
  assert.deepEqual(split.rest.map((i) => i.id), ["links", "yt", "hero"], "YouTube seul : pas de section");
  assert.deepEqual(PF.splitByPlatform([c("a", "twitch"), c("b", null)]).platforms, [], "une seule instance : rien ne change");
  assert.deepEqual(PF.splitByPlatform([]), { platforms: [], rest: [] });
  // deux instances du MÊME module (deux chaînes) partagent aussi leur plateforme
  assert.equal(PF.splitByPlatform([c("t1", "twitch"), c("t2", "twitch")]).platforms.length, 1);
});

test("page Intégrations : sections par plateforme, puis « Réseaux sociaux » et « Autres » ; sans plateforme partagée, une seule grille sans titre", () => {
  const page = read(`${PANEL}/integrations/page.tsx`);
  assert.match(page, /splitByPlatform\(cards\)/);
  assert.match(page, /title: platformLabel\(p\.platform\)/);
  assert.match(page, /split\.platforms\.length === 0\) sections\.push\(\{ id: "all", title: null/);
  assert.match(page, /c\.type === "social"/);
  assert.match(page, /t\("integrations\.sectionOther"\)/);
  assert.match(page, /data-catalogue-section/, "chaque section disparaît quand la recherche la vide");
  assert.match(page, /i\.platform \? platformLabel\(i\.platform\)/, "on peut chercher « twitch » par la plateforme");
  assert.match(page, /setPlacementAction\.bind\(null, c\.id, "menu"\)/, "chaque instance reste épinglable individuellement");
  // liste « Installés » du hub : une pastille de plateforme, sans restructurer
  const modules = read(`${PANEL}/modules/page.tsx`);
  assert.match(modules, /data-testid="platform-chip"/);
  assert.match(modules, /platformOf\(mod\.manifest\)/);
});

test("compatibilité : un module sans le champ marche comme avant ; les cœurs plus anciens ignorent la clé (schéma non strict)", () => {
  const withIt = parseManifest(base({ platform: "twitch", type: "utility" }));
  const without = parseManifest(base({ type: "utility" }));
  assert.equal(P.defaultPlacement(withIt.manifest), P.defaultPlacement(without.manifest), "la plateforme n'influence jamais le rangement");
  const types = read("src/core/modules/types.ts");
  assert.match(types, /platform\?: string;/);
});

// ─── i18n ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("i18n : toutes les clés de la page Overlays et des sections existent en français et en anglais, avant les clés de thème", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  const keys = new Set(["nav.overlays", "placement.parkOverlays", "integrations.sectionOther"]);
  for (const f of [`${PANEL}/overlays/page.tsx`, `${PANEL}/integrations/page.tsx`, `${PANEL}/layout.tsx`, `${PANEL}/instances/[id]/page.tsx`]) for (const m of read(f).matchAll(/\bt\(\s*"([a-zA-Z][\w.]*)"/g)) keys.add(m[1]);
  for (const m of read(`${PANEL}/instances/[id]/page.tsx`).matchAll(/"(placement\.\w+)"/g)) keys.add(m[1]);
  assert.ok([...keys].filter((k) => k.startsWith("overlays.")).length >= 10);
  for (const k of keys) { assert.ok(fr[k], `fr : clé manquante ${k}`); assert.ok(en[k], `en : clé manquante ${k}`); }
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    assert.ok(all.indexOf("overlays.title") < all.indexOf("theme.custom"));
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});
