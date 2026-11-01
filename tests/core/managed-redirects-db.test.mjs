import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// Adresses courtes gérées par un module (`shortLink`) : un module DEMANDE, le cœur crée / met à jour / retire, et ne touche JAMAIS un lien créé par la personne.
// Un faux réseau social « alpha » (comme dans social-display.test.mjs) sert de module demandeur.
const db = await useTestDb();
const { prisma } = db;
const { parseManifest } = await import("@/core/modules/manifest");
const { installModule, uninstallModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance, removeInstance } = await import("@/core/instanceService");
const { restoreInstance } = await import("@/core/modules/retired");
const M = await import("@/core/managedRedirects");
const Redirects = await import("@/core/redirects");
const { measuredHref } = await import("@/core/redirectMeasure");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { state: headerState } = await import("../helpers/stubs/next-headers.mjs");

beforeEach(async () => { await db.reset(); globalThis.curiosaRedirectGate = undefined; globalThis.curiosaRedirectMeasure = undefined; globalThis.curiosaTestSession = null; headerState.headers.clear(); });
after(() => db.close());

const SHORT = { enabled: "createShortLink", name: "shortLinkName", default: "alpha", target: "social.link" };
const manifest = (id, over = {}) => ({
  apiVersion: 2, version: "1.0.0", id, name: { fr: id, en: id }, type: "social", instances: "multiple", provides: [{ topic: "social.link" }], main: "index.mjs",
  settings: [
    { key: "profile", type: "text", label: { fr: "Adresse de votre profil", en: "Your profile address" }, example: { fr: `https://${id}.example/monpseudo`, en: `https://${id}.example/myname` } },
    { key: "createShortLink", type: "boolean", default: false, label: { fr: "Créer une adresse courte", en: "Create a short address" } },
    { key: "shortLinkName", type: "text", optional: true, rare: true, label: { fr: "Nom de l'adresse courte", en: "Short address name" }, example: { fr: "alpha-fr", en: "alpha-en" } },
  ],
  shortLink: SHORT, ...over,
});
const code = (id) => `export default { exports: { "social.link": (ctx) => { const v = String(ctx.setting("profile") ?? "").trim(); const m = new RegExp("^(?:https://${id}\\\\.example/)?([a-z0-9]+)$").exec(v); return m ? [{ label: "${id} · " + m[1], url: "https://${id}.example/" + m[1], icon: "${id}" }] : []; } } };`;
async function network(id, profile, over = {}) {
  if (!(await R.getModule(id))) assert.equal((await installModule(makeRepo({ "module.json": manifest(id, over), "index.mjs": code(id) }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule(id);
  const inst = await createInstance(prisma, { manifest: mod.manifest, names: { fr: id, en: id } });
  if (profile) await setSetting(`instance.${inst.id}.profile`, profile);
  return { mod, inst };
}
const form = (inst, entries) => { const fd = new FormData(); fd.set("id", inst.id); for (const [k, v] of entries) fd.append(k, v); return fd; };
async function admin() {
  const u = await prisma.user.create({ data: { email: "admin@example.org", name: "Adam", role: "admin", passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
}
const save = async (inst, entries) => (await import("@/app/admin/(panel)/instances/actions")).saveInstanceSettings(null, form(inst, entries));
const managedRows = () => prisma.redirect.findMany({ where: { managedBy: { not: null } } });
const mk = (path, over = {}) => prisma.redirect.create({ data: { path, targetUrl: `https://dest.example/${path}`, ...over } });

/* ───────────── le manifeste ───────────── */

test("manifeste : la clé shortLink est facultative, vérifiée avec les réglages du module, et un module sans elle ne change pas", () => {
  assert.equal(parseManifest(manifest("alpha")).ok, true);
  assert.equal(parseManifest(manifest("alpha", { shortLink: undefined })).ok, true);
  const bad = (shortLink) => parseManifest(manifest("alpha", { shortLink }));
  assert.match(bad({ ...SHORT, enabled: "profile" }).error, /shortLink.*boolean/, "l'allumage est un réglage oui/non");
  assert.match(bad({ ...SHORT, name: "createShortLink" }).error, /shortLink/, "le nom est un réglage texte");
  assert.match(bad({ ...SHORT, name: "absent" }).error, /shortLink/);
  assert.equal(bad({ ...SHORT, default: "Mauvais Nom" }).ok, false, "le nom par défaut est court et en minuscules");
  assert.equal(bad({ ...SHORT, default: "x".repeat(33) }).ok, false);
  assert.equal(bad({ ...SHORT, extra: 1 }).ok, false, "pas de clé inconnue : une seule adresse par instance");
  assert.equal(bad({ ...SHORT, target: { setting: "absent" } }).ok, false);
  assert.equal(bad({ ...SHORT, target: { setting: "profile" } }).ok, true, "ou un réglage texte du module");
  assert.match(parseManifest(manifest("alpha", { provides: [] })).error, /social\.link/, "social.link exige que le module fournisse ce sujet");
});

/* ───────────── création ───────────── */

test("par défaut rien n'est créé ; allumé, l'adresse courte mène à l'adresse du bouton et porte l'instance qui la gère", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  assert.deepEqual((await M.reconcileManaged()).created, [], "réglage éteint : aucune adresse");
  assert.equal(await prisma.redirect.count(), 0);
  const ok = await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.match(ok.ok ?? JSON.stringify(ok), /\/alpha\b/, "le message donne l’adresse prête");
  const rows = await managedRows();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].path, rows[0].targetUrl, rows[0].managedBy, rows[0].active, rows[0].permanent], ["alpha", "https://alpha.example/moi", inst.id, true, false]);
  const log = await prisma.auditLog.findMany({ where: { action: "redirect.managed.create" } });
  assert.equal(log.length, 1);
  assert.equal(log[0].module, "alpha");
  assert.equal(log[0].actorKind, "module");
  assert.equal((await Redirects.resolveRedirect("alpha"))?.url, "https://alpha.example/moi", "elle redirige vraiment");
});

test("sans destination (adresse du bouton vide), rien n'est créé ; elle apparaît dès que la destination existe", async () => {
  await admin();
  const { inst } = await network("alpha", null);
  await save(inst, [["s__createShortLink", "on"]]);
  assert.equal(await prisma.redirect.count(), 0);
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal((await managedRows()).length, 1);
});

test("un nom personnalisé est utilisé ; vide, c'est le nom par défaut du module", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"], ["s__shortLinkName", " Alpha-FR "]]);
  assert.deepEqual((await managedRows()).map((r) => r.path), ["alpha-fr"]);
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"], ["s__shortLinkName", ""]]);
  assert.deepEqual((await managedRows()).map((r) => r.path), ["alpha"], "renommée sur place");
});

/* ───────────── conflit : on ne touche jamais un lien de la personne ───────────── */

test("nom déjà pris par un lien de la personne : refusé sous le champ avec un exemple, rien n'est écrit, son lien est intact", async () => {
  await admin();
  const mine = await mk("alpha", { hits: 7, permanent: true });
  const { inst } = await network("alpha", "https://alpha.example/moi");
  const bad = await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  // Le champ du nom (replié sous « Plus d'options », qui s'ouvre sur une erreur) porte le message : c'est lui qu'il faut changer.
  assert.match(bad.errors?.s__shortLinkName ?? "", /\/alpha/);
  assert.match(bad.errors.s__shortLinkName, /alpha-2/, "un exemple de nom libre");
  assert.match(bad.errors.s__shortLinkName, /Raccourcis de liens|Link shortcuts/, "dit où est l'autre lien");
  assert.equal((await getSettingByLocale(`instance.${inst.id}.createShortLink`))[""], undefined, "rien n'est enregistré");
  // Sous le champ du nom quand c'est lui que la personne a rempli.
  const bad2 = await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"], ["s__shortLinkName", "alpha"]]);
  assert.match(bad2.errors?.s__shortLinkName ?? "", /alpha-2/);
  const after = await prisma.redirect.findUnique({ where: { id: mine.id } });
  assert.deepEqual([after.targetUrl, after.hits, after.permanent, after.active, after.managedBy], ["https://dest.example/alpha", 7, true, true, null]);
  assert.equal(await prisma.redirect.count(), 1);
});

test("conflit découvert plus tard (réglage déjà allumé, lien créé ensuite) : aucune création, le conflit est rapporté, le lien de la personne est intact", async () => {
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await setSetting(`instance.${inst.id}.createShortLink`, true);
  await mk("alpha", { hits: 3 });
  const res = await M.reconcileManaged();
  assert.deepEqual(res.created, []);
  assert.equal(res.issues.length, 1);
  assert.deepEqual([res.issues[0].kind, res.issues[0].path, res.issues[0].instanceId], ["taken", "alpha", inst.id]);
  assert.equal((await prisma.redirect.findUnique({ where: { path: "alpha" } })).managedBy, null);
  assert.equal((await prisma.redirect.findUnique({ where: { path: "alpha" } })).hits, 3);
});

test("nom réservé par le site ou mal écrit : refusé avec une phrase claire", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  const reserved = await save(inst, [["s__createShortLink", "on"], ["s__shortLinkName", "admin"]]);
  assert.match(reserved.errors?.s__shortLinkName ?? "", /admin/);
  assert.match(reserved.errors.s__shortLinkName, /réservé|reserves|reserved/i);
  const wrong = await save(inst, [["s__createShortLink", "on"], ["s__shortLinkName", "mon nom!"]]);
  assert.match(wrong.errors?.s__shortLinkName ?? "", /minuscules|lowercase/);
  assert.equal(await prisma.redirect.count(), 0);
});

test("deux instances qui veulent le même nom : la première l'obtient, la seconde est signalée et ne prend rien", async () => {
  const a = await network("alpha", "https://alpha.example/un");
  const b = await createInstance(prisma, { manifest: a.mod.manifest, names: { fr: "bis", en: "bis" } });
  await setSetting(`instance.${b.id}.profile`, "https://alpha.example/deux");
  for (const i of [a.inst, b]) await setSetting(`instance.${i.id}.createShortLink`, true);
  const res = await M.reconcileManaged();
  assert.equal(res.created.length, 1);
  assert.equal(res.issues.length, 1);
  assert.equal((await managedRows())[0].managedBy, a.inst.id);
});

/* ───────────── synchronisation ───────────── */

test("l'adresse du bouton change : l'adresse courte suit, c'est le même lien (mêmes compteurs) ; le nom change : renommée sur place", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  const first = (await managedRows())[0];
  await prisma.redirect.update({ where: { id: first.id }, data: { hits: 12 } });
  await save(inst, [["s__profile", "https://alpha.example/nouveau"], ["s__createShortLink", "on"]]);
  const moved = (await managedRows())[0];
  assert.deepEqual([moved.id, moved.path, moved.targetUrl, moved.hits], [first.id, "alpha", "https://alpha.example/nouveau", 12]);
  assert.equal((await prisma.redirect.findUnique({ where: { path: "alpha" } })).targetUrl, "https://alpha.example/nouveau");
  await save(inst, [["s__profile", "https://alpha.example/nouveau"], ["s__createShortLink", "on"], ["s__shortLinkName", "alpha-fr"]]);
  const renamed = (await managedRows())[0];
  assert.deepEqual([renamed.id, renamed.path, renamed.hits], [first.id, "alpha-fr", 12]);
  assert.equal(await Redirects.resolveRedirect("alpha"), null, "l'ancien nom ne répond plus");
});

