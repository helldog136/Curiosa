// Polices (docs/POLICES.md) : envoi de sa propre police (octets, taille, nombre, case de licence, suppression), service des fichiers (en-têtes, noms permis), rendu
// (titres ≠ texte, seules les polices choisies sont chargées, aucun site tiers), compatibilité de `theme.font` et des skins, retouches et « Revenir au skin »,
// sauvegarde et restauration. De vrais fichiers WOFF2 (ceux de la bibliothèque), de vrais dépôts git locaux jetables, aucun réseau.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const U = await import("@/core/fonts/uploads");
const R = await import("@/core/fonts/registry");
const Serve = await import("@/core/fonts/serve");
const { loadLibrary, urlNameOf } = await import("@/core/fonts/library");
const route = await import("../../src/app/fonts/[file]/route.ts");
const A = await import("@/core/skins/appearance");
const V = await import("@/core/skins/appearanceView");
const S = await import("@/core/skins/service");
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { resolveLook } = await import("@/core/skins/render");
const { getSiteConfig, getSetting, setSetting } = await import("@/core/settings");
const actions = await import("@/app/admin/(panel)/appearance/actions");
const { BRAND_MARK_CSS } = await import("@/core/skins/brand");
const cat = createSkinsRepo();
const FONTS = path.join(db.dir, "fonts");
const SKINS = path.join(db.dir, "skins");
const PW = "un-mot-de-passe-solide";

const real = (name) => fs.readFileSync(`fonts/files/${name}`);
const KALAM4 = real("kalam-400-latin.woff2"), KALAM7 = real("kalam-700-latin.woff2"), BITTER4 = real("bitter-400-latin.woff2"), BITTER7 = real("bitter-700-latin.woff2"), INTER4 = real("inter-400-latin.woff2");
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v); return f; };
const asAdmin = async (role = "owner") => {
  const email = `${role}@example.org`;
  const u = (await db.prisma.user.findUnique({ where: { email } })) ?? (await db.prisma.user.create({ data: { email, name: role, role, passwordHash: "x", locale: "fr" } }));
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  return u;
};
const add = (bytes, o = {}) => U.addUpload({ bytes, accepted: true, actor: "owner@example.org", ...o });
// les fichiers de la bibliothèque sont des instances d'une police variable : leur nom écrit est parfois « Bitter Thin » ; une vraie police envoyée a le sien
const bitter = (bytes) => add(bytes, { name: "Bitter" });
const sheet = async () => (await resolveLook(await getSiteConfig())).sheet;
const faces = (css) => [...css.matchAll(/@font-face\{font-family:"([^"]+)"[^}]*\}/g)];

beforeEach(async () => {
  await db.reset();
  fs.rmSync(FONTS, { recursive: true, force: true });
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
  globalThis.curiosaTestSession = null;
  await asAdmin("owner");
});
after(() => { db.close(); cat.close(); });

// ── envoi ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("envoi : une vraie police est acceptée, son nom, sa graisse et son style sont lus ; le fichier est écrit sous DATA_DIR/fonts et listé", async () => {
  const r = await add(KALAM4);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.font.family, r.font.slug, r.font.weight, r.font.style, r.font.bytes], ["Kalam", "kalam", "400", "normal", KALAM4.length]);
  const id = crypto.createHash("sha256").update(KALAM4).digest("hex").slice(0, 16);
  assert.equal(r.font.id, id);
  assert.deepEqual(fs.readdirSync(FONTS), [`u-${id}.woff2`], "un seul fichier, aucun fichier temporaire");
  assert.ok(fs.readFileSync(path.join(FONTS, `u-${id}.woff2`)).equals(KALAM4));
  assert.deepEqual((await U.listUploads()).map((f) => f.id), [id]);
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "appearance.font.add" } })).length, 1);
});

