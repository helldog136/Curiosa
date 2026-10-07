import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { isSameOrigin } = await import("@/core/backup/guard");
const h = (o) => new Headers(o);

test("routes de sauvegarde : seule une requête venue de CE site est acceptée (protection contre l'envoi depuis un autre site)", () => {
  assert.equal(isSameOrigin(h({ origin: "https://site.example", host: "site.example" })), true);
  assert.equal(isSameOrigin(h({ origin: "http://localhost:3000", host: "localhost:3000" })), true);
  assert.equal(isSameOrigin(h({ origin: "https://site.example", "x-forwarded-host": "site.example", host: "127.0.0.1:3000" })), true, "derrière un proxy");
  for (const bad of [
    { origin: "https://evil.example", host: "site.example" }, { host: "site.example" }, { origin: "https://site.example" },
    { origin: "https://site.example.evil.test", host: "site.example" }, { origin: "null", host: "site.example" }, { origin: "pas une url", host: "site.example" },
    { origin: "https://site.example:8443", host: "site.example" },
  ]) assert.equal(isSameOrigin(h(bad)), false, JSON.stringify(bad));
});

test("restauration : la garde passe AVANT toute lecture du corps, et il n'y a jamais de GET", () => {
  const src = fs.readFileSync("src/core/backup/handlers.ts", "utf8");
  for (const fn of ["previewHandler", "applyHandler"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    assert.ok(body.indexOf("await guard(request)") > 0 && body.indexOf("await guard(request)") < Math.min(...["request.formData", "request.json"].map((x) => (body.indexOf(x) < 0 ? 1e9 : body.indexOf(x)))), fn);
  }
  for (const f of ["src/app/api/admin/backup/route.ts", "src/app/api/admin/backup/restore/route.ts", "src/app/api/admin/backup/restore/apply/route.ts", "src/app/api/setup/restore/route.ts", "src/app/api/setup/restore/apply/route.ts"]) {
    assert.ok(!/export (async )?function GET/.test(fs.readFileSync(f, "utf8")), `${f} : pas de GET`);
  }
});

test("restauration : l'admin exige le propriétaire connecté, l'assistant exige un site SANS compte", () => {
  for (const f of ["src/app/api/admin/backup/route.ts", "src/app/api/admin/backup/restore/route.ts", "src/app/api/admin/backup/restore/apply/route.ts"]) assert.ok(fs.readFileSync(f, "utf8").includes("guardOwner"), f);
  for (const f of ["src/app/api/setup/restore/route.ts", "src/app/api/setup/restore/apply/route.ts"]) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(src.includes("guardFresh") && !src.includes("guardOwner"), f);
  }
});

const { guardFresh } = await import("@/core/backup/guard");
const req = (headers = {}) => new Request("https://site.example/api/setup/restore", { method: "POST", headers: { origin: "https://site.example", host: "site.example", ...headers } });
const status = async (r) => (r ? { status: r.status, error: (await r.json()).error } : null);

test("assistant : restauration autorisée seulement sur un site sans compte, depuis ce site", async () => {
  assert.equal(await guardFresh(req(), { countUsers: async () => 0, setupToken: undefined }), null);
  assert.deepEqual(await status(await guardFresh(req(), { countUsers: async () => 1, setupToken: undefined })), { status: 403, error: "already-configured" }, "un site en service ne peut pas être remplacé par ce chemin");
  assert.deepEqual(await status(await guardFresh(req({ origin: "https://evil.example" }), { countUsers: async () => 0, setupToken: undefined })), { status: 403, error: "forbidden" });
  assert.deepEqual(await status(await guardFresh(new Request("https://site.example/x", { method: "POST" }), { countUsers: async () => 0, setupToken: undefined })), { status: 403, error: "forbidden" });
});

test("assistant : si SETUP_TOKEN est défini, le jeton est exigé comme pour l'assistant lui-même", async () => {
  const deps = { countUsers: async () => 0, setupToken: "jeton-secret" };
  assert.deepEqual(await status(await guardFresh(req(), deps)), { status: 403, error: "invalid-token" });
  assert.deepEqual(await status(await guardFresh(req({ "x-setup-token": "mauvais" }), deps)), { status: 403, error: "invalid-token" });
  assert.equal(await guardFresh(req({ "x-setup-token": "jeton-secret" }), deps), null);
});

test("assistant : la restauration est proposée dès le premier écran, avec les textes dans chaque langue", () => {
  const wizard = fs.readFileSync("src/app/admin/(auth)/setup/SetupWizard.tsx", "utf8");
  assert.ok(wizard.includes("/api/setup/restore") && wizard.includes("setup.restore.link") && wizard.includes("RestorePanel"));
  const strings = fs.readFileSync("src/app/admin/(auth)/setup/strings.ts", "utf8");
  for (const k of ["setup.restore.link", "setup.restore.title", "backup.file", "backup.error.wrong-password", "backup.error.invalid-token", "backup.status.custom"]) assert.ok(strings.includes(`"${k}"`), k);
});

test("routes de sauvegarde : le mot de passe ne voyage jamais dans l'adresse et la réponse n'est pas mise en cache", () => {
  const src = fs.readFileSync("src/app/api/admin/backup/route.ts", "utf8");
  assert.ok(!src.includes("searchParams") && src.includes("formData"));
  assert.match(src, /no-store/);
  assert.match(src, /attachment; filename=/);
});