test("changer d'autres réglages ne réécrit rien (aucune écriture quand tout est d'accord)", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  const before = (await managedRows())[0];
  const res = await M.reconcileManaged();
  assert.deepEqual([res.created, res.updated, res.removed], [[], [], []]);
  assert.equal((await managedRows())[0].updatedAt.getTime(), before.updatedAt.getTime());
});

test("option coupée : l'adresse est retirée avec ses compteurs, le nom redevient libre, un lien de la personne n'est pas touché", async () => {
  await admin();
  const other = await mk("autre");
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal((await managedRows()).length, 1);
  const off = await save(inst, [["s__profile", "https://alpha.example/moi"]]);
  assert.ok(off.ok, JSON.stringify(off));
  assert.equal((await managedRows()).length, 0);
  assert.equal(await prisma.redirect.findUnique({ where: { path: "alpha" } }), null);
  assert.ok(await prisma.redirect.findUnique({ where: { id: other.id } }));
  assert.equal((await Redirects.createRedirectRecord({ path: "alpha", targetUrl: "https://a.example/x" })).ok, true, "la personne peut maintenant prendre ce nom");
});

test("l'adresse du bouton est vidée : l'adresse courte est retirée", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  await save(inst, [["s__profile", ""], ["s__createShortLink", "on"]]);
  assert.equal(await prisma.redirect.count(), 0);
});

