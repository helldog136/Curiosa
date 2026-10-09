import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { parseManifest } = await import("@/core/modules/manifest");
const G = await import("@/core/modules/groups");
const V = await import("@/core/modules/settingValues");

const read = (p) => fs.readFileSync(p, "utf8");
const base = (over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", ...over });
const settings = [
  { key: "title", type: "text", label: "T", translatable: true, default: "site:name" },
  { key: "text", type: "textarea", label: "I", default: "site:tagline" },
  { key: "buttonLabel", type: "text", label: "B", translatable: true },
  { key: "buttonUrl", type: "link", label: "U" },
  { key: "video", type: "video", label: "V" },
  { key: "sound", type: "boolean", label: "S", default: false },
];
const button = { id: "button", label: "Bouton", addLabel: "Ajouter un bouton", fields: ["buttonLabel", "buttonUrl"], required: ["buttonLabel", "buttonUrl"] };
const bg = { id: "bg", label: "Fond", addLabel: "Ajouter une vidéo", fields: ["video", "sound"], required: ["video"] };

/* ───────────── Manifeste ───────────── */

test("manifeste : défauts « site: », type link et groupes valides", () => {
  assert.ok(parseManifest(base({ settings, optionalGroups: [button, bg] })).ok);
});

test("manifeste : « site: » réservé à text/textarea, valeurs connues seulement", () => {
  const one = (f) => parseManifest(base({ settings: [{ key: "x", label: "X", ...f }] })).ok;
  assert.equal(one({ type: "text", default: "site:name" }), true);
  assert.equal(one({ type: "textarea", default: "site:tagline" }), true);
  assert.equal(one({ type: "url", default: "site:name" }), false);
  assert.equal(one({ type: "color", default: "site:name" }), false);
  assert.equal(one({ type: "text", default: "site:logo" }), false);
});

test("manifeste : groupes — champs existants, required ⊂ fields, un champ dans un seul groupe, 6 au plus", () => {
  const ok = (groups) => parseManifest(base({ settings, optionalGroups: groups })).ok;
  assert.equal(ok([{ ...button, fields: ["buttonLabel", "nope"] }]), false, "champ inconnu");
  assert.equal(ok([{ ...button, required: ["video"] }]), false, "required hors fields");
  assert.equal(ok([button, { ...bg, fields: ["video", "buttonUrl"] }]), false, "champ dans deux groupes");
  assert.equal(ok([{ ...bg, required: ["sound"] }]), false, "case à cocher obligatoire");
  assert.equal(ok([{ ...bg, fields: [] }]), false, "groupe vide");
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, label: "g", addLabel: "a", fields: [`k${i}`] }));
  const manySettings = many.map((g, i) => ({ key: `k${i}`, type: "text", label: "k" }));
  assert.equal(parseManifest(base({ settings: manySettings, optionalGroups: many })).ok, false, "7 groupes");
  assert.equal(parseManifest(base({ settings: manySettings, optionalGroups: many.slice(0, 6) })).ok, true, "6 groupes");
});

/* ───────────── Groupes (fonctions pures) ───────────── */

test("groupes : le flag « 0 » efface, « 1 » exige les champs obligatoires, l'absence ne touche à rien", () => {
  assert.deepEqual(G.judgeGroup(button, "0", {}), { action: "clear" });
  assert.deepEqual(G.judgeGroup(button, null, {}), { action: "keep" });
  assert.deepEqual(G.judgeGroup(button, "1", { buttonLabel: true, buttonUrl: false }), { action: "error", missing: ["buttonUrl"] });
  assert.deepEqual(G.judgeGroup(button, "1", { buttonLabel: true, buttonUrl: true }), { action: "keep" });
  assert.deepEqual(G.judgeGroup({}, "1", {}), { action: "keep" }, "groupe ouvert sans champ obligatoire");
  assert.equal(G.groupFlagName("button"), "__group__button");
});