test("envoi : un nom saisi remplace celui du fichier ; un nom inutilisable est refusé sous le champ du nom", async () => {
  const r = await add(KALAM4, { name: "  Ma   Police " });
  assert.deepEqual([r.ok, r.font.family, r.font.slug], [true, "Ma Police", "ma-police"]);
  const bad = await add(KALAM7, { name: "<<<>>>" });
  assert.deepEqual([bad.ok, bad.code, bad.field], [false, "name", "name"]);
  assert.equal(fs.readdirSync(FONTS).length, 1);
});

test("envoi : sans la case de licence rien n'est lu ni écrit ; ni fichier vide, ni autre type, ni fichier trop lourd, ni fichier abîmé", async () => {
  const r = await add(KALAM4, { accepted: false });
  assert.deepEqual([r.ok, r.code, r.field], [false, "license", "license"]);
  assert.equal(fs.existsSync(FONTS), false, "aucun dossier créé");
  for (const [what, bytes, code] of [
    ["vide", Buffer.alloc(0), "empty"], ["exécutable", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)]), "not-woff2"], ["page", Buffer.from("<html><script>alert(1)</script></html>".padEnd(300, " ")), "not-woff2"],
    ["trop lourd", Buffer.concat([KALAM4, Buffer.alloc(150 * 1024)]), "too-large"], ["tronqué", KALAM4.subarray(0, 5000), "header"],
  ]) {
    const x = await add(bytes);
    assert.deepEqual([what, x.ok, x.code, x.field], [what, false, code, "font"]);
  }
  assert.deepEqual(await U.listUploads(), []);
  assert.equal(fs.existsSync(FONTS), false);
});

test("envoi : 4 fichiers au plus, jamais deux fois le même, une graisse par famille et par style", async () => {
  assert.equal((await add(KALAM4)).ok, true);
  assert.equal((await add(KALAM7)).ok, true, "la graisse grasse de la même famille");
  assert.equal((await add(KALAM4)).code, "duplicate");
  const same = await add(BITTER4, { name: "Kalam" });
  assert.deepEqual([same.ok, same.code], [false, "style"], "une famille ne peut pas avoir deux fois la même graisse");
  assert.equal((await bitter(BITTER4)).ok, true);
  assert.equal((await bitter(BITTER7)).ok, true);
  const full = await add(INTER4);
  assert.deepEqual([full.ok, full.code], [false, "limit"]);
  assert.equal(fs.readdirSync(FONTS).length, 4);
  assert.deepEqual(R.uploadFamilies(await U.listUploads()).map((g) => [g.family, g.files.length]), [["Kalam", 2], ["Bitter", 2]]);
  assert.deepEqual(R.uploadWeights((await U.listUploads()).filter((f) => f.slug === "kalam")), [400, 700]);
});

test("envois en même temps : le plafond de 4 tient, rien ne se perd", async () => {
  const set = [KALAM4, KALAM7, BITTER4, BITTER7, INTER4, real("inter-700-latin.woff2")];
  const out = await Promise.all(set.map((b) => add(b)));
  assert.equal(out.filter((r) => r.ok).length, 4);
  assert.equal((await U.listUploads()).length, 4);
  assert.equal(fs.readdirSync(FONTS).length, 4);
});

test("suppression : le fichier et l'entrée partent ; si la famille était choisie, « celle du skin » reprend (l'autre choix reste)", async () => {
  const a = await add(KALAM4), b = await add(KALAM7), c = await bitter(BITTER4);
  await setSetting("theme.fontBody", "up:kalam");
  await setSetting("theme.fontHeading", "up:bitter");
  let r = await U.removeUpload(a.font.id, { actor: "o@x.org" });
  assert.deepEqual([r.ok, r.reset], [true, []], "il reste la graisse grasse : le choix tient");
  assert.equal(await getSetting("theme.fontBody"), "up:kalam");
  r = await U.removeUpload(b.font.id, { actor: "o@x.org" });
  assert.deepEqual(r.reset, ["body"]);
  assert.equal(await getSetting("theme.fontBody"), undefined);
  assert.equal(await getSetting("theme.fontHeading"), "up:bitter", "l'autre choix reste");
  assert.equal((await U.removeUpload(c.font.id, { actor: "o@x.org" })).reset[0], "heading");
  assert.deepEqual([fs.readdirSync(FONTS), await U.listUploads(), await getSetting("theme.fontFiles")], [[], [], undefined]);
  assert.equal((await U.removeUpload("0123456789abcdef", { actor: "o" })).ok, false);
  const sh = await sheet();
  assert.ok(!sh.includes("cf-up-"), "le rendu ne cite plus la police supprimée");
});

