import test from "node:test";
import assert from "node:assert/strict";
const R = await import("@/core/services/render");
const SITE = "https://exemple.org";
const div = (props, ...children) => ({ type: "div", props: { ...props, children } });

test("PNG réel : en-tête valide, bonnes dimensions, texte accentué sans erreur", async () => {
  const res = await R.renderPng({ width: 300, height: 120, tree: div({ style: { display: "flex", width: "100%", height: "100%", backgroundColor: "#112233", color: "#fff", fontSize: 30 } }, "Planning é à ü") }, SITE);
  assert.equal(res.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buf.readUInt32BE(16), 300);
  assert.equal(buf.readUInt32BE(20), 120);
});

test("dimensions bornées", async () => {
  for (const [width, height] of [[0, 100], [100, 0], [5000, 100], [100, 5000], [NaN, 100]]) await assert.rejects(R.renderPng({ width, height, tree: "x" }, SITE), /invalid size/);
});

test("arborescence abusive refusée : balise inconnue, trop de nœuds, trop profonde", () => {
  assert.throws(() => R.buildTree({ type: "script", props: {} }, SITE), /invalid node/);
  assert.throws(() => R.buildTree(div({}, ...Array.from({ length: 700 }, () => div({}))), SITE), /too large/);
  let deep = "x"; for (let i = 0; i < 40; i++) deep = div({}, deep);
  assert.throws(() => R.buildTree(deep, SITE), /too large/);
});

test("images : chemin du site ou https public seulement ; le reste devient une boîte vide", () => {
  const src = (s) => R.buildTree({ type: "img", props: { src: s, width: 10, height: 10 } }, SITE);
  assert.equal(src("/uploads/a.png").props.src, "https://exemple.org/uploads/a.png");
  assert.equal(src("https://cdn.exemple.net/a.png").props.src, "https://cdn.exemple.net/a.png");
  for (const bad of ["http://cdn.exemple.net/a.png", "https://127.0.0.1/a.png", "https://localhost/a.png", "https://10.0.0.1/a", "https://[::1]/a", "https://intranet.local/a", "https://user:pw@cdn.exemple.net/a.png", "//evil.io/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "file:///etc/passwd", "", 42]) {
    assert.equal(src(bad).type, "div", String(bad));
  }
  assert.equal(R.isPublicHost("cdn.exemple.net"), true);
  assert.equal(R.isPublicHost("metadata.google.internal"), false);
});

test("styles : seules les valeurs texte ou nombre passent ; texte tronqué", () => {
  const out = R.buildTree(div({ style: { color: "red", fontSize: 12, evil: { a: 1 }, fn: () => 1 } }, "a".repeat(900)), SITE);
  assert.deepEqual(out.props.style, { color: "red", fontSize: 12 });
  assert.equal(out.props.children.length, 500);
});