/* ───────────── pas de modification à la main ───────────── */

test("un lien géré ne se modifie, ne se désactive et ne se supprime pas à la main ; il garde son origine", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  const row = (await managedRows())[0];
  const upd = await Redirects.updateRedirectRecord(row.id, { targetUrl: "https://autre.example/" });
  assert.equal(upd.ok, false);
  assert.equal(upd.fail.key, "redirects.error.managed");
  assert.equal(await Redirects.deleteRedirectRecord(row.id), null);
  const actions = await import("@/app/admin/(panel)/redirects/actions");
  assert.match((await actions.setRedirectActive(row.id, false)).error ?? "", /extension/);
  await actions.toggleRedirect(row.id);
  await actions.reactivateRedirect(row.id);
  const same = await prisma.redirect.findUnique({ where: { id: row.id } });
  assert.deepEqual([same.active, same.targetUrl, same.managedBy], [true, "https://alpha.example/moi", inst.id]);
  // Les lignes de la personne restent modifiables comme avant.
  const mine = await mk("mien");
  assert.equal((await Redirects.updateRedirectRecord(mine.id, { targetUrl: "https://nouveau.example/" })).ok, true);
  assert.equal(await Redirects.deleteRedirectRecord(mine.id), "mien");
});

test("un assistant (outils MCP) ne peut pas non plus changer ou supprimer un lien géré", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  const { redirectsToolProvider } = await import("@/core/redirectMcp");
  const tools = await redirectsToolProvider.list();
  const tool = (n) => tools.find((t) => t.name === n);
  await assert.rejects(() => tool("redirects_update").call({ redirect: "alpha", targetUrl: "https://autre.example/" }, { name: "t" }), /extension/);
  await assert.rejects(() => tool("redirects_delete").call({ redirect: "alpha" }, { name: "t" }), /extension/);
  const listed = await tool("redirects_list").call({}, { name: "t" });
  assert.equal(listed.items.find((i) => i.path === "alpha").managedByModule, true);
  assert.equal((await managedRows()).length, 1);
});