// ── administration ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("actions : l'envoi dit sous le bon champ ce qu'il faut faire (case, fichier, nom, type, nombre) ; réservé à l'administration ; la suppression se confirme par un message", async () => {
  const file = (bytes, name = "ma-police.woff2") => new File([bytes], name, { type: "font/woff2" });
  let r = await actions.uploadFontAction(null, form({ font: file(KALAM4) }));
  assert.match(r.errors.license, /Cochez la case/);
  r = await actions.uploadFontAction(null, form({ license: "on" }));
  assert.match(r.errors.font, /Choisissez un fichier \.woff2, \.otf ou \.ttf/);
  r = await actions.uploadFontAction(null, form({ license: "on", font: file(Buffer.from("MZ" + "x".repeat(300)), "virus.woff2") }));
  assert.match(r.errors.font, /n'est pas une police \.woff2, \.otf ou \.ttf/);
  r = await actions.uploadFontAction(null, form({ license: "on", font: file(Buffer.alloc(500 * 1024 + 1)) }));
  assert.match(r.errors.font, /Convertissez-le en \.woff2/);
  r = await actions.uploadFontAction(null, form({ license: "on", fontName: "<<>>", font: file(KALAM4) }));
  assert.match(r.errors.fontName, /Ce nom n'est pas utilisable/);
  r = await actions.uploadFontAction(null, form({ license: "on", font: file(KALAM4) }));
  assert.match(r.ok, /La police « Kalam » est prête/);
  r = await actions.uploadFontAction(null, form({ license: "on", font: file(KALAM4) }));
  assert.match(r.errors.font, /déjà envoyé/);
  const id = (await U.listUploads())[0].id;
  await setSetting("theme.fontBody", "up:kalam");
  r = await actions.deleteFontAction(null, form({ id }));
  assert.match(r.ok, /supprimée\. La police du skin reprend/);
  assert.match((await actions.deleteFontAction(null, form({ id }))).error, /déjà été supprimée/);
  // une personne de la rédaction n'a pas accès
  globalThis.curiosaTestSession = null;
  await asAdmin("editor");
  await assert.rejects(() => actions.uploadFontAction(null, form({ license: "on", font: file(KALAM4) })));
  await assert.rejects(() => actions.deleteFontAction(null, form({ id })));
  const src = fs.readFileSync("src/app/admin/(panel)/appearance/actions.ts", "utf8");
  assert.match(src, /export async function uploadFontAction[\s\S]*?adminCtx\("admin"\)/);
  assert.match(src, /export async function deleteFontAction[\s\S]*?adminCtx\("admin"\)/);
});

