// Envoi d'un .ttf ou d'un .otf (docs/POLICES.md) : converti en WOFF2 côté serveur puis revérifié comme un WOFF2 ; refus propres (jamais d'exception).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { sfntToWoff2, looksLikeSfnt } = await import("@/core/fonts/sfnt");
const { checkWoff2 } = await import("@/core/fonts/woff2");
const TTF = fs.readFileSync("tests/fixtures/fonts/kalam.ttf");
const OTF = fs.readFileSync("tests/fixtures/fonts/anton-sub.otf");
const conv = async (b, o) => { const r = await sfntToWoff2(b, o); return r.ok ? "ok" : r.code; };
/** Réécrit une police sfnt avec les tables données (étiquette → octets), répertoire trié. */
function build(flavor, tables, { overlap = false } = {}) {
  const tags = Object.keys(tables).sort();
  const dir = Buffer.alloc(12 + 16 * tags.length);
  dir.writeUInt32BE(flavor, 0); dir.writeUInt16BE(tags.length, 4);
  let off = dir.length; const body = [];
  tags.forEach((t, i) => { const d = tables[t]; dir.write(t, 12 + 16 * i, "latin1"); dir.writeUInt32BE(overlap && i === 1 ? off - 4 : off, 12 + 16 * i + 8); dir.writeUInt32BE(d.length, 12 + 16 * i + 12); body.push(d, Buffer.alloc((4 - (d.length % 4)) % 4)); off += d.length + ((4 - (d.length % 4)) % 4); });
  return Buffer.concat([dir, ...body]);
}
function tablesOf(buf) {
  const n = buf.readUInt16BE(4), out = {};
  for (let i = 0; i < n; i++) { const a = 12 + 16 * i; out[buf.toString("latin1", a, a + 4)] = Buffer.from(buf.subarray(buf.readUInt32BE(a + 8), buf.readUInt32BE(a + 8) + buf.readUInt32BE(a + 12))); }
  return out;
}

test("un vrai TTF et un vrai OTF (CFF) sont convertis en WOFF2 et acceptés par la vérification des octets", async () => {
  assert.ok(looksLikeSfnt(TTF) && looksLikeSfnt(OTF));
  for (const [what, buf, family] of [["ttf", TTF, "Kalam"], ["otf", OTF, "Anton Sub"]]) {
    const r = await sfntToWoff2(buf);
    assert.equal(r.ok, true, what);
    assert.equal(r.woff2.subarray(0, 4).toString(), "wOF2");
    assert.equal(r.woff2.readUInt32BE(4), buf.readUInt32BE(0), "même type de police");
    assert.ok(r.woff2.length < buf.length, `${what} : plus léger (${buf.length} → ${r.woff2.length})`);
    const c = checkWoff2(r.woff2);
    assert.deepEqual(c.ok && [c.family.startsWith(family.split(" ")[0]), c.style], [true, "normal"], what);
  }
});

test("refus propres : collection, ancien WOFF, pas une police, tronqué, hors fichier, chevauchement, tables manquantes, bitmaps, SVG, nombre magique", async () => {
  const t = tablesOf(TTF);
  assert.equal(await conv(Buffer.concat([Buffer.from("ttcf"), Buffer.alloc(100)])), "collection");
  assert.equal(await conv(Buffer.concat([Buffer.from("wOFF"), Buffer.alloc(100)])), "not-font");
  assert.equal(await conv(Buffer.from("MZ" + "x".repeat(300))), "not-font");
  assert.equal(await conv(TTF.subarray(0, 200)), "truncated");
  assert.equal(await conv(TTF.subarray(0, TTF.length - 5000)), "truncated", "dernière table coupée");
  const outside = Buffer.from(TTF); outside.writeUInt32BE(TTF.length + 10, 12 + 8); assert.match(await conv(outside), /truncated|tables/);
  assert.equal(await conv(build(0x00010000, t, { overlap: true })), "tables");
  const { CFF, glyf, ...noOutlines } = { ...t }; void CFF; void glyf;
  assert.equal(await conv(build(0x00010000, noOutlines)), "missing", "ni glyf ni CFF");
  const { glyf: g2, ...noGlyf } = t; void g2; assert.equal(await conv(build(0x00010000, { ...noGlyf, "CFF ": Buffer.alloc(8) })), "ok");
  for (const bad of ["SVG ", "EBDT", "sbix", "CBDT"]) assert.equal(await conv(build(0x00010000, { ...t, [bad]: Buffer.alloc(8) })), "bitmap", bad);
  const nohead = { ...t, head: Buffer.alloc(54) }; assert.equal(await conv(build(0x00010000, nohead)), "head");
  const nocmap = { ...t }; delete nocmap.cmap; assert.equal(await conv(build(0x00010000, nocmap)), "missing");
  assert.equal(await conv(build(0x00010000, { cmap: t.cmap })), "tables", "trop peu de tables");
});

test("plafonds : entrée trop lourde refusée ; octets en trop, nom impair et fichier polyglotte ne passent pas après conversion", async () => {
  assert.equal(await conv(TTF, { maxInput: 1000 }), "too-large");
  const t = tablesOf(TTF);
  // nom de longueur impaire dans l'enregistrement de plateforme 3 : conversion permise, jamais d'exception à la vérification
  const name = Buffer.from(t.name); name.writeUInt16BE(3, 6 + 8 + 2); // longueur de la première chaîne
  const r = await sfntToWoff2(build(0x00010000, { ...t, name }));
  assert.equal(r.ok, true);
  assert.doesNotThrow(() => checkWoff2(r.woff2));
  // octets en trop après la police WOFF2 produite : refusés par la vérification
  const ok = (await sfntToWoff2(TTF)).woff2;
  const poly = Buffer.concat([ok, Buffer.from("<html><script>1</script></html>".padEnd(2048, " "))]); poly.writeUInt32BE(poly.length, 8);
  assert.equal(checkWoff2(poly).ok, false);
  // un sfnt avec octets en trop après la dernière table reste une police (rien n'est recopié) : la sortie ne contient que les tables
  const padded = Buffer.concat([TTF, Buffer.from("<html>".padEnd(3000, " "))]);
  const out = await sfntToWoff2(padded);
  assert.equal(out.ok && checkWoff2(out.woff2).ok, true);
  assert.ok(out.woff2.equals(ok), "les octets en trop après la dernière table ne sont pas recopiés")
});