/* ───────────── retrait de l'instance, du module ───────────── */

test("instance retirée (en gardant ses données ou en effaçant tout) : l'adresse part avec elle ; restaurée, elle revient", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal(await removeInstance(inst.id, { keepData: true }), true);
  assert.equal(await prisma.redirect.count(), 0, "plus d'adresse tant que l'instance est rangée");
  assert.equal((await restoreInstance(inst.id)).ok, true);
  assert.deepEqual((await managedRows()).map((r) => [r.path, r.managedBy]), [["alpha", inst.id]], "elle revient avec l'instance");
  assert.equal(await removeInstance(inst.id, { keepData: false }), true);
  assert.equal(await prisma.redirect.count(), 0);
});

test("module désinstallé : ses adresses partent, celles de la personne restent", async () => {
  await admin();
  const mine = await mk("mien");
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal((await uninstallModule("alpha", { keepData: true })).ok, true);
  assert.deepEqual((await prisma.redirect.findMany()).map((r) => r.id), [mine.id]);
  // Et en effaçant tout.
  const { inst: again } = await network("alpha", "https://alpha.example/moi");
  await save(again, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal((await managedRows()).length, 1);
  assert.equal((await uninstallModule("alpha", { keepData: false })).ok, true);
  assert.deepEqual((await prisma.redirect.findMany()).map((r) => r.id), [mine.id]);
});

test("un lien géré dont l'instance a disparu sans passer par ici (orphelin) est retiré à la prochaine mise en accord", async () => {
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await setSetting(`instance.${inst.id}.createShortLink`, true);
  await M.reconcileManaged();
  assert.equal((await managedRows()).length, 1);
  await prisma.moduleInstance.delete({ where: { id: inst.id } });
  assert.equal((await M.reconcileManaged()).removed.length, 1);
  assert.equal(await prisma.redirect.count(), 0);
});

/* ───────────── le bouton de l'en-tête ───────────── */

test("le bouton de l'en-tête reste celui du réseau sauf si « Compter les clics » est activé : alors il passe par l'adresse courte gérée", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  assert.equal(await measuredHref("https://alpha.example/moi"), "https://alpha.example/moi", "réglage du site éteint : aucun effet surprenant");
  await setSetting("redirects.measureLinks", true);
  const Gate = await import("@/core/redirectGate");
  Gate.invalidateRedirectGate();
  assert.equal(await measuredHref("https://alpha.example/moi"), "/alpha");
  await save(inst, [["s__profile", "https://alpha.example/moi"]]);   // option coupée
  assert.equal(await measuredHref("https://alpha.example/moi"), "https://alpha.example/moi", "plus d'adresse : le bouton reprend l'adresse du réseau");
});