test("retouches : les deux choix s'enregistrent, « celle du skin » supprime la clé, une police inconnue est refusée sans rien écrire ; l'ancien theme.font est repris puis retiré", async () => {
  const base = { background: "#101010", accent: "#e8a23b", accent2: "", surface: "", text: "", glow: "none", bgPreset: "none", headerLayout: "classic" };
  const view = await V.loadAppearanceView();
  const save = async (o) => A.saveRetouches(A.parseRetouchForm(form({ ...base, ...o })), view.base, { actor: "o" });
  assert.equal((await save({ fontHeading: "lib:bitter", fontBody: "lib:inter" })).ok, true);
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody")], ["lib:bitter", "lib:inter"]);
  const bad = await save({ fontHeading: "lib:comic-sans" });
  assert.deepEqual([bad.ok, bad.error], [false, "appearance.font.error.unknown"]);
  assert.equal(await getSetting("theme.fontHeading"), "lib:bitter", "rien n'a été écrit");
  assert.equal((await save({ fontHeading: "up:fantome" })).ok, false, "une police envoyée qui n'existe pas");
  // formulaire sans les deux champs : on n'y touche pas
  assert.equal((await save({})).ok, true);
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody")], ["lib:bitter", "lib:inter"]);
  // « celle du skin »
  assert.equal((await save({ fontHeading: "", fontBody: "" })).ok, true);
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody")], [undefined, undefined]);
  // migration sans perte : l'ancien réglage est lu, repris comme choix du texte, puis retiré à l'enregistrement
  await setSetting("theme.font", "serif");
  assert.equal((await V.loadAppearanceView()).raw.font, "serif");
  assert.equal((await save({ fontBody: "sys:serif" })).ok, true);
  assert.deepEqual([await getSetting("theme.fontBody"), await getSetting("theme.font")], ["sys:serif", undefined]);
  assert.match(await sheet(), new RegExp(`--v-font:${"ui-serif".replace("-", "\\-")}`), "ce que voient les visiteurs n'a pas changé");
});

// ── service ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("service : les deux formes d'adresse sont servies avec le bon type, nosniff, un cache éternel ; HEAD aussi ; tout le reste est introuvable", async () => {
  const up = await add(KALAM4);
  const family = loadLibrary().byId.get("inter");
  const file = family.files.find((f) => f.weight === 400 && f.subset === "latin");
  const get = (name, method = "GET") => route[method](new Request(`http://localhost/fonts/${name}`, { method }), { params: Promise.resolve({ file: name }) });
  for (const name of [urlNameOf(file), `u-${up.font.id}.woff2`]) {
    const res = await get(name);
    assert.equal(res.status, 200, name);
    assert.deepEqual([res.headers.get("content-type"), res.headers.get("x-content-type-options"), res.headers.get("cache-control")], ["font/woff2", "nosniff", "public, max-age=31536000, immutable"], name);
    assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
    assert.equal(res.headers.get("cross-origin-resource-policy"), "same-origin");
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 4).toString(), "wOF2");
    assert.equal(String(body.length), res.headers.get("content-length"));
    const head = await get(name, "HEAD");
    assert.deepEqual([head.status, head.headers.get("content-type"), (await head.arrayBuffer()).byteLength], [200, "font/woff2", 0]);
  }
  const wrongHash = urlNameOf(file).replace(/\.[0-9a-f]{10}\./, ".0000000000.");
  for (const bad of ["library.json", "CREDITS.md", "../package.json", "..%2Fpackage.json", "inter-400-latin.woff2", wrongHash, "inter-500-latin.0123456789.woff2", ".woff2", "u-0123456789abcdef.woff2", "u-ZZZZZZZZZZZZZZZZ.woff2", `u-${up.font.id}.woff`, `U-${up.font.id}.woff2`, "x".repeat(200), "LICENSES", "files"]) {
    assert.equal((await get(bad)).status, 404, bad);
    assert.equal(Serve.resolveFontAsset(bad), null, bad);
  }
  assert.equal((await get("library.json")).headers.get("x-content-type-options"), "nosniff");
  // un lien symbolique dans le dossier des envois ne mène jamais hors de ce dossier
  fs.writeFileSync(path.join(db.dir, "secret.txt"), "secret");
  fs.symlinkSync(path.join(db.dir, "secret.txt"), path.join(FONTS, "u-aaaaaaaaaaaaaaaa.woff2"));
  assert.equal((await get("u-aaaaaaaaaaaaaaaa.woff2")).status, 404);
});