test("groupes : ouvert d'office seulement si un champ a une valeur", () => {
  assert.equal(G.groupHasValue(button, settings, {}), false);
  assert.equal(G.groupHasValue(button, settings, { buttonLabel: { fr: "" } }), false);
  assert.equal(G.groupHasValue(button, settings, { buttonLabel: { fr: "Go" } }), true);
  assert.equal(G.groupHasValue(bg, settings, { sound: { "": false } }), false, "case décochée = pas de valeur");
  assert.equal(G.groupHasValue(bg, settings, { sound: { "": true } }), true);
});

test("groupes : le groupe prend la place de son premier champ, une seule fois", () => {
  const slots = G.layoutFields(settings, [button, bg]);
  assert.deepEqual(slots.map((s) => (s.kind === "field" ? s.field.key : `group:${s.group.id}`)), ["title", "text", "group:button", "group:bg"]);
  assert.deepEqual(G.layoutFields(settings.slice(0, 2), [button]).map((s) => s.kind), ["field", "field"]);
});

/* ───────────── Liens et défauts du site ───────────── */

test("lien : page du site, https:// ou mailto: ; rien d'autre", () => {
  for (const ok of ["/contact", "/", "/a/b?x=1#y", "https://example.org", "https://example.org/x", "mailto:a@b.fr"]) assert.equal(V.isValidLink(ok), true, ok);
  for (const bad of ["contact", "http://x.fr", "//evil.com", "javascript:alert(1)", "/a b", "mailto:", "mailto:nope", "https://", "", "ftp://x"]) assert.equal(V.isValidLink(bad), false, bad);
  assert.equal(new RegExp(`^(?:${V.LINK_PATTERN})$`, "v").test("/contact"), true, "le motif HTML est valide en mode v");
});

test("défauts « site: » : résolus dans la langue, rien n'est stocké si la valeur suit le site", () => {
  const fr = { name: "Mon site", tagline: "Accroche" };
  assert.equal(V.resolveDefault({ default: "site:name" }, fr), "Mon site");
  assert.equal(V.resolveDefault({ default: "site:tagline" }, fr), "Accroche");
  assert.equal(V.resolveDefault({ default: "bonjour" }, fr), "bonjour");
  assert.equal(V.resolveDefault({}, fr), undefined);
  assert.equal(V.shouldStore({ default: "site:name" }, "Mon site", "Mon site"), false);
  assert.equal(V.shouldStore({ default: "site:name" }, "Autre", "Mon site"), true);
  assert.equal(V.shouldStore({ default: "site:name" }, "", "Mon site"), false);
  assert.equal(V.shouldStore({ default: "bonjour" }, "bonjour", "bonjour"), true, "défaut fixe : valeur conservée telle quelle");
});

/* ───────────── Vérifications statiques (admin, serveur, contexte, docs, i18n) ───────────── */

test("serveur : contrôle des groupes et des liens avant toute écriture, défaut du site appliqué par ctx.setting", () => {
  const actions = read("src/app/admin/(panel)/instances/actions.ts");
  assert.match(actions, /judgeGroup\(/);
  assert.match(actions, /isValidLink\(/);
  assert.match(actions, /shouldStore\(/);
  assert.ok(actions.indexOf("for (const o of ops)") > actions.indexOf("isValidLink("), "les écritures viennent après les contrôles");
  assert.match(read("src/core/modules/context.ts"), /followsSite\(field\)/);
});

test("admin : attribut required natif, motif de lien, champ caché du groupe, une seule barre d'enregistrement", () => {
  const form = read("src/components/admin/ModuleSettings.tsx");
  assert.match(form, /required/);
  assert.match(form, /pattern=\{LINK_PATTERN\}/);
  assert.match(read("src/components/admin/OptionalGroup.tsx"), /groupFlagName\(id\)/);
  const page = read("src/app/admin/(panel)/instances/[id]/page.tsx");
  assert.ok(!/instances\.noneMeansSite|Vide =/.test(page + form));
  assert.ok(!page.includes("hideSubmit"), "pas de bouton d'enregistrement en double");
});

test("i18n : mêmes clés en français et en anglais pour les réglages de groupes", () => {
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["instances.s.options", "instances.s.appearance", "instances.s.deleteTitle", "instances.groupRemove", "instances.linkHelp", "instances.error.link", "instances.error.groupRequired"]) assert.ok(fr[k] && en[k], k);
});