/* ───────────── la page des liens courts et le journal ───────────── */

test("la page des liens courts : pastille d'origine écrite, renvoi vers les réglages de l'extension, aucun interrupteur ni suppression ; le conflit est signalé", async () => {
  await admin();
  const { inst } = await network("alpha", "https://alpha.example/moi");
  await save(inst, [["s__profile", "https://alpha.example/moi"], ["s__createShortLink", "on"]]);
  await mk("mien");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Page = (await import("@/app/admin/(panel)/redirects/page")).default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  const row = (path) => html.split('data-testid="redirect-row"').find((x) => x.includes(`>/${path}<`)) ?? "";
  assert.match(row("alpha"), /managed-badge/);
  assert.match(row("alpha"), /alpha extension|Extension alpha/i);
  assert.ok(row("alpha").includes(`/admin/instances/${inst.id}`), "le bouton mène aux réglages de l'extension");
  assert.ok(!row("alpha").includes("redirect-switch") && !/ConfirmButton|Supprimer|Delete/.test(row("alpha")), "ni interrupteur ni suppression");
  assert.ok(!row("mien").includes("managed-badge"), "aucune étiquette sur les liens de la personne (R14)");
  assert.ok(row("mien").includes("redirect-switch"));
  // Conflit : un autre nom, pris par un lien de la personne.
  await setSetting(`instance.${inst.id}.shortLinkName`, "mien");
  const conflict = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.match(conflict, /managed-conflict/);
  assert.ok(conflict.includes(`/admin/instances/${inst.id}`));
  assert.equal((await prisma.redirect.findUnique({ where: { path: "mien" } })).managedBy, null);
});

test("la sauvegarde du site garde le marquage (colonne ajoutée : une ancienne sauvegarde la lit comme « créé par une personne »)", async () => {
  const { pickKnownColumns } = await import("@/core/backup/schema");
  const row = await mk("mien");
  assert.ok("managedBy" in row);
  const old = pickKnownColumns("redirects", { id: "x", path: "p", targetUrl: "https://a.example/", hits: 0 });
  assert.equal(old.managedBy, undefined, "absente d'une ancienne sauvegarde : valeur par défaut (vide)");
});
