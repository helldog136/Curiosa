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

test("routes de sauvegarde : chacune passe par la garde « propriétaire + même origine » avant toute autre chose", () => {
  for (const f of ["src/app/api/admin/backup/route.ts", "src/app/api/admin/backup/restore/route.ts", "src/app/api/admin/backup/restore/apply/route.ts"]) {
    const src = fs.readFileSync(f, "utf8");
    const guard = src.indexOf("guardOwner(request)");
    assert.ok(guard > 0, f);
    assert.ok(guard < src.indexOf("request.formData") || guard < src.indexOf("request.json"), `${f} : la garde doit précéder la lecture du corps`);
    assert.ok(!/export (async )?function GET/.test(src), `${f} : pas de GET (jamais de sauvegarde par un simple lien)`);
  }
});

test("routes de sauvegarde : le mot de passe ne voyage jamais dans l'adresse et la réponse n'est pas mise en cache", () => {
  const src = fs.readFileSync("src/app/api/admin/backup/route.ts", "utf8");
  assert.ok(!src.includes("searchParams") && src.includes("formData"));
  assert.match(src, /no-store/);
  assert.match(src, /attachment; filename=/);
});
