// Permissions-Policy (cœur 0.2.12) : caméra et micro toujours fermés ; la position du visiteur n'est permise (au site seul) que si un module INSTALLÉ
// déclare la permission « visitor.geolocation ». Fermé sans module, ouvert avec, refermé à la désinstallation, fermé par défaut au moindre doute.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const config = (await import("../../next.config.mjs")).default;
const P = await import("@/core/permissionsPolicy");
const { forgetModule, resetModuleRegistry } = await import("@/core/modules/registry");
const { parseManifest } = await import("@/core/modules/manifest");
const { MODULES_DIR } = await import("@/core/config");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");

after(() => db.close());
beforeEach(async () => { await db.reset(); fs.rmSync(MODULES_DIR, { recursive: true, force: true }); globalThis.curiosaPolicyGate = undefined; });

const CLOSED = "camera=(), microphone=(), geolocation=()";
const OPEN = "camera=(), microphone=(), geolocation=(self)";
const manifest = (id, permissions = []) => ({ apiVersion: 2, id, name: id, version: "1.0.0", description: "test", permissions });
async function install(id, permissions, { raw } = {}) {
  fs.mkdirSync(path.join(MODULES_DIR, id), { recursive: true });
  fs.writeFileSync(path.join(MODULES_DIR, id, "module.json"), JSON.stringify(raw ?? manifest(id, permissions)));
  await prisma.module.create({ data: { id, source: "git", version: "1.0.0" } });
  forgetModule(id);
}
async function uninstall(id) {
  await prisma.module.delete({ where: { id } });
  fs.rmSync(path.join(MODULES_DIR, id), { recursive: true, force: true });
  forgetModule(id);
}
async function served(pathname = "/") {
  const res = await proxy(new NextRequest(new URL(pathname, "http://localhost:4140")));
  return res.headers.get("Permissions-Policy");
}

