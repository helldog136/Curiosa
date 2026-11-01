import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Le champ unique « Collez l'adresse de votre profil » (0.7.0) : installation si besoin, instance, adresse écrite et vérifiée par le module, un réseau après l'autre,
// un échec n'empêche pas les autres ; réservé à la personne propriétaire ; le navigateur n'embarque pas la validation du manifeste.
const db = await useTestDb();
const R = await import("@/core/modules/registry");
const { installModule } = await import("@/core/modules/installer");
const { getSettingByLocale } = await import("@/core/settings");
const S = await import("@/core/social");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id, type = "social") => ({
  apiVersion: 2, version: "1.0.0", id, name: { fr: id, en: id }, type, instances: "multiple", provides: [{ topic: "social.link" }], main: "index.mjs",
  settings: [{ key: "profile", type: "text", label: { fr: "Adresse de votre profil", en: "Your profile address" } }],
});
const code = (id) => `export default { exports: { "social.link": (ctx) => { const v = String(ctx.setting("profile") ?? "").trim(); const m = new RegExp("^(?:https://${id}\\\\.example/)?([a-z0-9]+)$").exec(v); return m ? [{ label: "${id} · " + m[1], url: "https://${id}.example/" + m[1], icon: "${id}" }] : []; } } };`;
async function install(id, type) { assert.equal((await installModule(makeRepo({ "module.json": manifest(id, type), "index.mjs": code(id) }).url, { dependencies: false })).ok, true); }
async function login(role = "owner") {
  const u = await db.prisma.user.create({ data: { email: `${role}@example.org`, name: "Adam", role, passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
}
const profileOf = async (inst) => (await getSettingByLocale(`instance.${inst.id}.profile`))[""];
const instances = (moduleId) => db.prisma.moduleInstance.findMany({ where: { moduleId }, orderBy: { createdAt: "asc" } });

test("un réseau installé : l'instance est créée, l'adresse est écrite telle que collée et le bouton s'affiche", async () => {
  const { addNetworkWithProfile } = await import("@/app/admin/(panel)/social/actions");
  await login(); await install("alpha");
  const res = await addNetworkWithProfile("alpha", "https://alpha.example/moi");
  assert.deepEqual(res, { ok: true, label: "alpha · moi" });
  const [inst] = await instances("alpha");
  assert.equal(await profileOf(inst), "https://alpha.example/moi");
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["alpha · moi"]);
  assert.equal(inst.nickname, null, "un seul compte : aucun surnom demandé");
});

test("plusieurs réseaux, l'un après l'autre : un deuxième compte du même réseau reçoit un surnom d'office, un échec n'empêche pas les suivants", async () => {
  const { addNetworkWithProfile } = await import("@/app/admin/(panel)/social/actions");
  await login(); await install("alpha"); await install("beta");
  const out = [];
  for (const [id, addr] of [["alpha", "un"], ["beta", "https://beta.example/deux"], ["alpha", "trois"], ["beta", "pas valable !"], ["alpha", "quatre"]]) out.push(await addNetworkWithProfile(id, addr));
  assert.deepEqual(out.map((r) => r.ok), [true, true, true, false, true]);
  assert.equal(out[3].added, true, "le réseau est ajouté « à régler » : la page le dit");
  assert.match(out[3].error, /beta/);
  assert.deepEqual((await instances("alpha")).map((i) => i.nickname), ["alpha", "alpha 2", "alpha 3"]);
  const beta = await instances("beta");
  assert.equal(beta.length, 2);
  assert.equal(await profileOf(beta[1]), undefined, "une adresse non reconnue n'est pas enregistrée");
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label).sort(), ["alpha · quatre", "alpha · trois", "alpha · un", "beta · deux"]);
});

