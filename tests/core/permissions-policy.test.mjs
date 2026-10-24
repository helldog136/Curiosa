import test from "node:test";
import assert from "node:assert/strict";

const config = (await import("../../next.config.mjs")).default;

test("Permissions-Policy : caméra et micro fermés, position permise au site lui-même seulement (jamais un tiers)", async () => {
  const rules = await config.headers();
  const all = rules.find((r) => r.source === "/:path*");
  const value = all.headers.find((h) => h.key === "Permissions-Policy").value;
  assert.equal(value, "camera=(), microphone=(), geolocation=(self)");
  assert.ok(!/\*|https?:/.test(value), "aucune origine tierce, aucun joker");
});