test("service : chemin réservé (aucune collection ni lien court ne peut s'appeler « fonts ») ; aucun site tiers dans les sources", async () => {
  const { RESERVED_PATHS } = await import("@/core/config");
  assert.ok(RESERVED_PATHS.has("fonts"));
  for (const f of ["src/core/fonts/css.ts", "src/core/fonts/serve.ts", "src/core/fonts/library.ts", "src/app/admin/(panel)/appearance/FontPickers.tsx", "src/app/admin/(panel)/appearance/FontUpload.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /googleapis|gstatic|fonts\.google|cdn\.|jsdelivr|unpkg|https?:\/\//i, f);
  }
});

// ── rendu ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("rendu : rien de choisi = la feuille d'avant, sans la moindre police ; titres ≠ texte quand on les choisit ; seules les polices choisies sont chargées, depuis le site", async () => {
  const none = await sheet();
  assert.ok(!none.includes("@font-face") && !none.includes("cf-"), "aucune règle de police tant qu'on n'en choisit pas");
  await setSetting("theme.fontBody", "lib:inter");
  await setSetting("theme.fontHeading", "lib:bitter");
  const css = await sheet();
  assert.match(css, /--v-font:"cf-inter", ui-sans-serif/);
  assert.match(css, /--sk-font-heading:"cf-bitter", ui-serif/);
  const used = faces(css).map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), ["cf-bitter", "cf-inter"], "seules les deux polices choisies");
  assert.equal(used.length, 8, "quatre fichiers chacune (400 et 700, latin et latin étendu)");
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) assert.match(m[1], /^\/fonts\/[a-z0-9-]+-(?:400|700)-(?:latin|latin-ext)\.[0-9a-f]{10}\.woff2$/, "adresses du site, avec empreinte");
  assert.doesNotMatch(css, /https?:\/\//, "aucun site tiers");
  assert.equal((css.match(/font-display:swap/g) ?? []).length, 8);
  assert.match(css, /unicode-range:U\+0000-00FF/);
  assert.ok(css.endsWith(BRAND_MARK_CSS), "la police de marque du mot Curiosa passe toujours en dernier");
  assert.doesNotMatch(BRAND_MARK_CSS, /cf-|--v-font|--sk-font-heading/, "et ne lit jamais ces variables");
  // même police pour les deux : ses règles ne sont écrites qu'une fois
  await setSetting("theme.fontHeading", "lib:inter");
  assert.equal(faces(await sheet()).length, 4);
  // le texte seul : les titres suivent le texte (comme sous basic)
  await db.prisma.setting.deleteMany({ where: { key: "theme.fontHeading" } });
  const bodyOnly = await sheet();
  assert.match(bodyOnly, /--v-font:"cf-inter"/);
  assert.match(bodyOnly, /--sk-font-heading:var\(--v-font\)/);
});

test("rendu : une police envoyée est chargée depuis /fonts/u-…, avec sa graisse et son style ; une police disparue ou inconnue est lue « celle du skin », sans erreur", async () => {
  const a = await add(KALAM4), b = await add(KALAM7);
  await setSetting("theme.fontBody", "up:kalam");
  const css = await sheet();
  assert.match(css, /--v-font:"cf-up-kalam", ui-sans-serif/);
  assert.match(css, new RegExp(`@font-face\\{font-family:"cf-up-kalam";font-style:normal;font-weight:400;font-display:swap;src:url\\(/fonts/u-${a.font.id}\\.woff2\\) format\\("woff2"\\)\\}`));
  assert.match(css, new RegExp(`font-weight:700;[^}]*u-${b.font.id}`));
  await setSetting("theme.fontBody", "lib:n-existe-pas");
  assert.ok(!(await sheet()).includes("cf-"));
  await setSetting("theme.fontBody", "up:fantome");
  assert.ok(!(await sheet()).includes("cf-"));
  await setSetting("theme.fontBody", "<script>alert(1)</script>");
  assert.ok(!(await sheet()).includes("<script"));
  await setSetting("theme.fontFiles", [{ id: "../../x", family: "x", slug: "x", weight: "400", style: "normal" }, { id: a.font.id, family: "</style>", slug: "ok", weight: "400}", style: "normal" }]);
  await setSetting("theme.fontBody", "up:ok");
  assert.ok(!(await sheet()).includes("cf-up-ok"), "une liste altérée n'écrit rien dans la feuille");
});

