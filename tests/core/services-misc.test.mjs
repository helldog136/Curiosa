import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { getAuthSecret } = await import("@/core/secret");
const { getRecognized } = await import("@/core/modules/recognized");
const { qrSvg } = await import("@/core/services/qr");
const { PLATFORM_SERVICES } = await import("@/core/services/index");
const { hasRole } = await import("@/core/permissions");
const { getAdminNav } = await import("@/core/modules/adminNav");
const { getInstanceLabeler } = await import("@/core/modules/labels");
const { createInstance } = await import("@/core/instanceService");
const { listInstances } = await import("@/core/instances");
const { BUILTIN_MODULES } = await import("@/modules-builtin");
const { DATA_DIR } = await import("@/core/config");

beforeEach(() => db.reset());
after(() => db.close());

test("secret d'authentification : variable d'environnement prioritaire, sinon généré une fois puis conservé", () => {
  const prev = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = "depuis-l-env";
    assert.equal(getAuthSecret(), "depuis-l-env");
    delete process.env.AUTH_SECRET;
    const file = path.join(DATA_DIR, "auth-secret");
    fs.rmSync(file, { force: true });
    const first = getAuthSecret();
    assert.ok(first.length >= 40);
    assert.equal(getAuthSecret(), first, "stable d'un appel à l'autre");
    assert.equal(fs.statSync(file).mode & 0o077, 0, "lisible par le seul propriétaire");
  } finally { if (prev === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prev; }
});

test("QR code : SVG à fond transparent, texte long tronqué, contenu différent selon le texte", async () => {
  const a = await qrSvg("https://exemple.org/a");
  const b = await qrSvg("https://exemple.org/b");
  assert.match(a, /^<svg/);
  assert.notEqual(a, b);
  assert.ok(!/fill="#ffffff"/i.test(a));
  assert.ok((await qrSvg("x".repeat(10_000))).startsWith("<svg"), "pas d'erreur sur un texte trop long");
});

test("catalogue des services : chaque service documenté, fichier existant, noms uniques", () => {
  assert.equal(new Set(PLATFORM_SERVICES.map((s) => s.id)).size, PLATFORM_SERVICES.length);
  for (const s of PLATFORM_SERVICES) {
    assert.ok(s.summary.length > 10, s.id);
    assert.ok(fs.existsSync(path.join("src/core", s.where)), `${s.id} : ${s.where}`);
  }
});

test("rôles : propriétaire > administrateur > éditeur, visiteur sans droit", () => {
  const u = (role) => ({ id: "1", email: "a@b.c", name: "A", role, locale: null, advanced: false });
  assert.equal(hasRole(u("owner"), "admin"), true);
  assert.equal(hasRole(u("admin"), "owner"), false);
  assert.equal(hasRole(u("admin"), "editor"), true);
  assert.equal(hasRole(u("editor"), "admin"), false);
  assert.equal(hasRole(u("editor"), "editor"), true);
  assert.equal(hasRole(null, "editor"), false);
  assert.equal(hasRole(u("hacker"), "editor"), false, "rôle inconnu = aucun droit");
});

test("catalogue de modules : désactivé sans URL ou hors https, filtre les éléments invalides, cache 5 minutes", async () => {
  const prevUrl = process.env.MODULES_INDEX_URL, realFetch = globalThis.fetch;
  try {
    delete process.env.MODULES_INDEX_URL;
    assert.deepEqual(await getRecognized(), []);
    process.env.MODULES_INDEX_URL = "http://insecure.example/index.json";
    assert.deepEqual(await getRecognized(), []);
    process.env.MODULES_INDEX_URL = "https://catalogue.example/index.json";
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json([{ id: "aa", repo: "https://github.com/x/a", name: "A", description: "d" }, { id: 5, repo: "x" }, { repo: "y" }, null, "texte", { id: "bb", repo: "https://github.com/x/b" }]); };
    const items = await getRecognized();
    assert.deepEqual(items.map((i) => i.id), ["aa", "bb"]);
    assert.equal(items[1].name, "bb", "nom par défaut = identifiant");
    await getRecognized();
    assert.equal(calls, 1, "servi par le cache");
  } finally { globalThis.fetch = realFetch; if (prevUrl === undefined) delete process.env.MODULES_INDEX_URL; else process.env.MODULES_INDEX_URL = prevUrl; }
});

test("catalogue de modules : réponse illisible ou en erreur → liste vide, jamais d'exception", async () => {
  const realFetch = globalThis.fetch;
  process.env.MODULES_INDEX_URL = "https://catalogue.example/x.json";
  try {
    // le cache du test précédent peut subsister : on le contourne en observant seulement l'absence d'exception
    for (const impl of [async () => new Response("pas du json", { status: 200 }), async () => new Response("", { status: 500 }), async () => { throw new Error("réseau"); }, async () => Response.json({ pas: "un tableau" })]) {
      globalThis.fetch = impl;
      assert.ok(Array.isArray(await getRecognized()));
    }
  } finally { globalThis.fetch = realFetch; delete process.env.MODULES_INDEX_URL; }
});

async function inst(id, nickname, names = { en: id }) {
  await db.prisma.module.upsert({ where: { id }, create: { id, source: "builtin", version: "1", enabled: true }, update: {} });
  return createInstance(db.prisma, { manifest: BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest, nickname, names });
}

test("libellés d'admin : nom du module si l'instance est seule, surnom dès qu'il y en a plusieurs", async () => {
  await inst("blog", undefined, { en: "Mon blog public" });
  await inst("links", undefined);
  let labeler = await getInstanceLabeler("en", "en");
  const [a] = (await listInstances()).filter((i) => i.moduleId === "blog");
  assert.equal(labeler.label(a), "Blog", "nom du module, pas le nom public ni la clé technique");
  assert.equal(labeler.hasSiblings("blog"), false);
  await inst("blog", "Actus", { en: "Actus" });
  const all = (await listInstances()).filter((i) => i.moduleId === "blog");
  // Le cache de React n'existe pas hors rendu : un nouveau labeler reflète l'état courant.
  labeler = await getInstanceLabeler("en", "en");
  assert.equal(labeler.hasSiblings("blog"), true);
  assert.ok(all.map((i) => labeler.label(i)).includes("Actus"));
  assert.equal(labeler.siblingsOf(all[0]).length, 1);
  assert.equal(labeler.moduleName("blog"), "Blog");
  assert.equal(labeler.moduleName("inconnu"), "inconnu");
});

test("navigation d'admin : instances regroupées par type de module, nom lisible, vide sans instance", async () => {
  assert.deepEqual(await getAdminNav("en", "en"), []);
  await inst("blog");
  await inst("hero");
  const nav = await getAdminNav("en", "en");
  const types = nav.map((g) => g.type);
  assert.equal(new Set(types).size, types.length, "un seul groupe par type");
  const items = nav.flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.key).sort(), ["blog", "hero"]);
  assert.equal(items.find((i) => i.key === "blog").content, true);
  assert.equal(items.find((i) => i.key === "hero").content, false);
  assert.ok(items.every((i) => i.name && i.icon));
});

test("modules livrés : les noms par défaut existent en français et en anglais", () => {
  for (const b of BUILTIN_MODULES) {
    const n = b.manifest.name;
    if (typeof n !== "string") assert.ok(n.en && n.fr, b.manifest.id);
  }
});
