import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Réseaux sociaux (0.6.1) : adresse vérifiée AVANT d'être enregistrée (sous le champ, avec un exemple), aperçu du bouton après l'enregistrement, réseaux masqués / ordre
// (réglages du cœur ajoutés, aucune migration), compteur « n sur 10 », page en un seul tableau avec recherche en direct, deuxième compte sans rien taper.
const db = await useTestDb();
const S = await import("@/core/social");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { getInstanceById } = await import("@/core/instances");

beforeEach(() => db.reset());
after(() => db.close());

/* ───────────── pur ───────────── */

test("ordre : les réseaux de la liste d'abord, ceux qui n'existent plus oubliés, les nouveaux à la suite ; un cran vers le haut ou le bas, rien aux extrémités", () => {
  assert.deepEqual(S.orderedKeys(["a", "b", "c"], []), ["a", "b", "c"]);
  assert.deepEqual(S.orderedKeys(["a", "b", "c"], ["c", "gone", "a"]), ["c", "a", "b"]);
  assert.deepEqual(S.orderedKeys(["a", "b"], ["b", "b", "a"]), ["b", "a"], "doublon ignoré");
  assert.deepEqual(S.moveKey(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(S.moveKey(["a", "b", "c"], "b", "down"), ["a", "c", "b"]);
  assert.deepEqual(S.moveKey(["a", "b", "c"], "a", "up"), ["a", "b", "c"]);
  assert.deepEqual(S.moveKey(["a", "b", "c"], "c", "down"), ["a", "b", "c"]);
  assert.deepEqual(S.moveKey(["a", "b"], "zzz", "up"), ["a", "b"]);
});

test("origine : réseau, chaîne en direct, autre plateforme", () => {
  assert.equal(S.socialOrigin({ id: "instagram", type: "social" }), "network");
  assert.equal(S.socialOrigin({ id: "twitch-channel", type: "social" }), "channel");
  assert.equal(S.socialOrigin({ id: "youtube-channel" }), "channel");
  assert.equal(S.socialOrigin({ id: "platform-links", type: "content" }), "other");
});

/* ───────────── un site : réseaux installés ───────────── */

const manifest = (id, over = {}) => ({
  apiVersion: 2, version: "1.0.0", id, name: { fr: id, en: id }, type: "social", instances: "multiple", provides: [{ topic: "social.link" }], main: "index.mjs",
  settings: [{ key: "profile", type: "text", label: { fr: "Adresse de votre profil", en: "Your profile address" }, example: { fr: `https://${id}.example/monpseudo`, en: `https://${id}.example/myname` } }], ...over,
});
// Un faux réseau : n'accepte que `https://<id>.example/<nom>` ou un nom seul, comme les vrais modules.
const code = (id) => `export default { exports: { "social.link": (ctx) => { const v = String(ctx.setting("profile") ?? "").trim(); const m = new RegExp("^(?:https://${id}\\\\.example/)?([a-z0-9]+)$").exec(v); return m ? [{ label: "${id} · " + m[1], url: "https://${id}.example/" + m[1], icon: "${id}" }] : []; } } };`;
async function network(id, profile, nickname) {
  if (!(await R.getModule(id))) assert.equal((await installModule(makeRepo({ "module.json": manifest(id), "index.mjs": code(id) }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule(id);
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, nickname, names: { fr: nickname ?? id, en: nickname ?? id } });
  if (profile) await setSetting(`instance.${inst.id}.profile`, profile);
  return { mod, inst };
}
const form = (inst, entries) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of entries) fd.append(k, v); return fd; };
async function admin(role = "owner") {
  const u = await db.prisma.user.create({ data: { email: `${role}@example.org`, name: "Adam", role, passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
}

test("en-tête : un réseau masqué n'apparaît plus, l'ordre choisi est suivi, la limite et les doublons sont dits — sans toucher aux instances", async () => {
  const a = await network("alpha", "un"), b = await network("beta", "deux"), c = await network("gamma", "trois");
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["alpha · un", "beta · deux", "gamma · trois"], "ordre des instances par défaut");
  await setSetting(S.SOCIAL_ORDER_KEY, [c.inst.key, a.inst.key]);
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["gamma · trois", "alpha · un", "beta · deux"], "la liste d'abord, les autres à la suite");
  await setSetting(S.SOCIAL_HIDDEN_KEY, [a.inst.key]);
  const entries = await S.loadSocialEntries("en");
  assert.deepEqual(entries.map((e) => [e.link.label, e.status]), [["gamma · trois", "shown"], ["alpha · un", "hidden"], ["beta · deux", "shown"]]);
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["gamma · trois", "beta · deux"]);
  assert.equal((await S.loadSocialEntries("en", 1)).filter((e) => e.status === "limit").length, 1, "au-delà de la limite : dit, pas oublié");
  // Même adresse qu'un autre bouton : le second est « doublon », pas silencieusement écarté.
  const d = await network("beta", "deux", "Beta bis");
  const dup = (await S.loadSocialEntries("en")).filter((e) => e.link.href === "https://beta.example/deux");
  assert.deepEqual(dup.map((e) => e.status).sort(), ["duplicate", "shown"]);
  void b; void d;
  // Aucune instance modifiée : les réglages du cœur sont de simples listes de clés.
  assert.deepEqual((await getSettingByLocale(S.SOCIAL_HIDDEN_KEY))[""], [a.inst.key]);
});

test("en-tête : sans réglage, rien ne change (aucun réseau masqué, ordre des instances) et un réglage abîmé est ignoré", async () => {
  await network("alpha", "un"); await network("beta", "deux");
  await setSetting(S.SOCIAL_HIDDEN_KEY, "pas une liste"); await setSetting(S.SOCIAL_ORDER_KEY, { a: 1 });
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["alpha · un", "beta · deux"]);
});

test("réglages d'un réseau : une adresse non reconnue est refusée SOUS LE CHAMP avec un exemple, rien n'est enregistré, la saisie est gardée", async () => {
  await admin("admin");
  const { inst } = await network("alpha", "avant");
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const bad = await saveInstanceSettings(null, form(inst, [["s__profile", "https://autre.example/x y"]]));
  assert.match(bad.errors?.s__profile ?? "", /alpha/);
  assert.match(bad.errors.s__profile, /https:\/\/alpha\.example\/(monpseudo|myname)/, "l'exemple du module est dans le message");
  assert.ok(!/erreur|error 5|undefined/i.test(bad.errors.s__profile.replace(/This address is not a alpha one\./, "")), "pas de jargon");
  assert.equal((await getSettingByLocale(`instance.${inst.id}.profile`))[""], "avant", "rien n'a été écrit");
  assert.equal(bad.ok, undefined);
});

test("réglages d'un réseau : une adresse reconnue est enregistrée et le message montre le bouton qui s'affichera ; vider le champ reste permis", async () => {
  await admin("admin");
  const { inst } = await network("alpha", null);
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const ok = await saveInstanceSettings(null, form(inst, [["s__profile", "https://alpha.example/moi"]]));
  assert.match(ok.ok ?? JSON.stringify(ok), /alpha · moi/);
  assert.equal((await getSettingByLocale(`instance.${inst.id}.profile`))[""], "https://alpha.example/moi");
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["alpha · moi"]);
  const empty = await saveInstanceSettings(null, form(inst, [["s__profile", ""]]));
  assert.ok(empty.ok && !/alpha/.test(empty.ok), JSON.stringify(empty));
  assert.deepEqual(await S.loadSocialLinks("en"), []);
});