test("compatibilité : theme.font seul s'applique comme avant ; theme.fontBody l'emporte dessus ; sans rien, rien", async () => {
  const before = await sheet();
  await setSetting("theme.font", "mono");
  const legacy = await sheet();
  assert.match(legacy, /--v-font:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace/);
  assert.notEqual(legacy, before);
  await setSetting("theme.fontBody", "lib:lexend");
  const both = await sheet();
  assert.match(both, /--v-font:"cf-lexend"/);
  assert.doesNotMatch(both, /--v-font:ui-monospace/);
  await db.prisma.setting.deleteMany({ where: { key: "theme.fontBody" } });
  assert.equal(await sheet(), legacy, "retirer le nouveau choix rend l'ancien");
  await db.prisma.setting.deleteMany({ where: { key: "theme.font" } });
  assert.equal(await sheet(), before);
});

test("skins : un skin garde ses polices tant qu'on ne retouche pas ; la retouche l'emporte ; les titres du skin restent si on ne choisit que le texte", async () => {
  const tokens = { light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: {}, common: { "--v-font": 'Georgia, "Times New Roman", serif', "--sk-font-heading": '"Palatino Linotype", Palatino, serif' }, modules: {} };
  await cat.publish("serifs", { from: "plain-light", files: { "tokens.json": JSON.stringify(tokens) } });
  assert.equal((await S.installFromCatalogue("serifs")).ok, true);
  assert.equal((await A.chooseSkin("serifs")).ok, true);
  const own = await sheet();
  assert.match(own, /--v-font:Georgia, "Times New Roman", serif/);
  assert.match(own, /--sk-font-heading:"Palatino Linotype", Palatino, serif/);
  assert.ok(!own.includes("@font-face"));
  await setSetting("theme.fontBody", "lib:inter");
  const body = await sheet();
  assert.match(body, /--v-font:"cf-inter"/);
  assert.match(body, /--sk-font-heading:"Palatino Linotype"/, "les titres du skin restent");
  assert.deepEqual(faces(body).map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), ["cf-inter"]);
  await setSetting("theme.fontHeading", "lib:anton");
  assert.match(await sheet(), /--sk-font-heading:"cf-anton", ui-sans-serif/);
  // la vue de la page : les polices du skin pour l'aperçu de « celle du skin »
  const view = await V.loadAppearanceView();
  assert.deepEqual(view.fonts.skin, { body: 'Georgia, "Times New Roman", serif', heading: '"Palatino Linotype", Palatino, serif', headingFollowsBody: false });
  assert.deepEqual([view.raw.fontBody, view.raw.fontHeading, view.retouched], ["lib:inter", "lib:anton", true]);
  // « Revenir au skin » efface les polices choisies ; les polices envoyées restent
  await add(KALAM4);
  assert.equal((await A.resetToSkin({ actor: "o" })).ok, true);
  assert.deepEqual([await getSetting("theme.fontBody"), await getSetting("theme.fontHeading")], [undefined, undefined]);
  assert.equal((await U.listUploads()).length, 1);
  assert.match(await sheet(), /--v-font:Georgia/);
  assert.equal((await A.undoLastChange()).ok, true);
  assert.deepEqual([await getSetting("theme.fontBody"), await getSetting("theme.fontHeading")], ["lib:inter", "lib:anton"], "« Annuler » les rend");
});

