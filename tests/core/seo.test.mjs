import test from "node:test";
import assert from "node:assert/strict";
const S = await import("@/core/seo");

test("robots : les robots IA sont bloqués par défaut, jamais un moteur de recherche ; désactivable", () => {
  const on = S.robotsRules(true);
  assert.deepEqual(on[0], { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/m/"] });
  for (const bot of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) assert.ok(on.some((r) => r.userAgent === bot && r.disallow === "/"), bot);
  for (const se of ["Googlebot", "Bingbot", "DuckDuckBot", "Applebot"]) assert.ok(!on.some((r) => r.userAgent === se), `${se} ne doit pas être bloqué`);
  assert.equal(S.robotsRules(false).length, 1);
});

test("JSON-LD : WebSite + éditeur depuis les réglages du site, logo en adresse absolue, rien d'autre", () => {
  const g = S.siteJsonLd({ url: "https://exemple.org", name: "Mon site", tagline: "Slogan", logo: "/uploads/l.png", locale: "fr" })["@graph"];
  assert.deepEqual(g.map((n) => n["@type"]), ["Organization", "WebSite"]);
  assert.equal(g[0].logo, "https://exemple.org/uploads/l.png");
  assert.deepEqual(g[1].publisher, { "@id": "https://exemple.org/#publisher" });
  const bare = S.siteJsonLd({ url: "https://exemple.org", name: "N", tagline: "", logo: null, locale: "en" })["@graph"];
  assert.ok(!("logo" in bare[0]) && !("description" in bare[0]));
});

test("JSON-LD dans <script> : une valeur contenant </script> ne peut pas fermer la balise", () => {
  const out = S.jsonLd({ name: "</script><script>alert(1)</script> " });
  assert.ok(!out.includes("</script>") && !out.includes("<"));
  assert.ok(!out.includes(" "));
  assert.equal(JSON.parse(out).name, "</script><script>alert(1)</script> ");
});