test("réglages d'un réseau : un module qui n'est pas un réseau social n'est pas concerné (même clé « profile »)", async () => {
  await admin("admin");
  const m = manifest("autre", { type: undefined, provides: [], settings: [{ key: "profile", type: "text", label: "Profil" }] });
  assert.equal((await installModule(makeRepo({ "module.json": m, "index.mjs": "export default {};" }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule("autre");
  const inst = await createInstance(db.prisma, { manifest: mod.manifest, nickname: undefined, names: { fr: "Autre" } });
  const { saveInstanceSettings } = await import("@/app/admin/(panel)/instances/actions");
  const ok = await saveInstanceSettings(null, form(inst, [["s__profile", "n'importe quoi"]]));
  assert.ok(ok.ok, JSON.stringify(ok));
});

test("actions de la page : masquer / montrer, monter / descendre — réservées à l'administration, journalisées, sans toucher aux instances", async () => {
  const { setSocialShown } = await import("@/app/admin/(panel)/social/actions");
  await admin("admin");
  const a = await network("alpha", "un"), b = await network("beta", "deux");
  assert.ok((await setSocialShown(a.inst.key, false)).ok);
  assert.deepEqual((await getSettingByLocale(S.SOCIAL_HIDDEN_KEY))[""], [a.inst.key]);
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["beta · deux"]);
  assert.ok((await setSocialShown(a.inst.key, true)).ok);
  assert.deepEqual((await getSettingByLocale(S.SOCIAL_HIDDEN_KEY))[""], []);
  assert.ok((await setSocialShown("n-existe-pas", false)).error, "réseau inconnu : message, pas d'écriture");
  const { moveSocial } = await import("@/app/admin/(panel)/social/actions");
  await assert.rejects(() => moveSocial(b.inst.key, "up"), /NEXT_REDIRECT/);
  assert.deepEqual((await getSettingByLocale(S.SOCIAL_ORDER_KEY))[""], [b.inst.key, a.inst.key]);
  assert.deepEqual((await S.loadSocialLinks("en")).map((l) => l.label), ["beta · deux", "alpha · un"]);
  assert.ok((await db.prisma.auditLog.findMany({ where: { action: { in: ["social.hide", "social.show", "social.move"] } } })).length >= 3);
});

test("deuxième compte du même réseau : les surnoms sont donnés d'office (« alpha », « alpha 2 »), la personne ne tape rien", async () => {
  const { addNetwork } = await import("@/app/admin/(panel)/social/actions");
  await admin("owner");
  await network("alpha", "un");   // premier compte, sans surnom
  await assert.rejects(() => addNetwork("alpha"), /NEXT_REDIRECT/);
  const rows = await db.prisma.moduleInstance.findMany({ where: { moduleId: "alpha" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => r.nickname), ["alpha", "alpha 2"]);
  await assert.rejects(() => addNetwork("alpha"), /NEXT_REDIRECT/);
  assert.deepEqual((await db.prisma.moduleInstance.findMany({ where: { moduleId: "alpha" }, orderBy: { createdAt: "asc" } })).map((r) => r.nickname), ["alpha", "alpha 2", "alpha 3"]);
});

/* ───────────── la page ───────────── */

const page = fs.readFileSync("src/app/admin/(panel)/social/page.tsx", "utf8");
const dict = (l) => JSON.parse(fs.readFileSync(`src/locales/${l}.json`, "utf8"));

test("page : un seul tableau (Réseau, Adresse, Origine, Affiché, Ordre), recherche en direct dès le départ, interrupteur d'état, ordre au clavier, compteur, plus de champ « Nom » ni de nom coupé", () => {
  assert.equal((page.match(/<table/g) ?? []).length, 1, "R30 : un seul tableau pour tous les réseaux");
  assert.match(page, /<LiveSearch scope="social"/);
  assert.match(page, /<LiveSearch scope="social-add"/);
  assert.match(page, /SocialSwitch/);
  assert.match(page, /moveSocial\.bind\(null, r\.key, dir\)/);
  assert.match(page, /social\.count/);
  assert.ok(!/name="nickname"/.test(page), "plus de champ « Nom » sur chaque carte");
  assert.ok(!/social\.nickname/.test(page));
  // le nom d'un réseau n'est jamais coupé (R19) ; l'adresse l'est, avec l'info-bulle complète (R16)
  assert.match(page, /break-words">\{r\.name\}/);
  assert.match(page, /truncate[^>]*title=\{r\.addresses\.join/);
  assert.match(page, /data-live-item="social" data-search=\{r\.search\} data-live-state=\{r\.state\}/);
  assert.match(page, /disabled=\{r\.state === "todo"\}/, "un réseau sans adresse ne peut pas être « affiché »");
  assert.match(page, /sm:overflow-x-auto/);
  assert.match(page, /max-sm:block/, "cartes sous 640 px");
});

test("page : textes FR et EN à parité exacte (clés et {variables}), vouvoiement, aucun point d'exclamation, aucun mot du code", () => {
  const fr = dict("fr"), en = dict("en");
  const keys = Object.keys(fr).filter((k) => k.startsWith("social."));
  assert.deepEqual(keys.sort(), Object.keys(en).filter((k) => k.startsWith("social.")).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    assert.equal(vars(fr[k]), vars(en[k]), k);
    assert.ok(!/!/.test(fr[k] + en[k]), `${k} : pas de point d'exclamation`);
    assert.ok(!/\b(clé|slug|instance|identifiant|webhook|jeton|token|api|json)\b/i.test(fr[k]), `${k} : mot du code`);
    assert.ok(fr[k].split(/[.?:]\s/).every((s) => s.split(/\s+/).length <= 22), `${k} : phrase courte`);
  }
  for (const used of page.matchAll(/t\(\s*"(social\.[A-Za-z.]+)"/g)) assert.ok(used[1] in fr, used[1]);
  for (const used of page.matchAll(/t\(\s*`(social\.[A-Za-z]+)[.\w]*\$\{/g)) assert.ok(Object.keys(fr).some((k) => k.startsWith(used[1] + ".")), used[1]);
});

test("page : la validation de l'adresse vit dans une fonction à part qui ne touche à rien (aperçu avec la valeur proposée)", async () => {
  const { a } = { a: await network("alpha", "enregistre") };
  const { previewSocialButton } = await import("@/core/socialCheck");
  const view = await getInstanceById(a.inst.id);
  assert.deepEqual(await previewSocialButton(a.mod, view, "https://alpha.example/nouveau", "fr"), { label: "alpha · nouveau", url: "https://alpha.example/nouveau" });
  assert.equal(await previewSocialButton(a.mod, view, "pas valable !", "fr"), null);
  assert.equal((await getSettingByLocale(`instance.${a.inst.id}.profile`))[""], "enregistre", "la valeur enregistrée n'a pas bougé");
});