test("valeurs : caméra et micro toujours fermés, jamais d'origine tierce ni de joker", () => {
  for (const open of [false, true]) {
    const v = P.policyValue(open);
    assert.equal(v, open ? OPEN : CLOSED);
    assert.match(v, /^camera=\(\), microphone=\(\), geolocation=\(/);
    assert.ok(!/\*|https?:/.test(v), "aucune origine tierce, aucun joker");
  }
});

test("next.config.mjs : la valeur servie partout par défaut est FERMÉE (admin, API et fichiers compris)", async () => {
  const all = (await config.headers()).find((r) => r.source === "/:path*");
  assert.equal(all.headers.find((h) => h.key === "Permissions-Policy").value, CLOSED);
});

test("manifeste : la permission est reconnue ; une permission voisine, un joker ou une valeur inventée est REFUSÉ", () => {
  assert.equal(parseManifest(manifest("carte", ["visitor.geolocation"])).ok, true);
  assert.equal(P.declaresGeolocation(manifest("carte", ["pages", "visitor.geolocation"])), true);
  assert.equal(P.declaresGeolocation(manifest("carte", ["pages"])), false);
  assert.equal(P.declaresGeolocation(manifest("carte")), false);
  for (const bad of ["geolocation", "visitor.geolocation ", "visitor.*", "*", "visitor.camera", "Visitor.Geolocation", "visitor.geolocation=(*)"]) {
    const r = parseManifest(manifest("carte", [bad]));
    assert.equal(r.ok, false, `« ${bad} » doit être refusé`);
    assert.equal(P.declaresGeolocation(manifest("carte", [bad])), false);
  }
  assert.equal(parseManifest(manifest("carte", [{ any: 1 }])).ok, false);
  assert.equal(P.declaresGeolocation(null), false);
  assert.equal(P.declaresGeolocation("visitor.geolocation"), false);
});

test("garde : fermé par défaut, mis en cache (une seule lecture), relu après invalidation", async () => {
  let reads = 0, answer = false, t = 1000;
  const gate = P.createPolicyGate(async () => { reads++; return answer; }, { ttlMs: 30_000, now: () => t });
  assert.equal(await gate.isOpen(), false);
  answer = true; t += 10_000;
  assert.equal(await gate.isOpen(), false, "encore dans le délai : l'ancienne réponse, sans nouvelle lecture");
  assert.equal(reads, 1);
  gate.invalidate();
  assert.equal(await gate.isOpen(), true);
  assert.equal(reads, 2);
  t += 31_000;
  answer = false;
  assert.equal(await gate.isOpen(), false, "délai écoulé : relu");
  const parallel = P.createPolicyGate(async () => { reads++; await new Promise((r) => setTimeout(r, 10)); return true; });
  const before = reads;
  assert.deepEqual(await Promise.all([parallel.isOpen(), parallel.isOpen(), parallel.isOpen()]), [true, true, true]);
  assert.equal(reads - before, 1, "lectures simultanées regroupées");
});

test("garde : état illisible (exception, réponse étrange) = FERMÉ, même si c'était ouvert avant ; nouvelle tentative rapide", async () => {
  let mode = "ok", t = 0;
  const gate = P.createPolicyGate(async () => { if (mode === "boom") throw new Error("base illisible"); if (mode === "odd") return "oui"; return true; }, { ttlMs: 30_000, retryMs: 5_000, now: () => t });
  assert.equal(await gate.isOpen(), true);
  mode = "boom"; gate.invalidate();
  assert.equal(await gate.isOpen(), false, "illisible → fermé");
  mode = "ok"; t += 4_000;
  assert.equal(await gate.isOpen(), false, "avant la nouvelle tentative");
  t += 2_000;
  assert.equal(await gate.isOpen(), true, "relu après 5 s");
  mode = "odd"; gate.invalidate();
  assert.equal(await gate.isOpen(), false, "seul `true` ouvre");
});

test("garde : une invalidation pendant la lecture n'est pas perdue", async () => {
  let release, answer = false;
  const gate = P.createPolicyGate(() => new Promise((r) => { release = () => r(answer); }));
  const first = gate.isOpen();
  gate.invalidate();
  answer = true; release();
  await first;
  const second = gate.isOpen();
  release();
  assert.equal(await second, true);
});

test("réel : fermé sans module ; ouvert avec un module qui déclare le besoin ; refermé à la désinstallation", async () => {
  assert.equal(await P.geolocationOpen(), false, "aucun module");
  await install("blog", ["pages"]);
  assert.equal(await P.geolocationOpen(), false, "un module sans déclaration ne change rien");
  await install("carte", ["pages", "visitor.geolocation"]);
  assert.equal(await P.geolocationOpen(), true);
  await uninstall("carte");
  assert.equal(await P.geolocationOpen(), false, "désinstallé → refermé aussitôt");
  assert.equal(await P.geolocationOpen(), false);
});

test("réel : mise à jour (le module gagne ou perd la déclaration) et restauration recalculent l'en-tête", async () => {
  await install("carte", ["pages"]);
  assert.equal(await P.geolocationOpen(), false);
  fs.writeFileSync(path.join(MODULES_DIR, "carte", "module.json"), JSON.stringify(manifest("carte", ["pages", "visitor.geolocation"])));
  forgetModule("carte");
  assert.equal(await P.geolocationOpen(), true, "1.0.1 déclare le besoin");
  fs.writeFileSync(path.join(MODULES_DIR, "carte", "module.json"), JSON.stringify(manifest("carte", ["pages"])));
  resetModuleRegistry();
  assert.equal(await P.geolocationOpen(), false, "la déclaration disparaît → refermé");
});

test("réel : module.json invalide, absent ou illisible = module qui ne tourne pas = fermé", async () => {
  await install("casse", [], { raw: { ...manifest("casse", ["visitor.geolocation"]), apiVersion: 99 } });
  assert.equal(await P.geolocationOpen(), false, "apiVersion refusée");
  await install("faux", [], { raw: manifest("faux", ["visitor.geolocation", "geolocation"]) });
  assert.equal(await P.geolocationOpen(), false, "permission inventée : manifeste refusé en entier");
  await install("muet", ["visitor.geolocation"]);
  assert.equal(await P.geolocationOpen(), true);
  fs.writeFileSync(path.join(MODULES_DIR, "muet", "module.json"), "{ pas du json");
  forgetModule("muet");
  assert.equal(await P.geolocationOpen(), false, "illisible");
  fs.rmSync(path.join(MODULES_DIR, "muet"), { recursive: true });
  forgetModule("muet");
  assert.equal(await P.geolocationOpen(), false, "dossier absent");
});

test("réel : base illisible = fermé (jamais d'exception vers la page)", async () => {
  await install("carte", ["visitor.geolocation"]);
  assert.equal(await P.geolocationOpen(), true);
  const original = prisma.module.findMany;
  prisma.module.findMany = async () => { throw new Error("base illisible"); };
  try {
    P.invalidatePermissionsPolicy();
    assert.equal(await P.geolocationOpen(), false);
  } finally { prisma.module.findMany = original; }
});

test("proxy : l'en-tête des pages publiques suit l'état des modules (fermé, ouvert, refermé), y compris sous une langue", async () => {
  assert.equal(await served("/"), CLOSED);
  assert.equal(await served("/blog"), CLOSED);
  await install("carte", ["pages", "visitor.geolocation"]);
  assert.equal(await served("/"), OPEN);
  assert.equal(await served("/carte"), OPEN);
  assert.equal(await served("/en/carte"), OPEN);
  await uninstall("carte");
  assert.equal(await served("/carte"), CLOSED);
  assert.equal(await served("/en/carte"), CLOSED);
});

test("proxy : lecture trop lente (au-delà de 500 ms) = fermé pour cette page", async () => {
  await install("carte", ["visitor.geolocation"]);
  globalThis.curiosaPolicyGate = P.createPolicyGate(() => new Promise((r) => setTimeout(() => r(true), 2000)));
  const start = Date.now();
  assert.equal(await served("/"), CLOSED);
  assert.ok(Date.now() - start < 1500, "le proxy n'attend pas sans borne");
});

test("branchements : le registre invalide l'état ; le proxy ne lit pas la base lui-même et borne l'attente", () => {
  const reg = fs.readFileSync("src/core/modules/registry.ts", "utf8");
  assert.match(reg, /export function forgetModule[\s\S]*?invalidatePermissionsPolicy\(\)/);
  assert.match(reg, /export function resetModuleRegistry[\s\S]*?invalidatePermissionsPolicy\(\)/);
  const proxySrc = fs.readFileSync("src/proxy.ts", "utf8");
  assert.match(proxySrc, /withDeadline\(\(\) => geolocationOpen\(\), POLICY_MAX_MS\)/);
  assert.match(proxySrc, /POLICY_MAX_MS = 500/);
  assert.ok(!/prisma/.test(proxySrc), "pas de lecture de base dans le proxy lui-même");
});