test("basic : la vue dit que les titres suivent le texte ; choisir un autre skin met les polices de côté", async () => {
  const view = await V.loadAppearanceView();
  assert.equal(view.fonts.skin.headingFollowsBody, true);
  assert.equal(view.fonts.skin.heading, view.fonts.skin.body);
  await setSetting("theme.fontBody", "lib:inter");
  await cat.publish("plain-light", { from: "plain-light" });
  assert.equal((await S.installFromCatalogue("plain-light")).ok, true);
  assert.equal((await A.chooseSkin("plain-light")).ok, true);
  assert.equal(await getSetting("theme.fontBody"), undefined);
  assert.ok(!(await sheet()).includes("cf-inter"));
});

// ── sauvegarde ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const restore = (b) => Rs.applyRestore(Rs.openBackup(b.buffer, PW, 1000).backup, { confirmCustom: [], actor: "owner@example.org" });
async function owner() {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "fr", advanced: true } });
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); await setSetting("setup.completed", true);
}

test("sauvegarde : les polices envoyées voyagent avec les réglages et sont revérifiées à la restauration ; une sauvegarde sans police efface celles du site", async () => {
  await db.reset();
  await owner();
  const a = await add(KALAM4), b = await bitter(BITTER7);
  await setSetting("theme.fontBody", "up:kalam");
  await setSetting("theme.fontHeading", "lib:oswald");
  const backup = await B.createBackup(PW, { iterations: 1000 });
  const paths = backup.manifest.files.map((f) => f.path);
  assert.deepEqual(paths.filter((p) => p.startsWith("fonts/")).sort(), [`fonts/u-${a.font.id}.woff2`, `fonts/u-${b.font.id}.woff2`].sort());
  assert.equal(backup.manifest.counts.fonts, 2);
  for (const f of backup.manifest.files.filter((x) => x.path.startsWith("fonts/"))) assert.equal(f.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(FONTS, path.basename(f.path)))).digest("hex"), "empreinte du fichier");
  // un site neuf
  await db.reset(); fs.rmSync(FONTS, { recursive: true, force: true });
  const report = await restore(backup);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual((await U.listUploads()).map((f) => f.id).sort(), [a.font.id, b.font.id].sort());
  assert.ok(fs.readFileSync(path.join(FONTS, `u-${a.font.id}.woff2`)).equals(KALAM4));
  assert.deepEqual([await getSetting("theme.fontBody"), await getSetting("theme.fontHeading")], ["up:kalam", "lib:oswald"]);
  assert.match(await sheet(), /--v-font:"cf-up-kalam"/);
  // une sauvegarde faite sans police : la restauration efface celles du site
  await db.reset(); fs.rmSync(FONTS, { recursive: true, force: true });
  await owner();
  const none = await B.createBackup(PW, { iterations: 1000 });
  assert.equal(none.manifest.counts.fonts, undefined, "pas de clé quand il n'y a rien");
  assert.equal(none.manifest.files.some((f) => f.path.startsWith("fonts/")), false);
  await add(KALAM4);
  assert.equal((await restore(none)).ok, true);
  assert.deepEqual([fs.existsSync(FONTS) ? fs.readdirSync(FONTS) : [], await U.listUploads()], [[], []]);
});

test("restauration : un fichier qui n'est plus une vraie police, une entrée sans fichier, un fichier sans entrée → remis d'accord, jamais servi tel quel", async () => {
  const a = await add(KALAM4), b = await bitter(BITTER4);
  await setSetting("theme.fontBody", "up:kalam");
  fs.writeFileSync(path.join(FONTS, `u-${a.font.id}.woff2`), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)]));      // abîmé
  fs.rmSync(path.join(FONTS, `u-${b.font.id}.woff2`));                                                                      // absent
  fs.writeFileSync(path.join(FONTS, "u-ffffffffffffffff.woff2"), INTER4);                                                    // orphelin
  const r = await U.reconcileUploads();
  assert.deepEqual(r, { kept: 0, dropped: 2 });
  assert.deepEqual([fs.readdirSync(FONTS), await U.listUploads(), await getSetting("theme.fontBody")], [[], [], undefined]);
});