test("réservé à la personne propriétaire (installation de code) ; entrées invalides et modules qui ne sont pas des réseaux refusés sans rien créer", async () => {
  const { addNetworkWithProfile } = await import("@/app/admin/(panel)/social/actions");
  await install("alpha"); await install("gadget", "widget");
  await login("admin");
  await assert.rejects(() => addNetworkWithProfile("alpha", "moi"), "un administrateur ne peut pas installer");
  assert.equal((await instances("alpha")).length, 0);
  await db.reset(); await install("alpha"); await install("gadget", "widget"); await login("owner");
  for (const [id, addr] of [["alpha", ""], ["alpha", "x".repeat(400)], ["../etc", "moi"], ["Alpha", "moi"]]) assert.equal((await addNetworkWithProfile(id, addr)).ok, false, `${id} ${addr.slice(0, 10)}`);
  const widget = await addNetworkWithProfile("gadget", "moi");
  assert.equal(widget.ok, false);
  assert.equal((await instances("alpha")).length + (await instances("gadget")).length, 0);
  const missing = await addNetworkWithProfile("inconnu", "moi");
  assert.equal(missing.ok, false);
  assert.ok(missing.error && !/modules\.error/.test(missing.error), "un message en clair, jamais une clé");
});

const read = (f) => fs.readFileSync(f, "utf8");
const dict = (l) => JSON.parse(read(`src/locales/${l}.json`));

test("page : le champ unique est en tête, alimenté par le Catalogue (bloc social), la liste « Ajouter un réseau » reste en secours", () => {
  const page = read("src/app/admin/(panel)/social/page.tsx");
  assert.match(page, /<SocialPaste sources=\{sources\}/);
  assert.match(page, /socialSourcesOf\(market\)/);
  assert.match(page, /canInstall=\{isOwner\}/);
  assert.ok(page.indexOf("<SocialPaste") < page.indexOf('id="social-mine"'), "le champ est avant le tableau");
  assert.match(page, /<LiveSearch scope="social-add"/);
});

test("champ : reconnaissance en direct, aperçu, progression annoncée, un seul bouton principal au verbe précis, rien de validé côté navigateur", () => {
  const c = read("src/components/admin/SocialPaste.tsx");
  assert.match(c, /recognizeSocial\(text, sources\)/);
  assert.match(c, /aria-live="polite"/);
  assert.match(c, /labels\.addOne/);
  assert.match(c, /addNetworkWithProfile\(r\.id, r\.text\)/);
  assert.ok(!/from "zod"|socialSpec"/.test(c), "le navigateur n'embarque pas zod");
  assert.ok(!/socialSpec/.test(read("src/core/socialRecognize.ts").replace(/import type \{ SocialSpec \} from "\.\/socialSpec";/, "")), "socialRecognize n'importe socialSpec que pour le type");
  assert.match(c, /router\.refresh\(\)/);
  assert.match(c, /<label htmlFor=\{id\}/, "un libellé relié au champ (R28)");
  assert.match(c, /disabled=\{busy \|\| ready\.length === 0\}/);
});

test("textes du champ : FR et EN à parité, aide ≤ 60 caractères, vouvoiement, aucun point d'exclamation, aucun mot du code", () => {
  const fr = dict("fr"), en = dict("en");
  const keys = Object.keys(fr).filter((k) => k.startsWith("social.paste."));
  assert.ok(keys.length >= 15);
  assert.deepEqual(keys.sort(), Object.keys(en).filter((k) => k.startsWith("social.paste.")).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    assert.equal(vars(fr[k]), vars(en[k]), k);
    assert.ok(!/!/.test(fr[k] + en[k]), k);
    assert.ok(!/\b(clé|slug|instance|identifiant|webhook|jeton|token|api|json|cache)\b/i.test(fr[k]), `${k} : mot du code`);
  }
  assert.equal(fr["social.paste.label"], "Collez l'adresse de votre profil");
  assert.ok(fr["social.paste.help"].length <= 60 && en["social.paste.help"].length <= 60);
  assert.ok(!/:\s*$/.test(fr["social.paste.label"]));
});
