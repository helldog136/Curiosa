import test from "node:test";
import assert from "node:assert/strict";

const H = await import("@/core/header");

test("en-tête : disposition connue ou « classique » ; un lien n'existe qu'avec un texte ET une adresse valable", () => {
  assert.deepEqual([...H.HEADER_LAYOUTS], ["classic", "twoRows", "centered", "minimal"]);
  assert.ok(H.isHeaderLayout("centered") && !H.isHeaderLayout("n'importe quoi") && !H.isHeaderLayout(undefined));
  assert.deepEqual(H.headerLink("Nous contacter", "/contact"), { label: "Nous contacter", href: "/contact" });
  assert.deepEqual(H.headerLink("Adhérer", "https://exemple.test/adhesion"), { label: "Adhérer", href: "https://exemple.test/adhesion" });
  assert.deepEqual(H.headerLink(" Écrire ", "mailto:a@exemple.test"), { label: "Écrire", href: "mailto:a@exemple.test" });
  for (const [label, href] of [["", "/x"], ["Go", ""], ["Go", "javascript:alert(1)"], ["Go", "//evil.test"], ["Go", "ftp://x"], [null, "/x"], ["Go", 5]]) assert.equal(H.headerLink(label, href), null, `${label} ${href}`);
  assert.equal(H.headerLink("x".repeat(200), "/x").label.length, 60, "libellé borné");
  assert.deepEqual(H.DEFAULT_HEADER, { layout: "classic", socials: false, secondary: null, button: null });
});