test("envoi .ttf et .otf : convertis en WOFF2 (seul du WOFF2 est stocké et servi) ; trop lourd après conversion ou avant = refus avec la marche à suivre", async () => {
  const TTF = fs.readFileSync("tests/fixtures/fonts/kalam.ttf"), OTF = fs.readFileSync("tests/fixtures/fonts/anton-sub.otf");
  const a = await add(TTF);
  assert.equal(a.ok, true, JSON.stringify(a));
  const stored = fs.readFileSync(path.join(FONTS, `u-${a.font.id}.woff2`));
  assert.equal(stored.subarray(0, 4).toString(), "wOF2");
  assert.equal(crypto.createHash("sha256").update(stored).digest("hex").slice(0, 16), a.font.id);
  assert.equal((await add(OTF)).ok, true);
  assert.equal((await add(TTF)).code, "duplicate", "même police envoyée deux fois");
  assert.equal((await add(Buffer.concat([TTF, Buffer.alloc(500 * 1024)]))).code, "too-large");
  assert.equal((await add(Buffer.concat([Buffer.from("ttcf"), Buffer.alloc(200)]))).code, "collection");
  assert.equal((await add(Buffer.from("wOFF" + "x".repeat(200)))).ok, false);
  assert.equal(fs.readdirSync(FONTS).length, 2, "seulement les deux WOFF2");
  const r = await actions.uploadFontAction(null, form({ license: "on", font: new File([Buffer.concat([TTF, Buffer.alloc(500 * 1024)])], "gros.ttf") }));
  assert.match(r.errors.font, /Convertissez-le en \.woff2.*« ttf vers woff2 »/);
});

test("structure de la page : l'envoi est DANS la section Polices (sous les deux listes), chaque liste finit par « Utiliser ma propre police… », « Mes polices » vient en tête, le nom est sous « Plus d'options »", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/appearance/page.tsx", "utf8");
  assert.match(page, /data-testid="fonts-card" id="polices"[\s\S]*?<FontPickers[\s\S]*?uploadSlot=\{<FontUpload/, "le formulaire d'envoi est un enfant de la carte Polices");
  assert.doesNotMatch(page, /<FontUpload t=\{t\} uploads=/, "plus de bloc d'envoi séparé plus bas");
  assert.match(page, /<ActionForm id="retouches-form"/);
  const pick = fs.readFileSync("src/app/admin/(panel)/appearance/FontPickers.tsx", "utf8");
  assert.match(pick, /name="fontHeading" form=\{formId\}/);
  assert.match(pick, /role="listbox"[\s\S]*?data-testid=\{`font-own-\$\{role\}`\}[\s\S]*?appearance\.font\.useOwn/, "la ligne d'envoi vient après la liste, dans le même panneau");
  assert.match(pick, /input\?\.focus\(\)/, "le champ fichier reçoit le focus");
  assert.match(pick, /askConfirm\(al\("appearance\.font\.deleteConfirm"/);
  const up = fs.readFileSync("src/app/admin/(panel)/appearance/FontUpload.tsx", "utf8");
  assert.match(up, /accept="\.woff2,\.otf,\.ttf/);
  assert.match(up, /<MoreOptions[\s\S]*?name="fontName"/);
  assert.ok(up.indexOf('name="license"') < up.indexOf("<MoreOptions"), "fichier et case d'abord, nom ensuite");
  const model = fs.readFileSync("src/app/admin/(panel)/appearance/fontModel.ts", "utf8");
  assert.ok(model.indexOf('id: "mine"') < model.indexOf('id: "system"'), "« Mes polices » en tête");
  assert.match(fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8"), /\/admin\/appearance#polices/);
});
