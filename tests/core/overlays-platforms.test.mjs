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
  assert.equal(P.resolvePlacement(overlay, "integrations"), "integrations", "ou rangé ailleurs que dans le menu : seulement dans Extensions");
  assert.equal(P.resolvePlacement(overlay, null), "overlays");
  assert.equal(P.resolvePlacement(overlay, "overlays"), "overlays");
  const twitch = { type: "utility" };
  assert.equal(P.resolvePlacement(twitch, "overlays"), "integrations", "pas d'adresse OBS : choix ignoré, la règle s'applique");
  assert.equal(P.resolvePlacement({ type: "widget", mcp: [{}] }, "overlays"), "menu");
  assert.deepEqual(P.placementsFor(overlay), ["menu", "overlays"], "épinglé, ou seulement dans Extensions");
  assert.deepEqual(P.placementsFor(twitch), ["menu", "integrations"]);
  assert.equal(P.parsePlacement("overlays"), "overlays");
});

test("menu : un overlay n'est dans le menu que s'il est épinglé ; sinon sa pastille remonte sur Extensions (s'il tourne)", () => {
  const it = (id, over = {}) => ({ id, type: "overlay", section: "community", placement: "overlays", enabled: true, error: false, badge: 0, content: false, ...over });
  const layout = P.buildMenuLayout([it("a", { badge: 2 }), it("b", { enabled: false, badge: 5 }), it("c", { error: true }), it("d", { placement: "menu", type: "utility" }), it("e", { placement: "integrations", badge: 1 })]);
  assert.equal(layout.unpinnedBadge, 3, "2 + 1 : ni la désactivée ni celle en erreur");
  assert.deepEqual(layout.community.groups.flatMap((g) => g.items.map((i) => i.id)), ["d"], "un overlay non épinglé n'est pas dans le menu de travail");
  assert.equal(Object.hasOwn(layout, "overlays") || Object.hasOwn(layout, "integrations"), false, "plus d'entrées « Intégrations » ni « Overlays »");
});

test("Extensions : l'adresse OBS d'un overlay (avec « Copier »), l'état, les réglages, l'interrupteur et l'épinglage sont repris ; la recherche trouve « obs »", () => {
  const card = read("src/components/admin/ExtensionCard.tsx");
  assert.match(card, /<CopyText text=\{i\.obsUrl\}/);
  assert.match(card, /<InstanceState t=\{t\} state=\{i\.state\}/);
  assert.match(card, /href=\{`\/admin\/instances\/\$\{i\.id\}`\}/);
  assert.match(card, /toggleInstanceAction\.bind\(null, i\.id, !i\.enabled\)/);
  assert.match(card, /setPlacementAction\.bind\(null, i\.id, i\.pinned \? i\.unpinTo : "menu"\)/);
  assert.match(read(`${PANEL}/extensions/loadInstalled.ts`), /overlayUrl\(siteUrl, i\.key\)/);
  assert.match(read(`${PANEL}/extensions/loadInstalled.ts`), /unpinnedPlacementFor\(mod\.manifest\)/);
  const cards = [{ name: "Alertes", mod: "Alerts overlay (OBS)", state: "on" }, { name: "Labyrinthe", mod: "3D maze overlay (OBS)", state: "setup" }]
    .map((c) => ({ ...c, search: moduleSearchText([c.name, c.mod, `integrations.state.${c.state}`, "obs", "overlay"]) }));
  const find = (q) => cards.filter((c) => matchesQuery(c.search, q)).map((c) => c.name);
  assert.deepEqual(find("labyrinthe"), ["Labyrinthe"]);
  assert.deepEqual(find("obs"), ["Alertes", "Labyrinthe"]);
  assert.deepEqual(find("zzz"), []);
  // la page de l'instance affiche toujours la même adresse
  assert.match(read(`${PANEL}/instances/[id]/page.tsx`), /overlayUrl\(siteUrl, instance\.key\)/);
  // l'action d'épinglage refuse « overlays » pour un module qui n'est pas un overlay
  assert.match(read(`${PANEL}/extensions/actions.ts`), /placementsFor\(mod\.manifest\)\.includes\(chosen\)/);
  assert.match(read(`${PANEL}/instances/actions.ts`), /placementsFor\(mod\.manifest\)\.includes\(placement\)/);
});

test("anciennes adresses d'Overlays : /admin/overlays redirige vers la famille Overlays d'Extensions ; la route publique /overlays/<clé> est intacte", () => {
  assert.match(read(`${PANEL}/overlays/page.tsx`), /redirectLegacy\("\/admin\/overlays"/);
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

test("liste d'Extensions : une pastille de plateforme, sans restructurer", () => {
  const loader = read(`${PANEL}/extensions/loadInstalled.ts`);
  assert.match(loader, /platformOf\(mod\.manifest\)/);
  assert.match(loader, /platform: platform \? platformLabel\(platform\) : null/);
  assert.match(read("src/components/admin/ExtensionCard.tsx"), /data-testid="platform-chip"/);
  assert.match(read("src/core/modules/extensionFamilies.ts"), /platformOf\(m\)/, "une plateforme déclarée range le module dans « Réseaux et connexions »");
});

test("compatibilité : un module sans le champ marche comme avant ; les cœurs plus anciens ignorent la clé (schéma non strict)", () => {
  const withIt = parseManifest(base({ platform: "twitch", type: "utility" }));
  const without = parseManifest(base({ type: "utility" }));
  assert.equal(P.defaultPlacement(withIt.manifest), P.defaultPlacement(without.manifest), "la plateforme n'influence jamais le rangement");
  const types = read("src/core/modules/types.ts");
  assert.match(types, /platform\?: string;/);
});

// ─── i18n ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("i18n : toutes les clés d'Extensions, du menu et du rangement existent en français et en anglais, avant les clés de thème", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  const keys = new Set(["placement.parkOverlays", "placement.unpin", "nav.extensions", "nav.myCommunity"]);
  for (const f of [`${PANEL}/extensions/page.tsx`, "src/components/admin/ExtensionCard.tsx", `${PANEL}/layout.tsx`, `${PANEL}/instances/[id]/page.tsx`]) for (const m of read(f).matchAll(/\bt\(\s*(?:"|\w+ \? t\(")([a-zA-Z][\w.]*)"/g)) keys.add(m[1]);
  for (const m of read(`${PANEL}/instances/[id]/page.tsx`).matchAll(/"(placement\.\w+)"/g)) keys.add(m[1]);
  assert.ok([...keys].filter((k) => k.startsWith("overlays.")).length >= 4);
  for (const k of keys) { assert.ok(fr[k], `fr : clé manquante ${k}`); assert.ok(en[k], `en : clé manquante ${k}`); }
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    assert.ok(all.indexOf("overlays.obsAddress") < all.indexOf("theme.custom"));
    assert.equal(all.at(-1), "settings.contrast.accent2");
  }
});
