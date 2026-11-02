// Vérification des OCTETS d'une police envoyée (docs/POLICES.md) : signature, longueur, répertoire, flux Brotli borné, tailles de tables, tables indispensables.
// Ce qui n'est pas une vraie police WOFF2 (exécutable, page, archive, fichier tronqué ou retouché, bombe de décompression) est refusé avec un code précis.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const { checkWoff2, cleanFontName, familySlug, KNOWN_TAGS } = await import("@/core/fonts/woff2");
const real = (name) => fs.readFileSync(`fonts/files/${name}`);
const kalam = real("kalam-700-latin.woff2");
const code = (b, max) => { const r = checkWoff2(b, max); return r.ok ? "ok" : r.code; };

/** Une police fabriquée : en-tête + répertoire de tables + flux Brotli, pour atteindre des cas que les vraies polices n'ont pas. */
function fake({ tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "glyf", "loca"], lengths, payload, flavor = 0x00010000, priv = 0 } = {}) {
  const dir = [];
  const ls = lengths ?? tags.map((t) => (t === "loca" ? 0 : 64));
  tags.forEach((t, i) => {
    const idx = KNOWN_TAGS.indexOf(t);
    const transformed = t === "glyf" || t === "loca";
    dir.push(idx >= 0 ? idx : 63, ...(idx >= 0 ? [] : [...Buffer.from(t, "latin1")]), ls[i] > 127 ? 0 : ls[i], ...(transformed ? [t === "loca" ? 0 : ls[i]] : []));
    if (t === "loca") dir[dir.length - 2] = 0;
  });
  const total = ls.reduce((a, b) => a + b, 0);
  const raw = payload ?? Buffer.alloc(total);
  const comp = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } });
  const header = Buffer.alloc(48);
  header.write("wOF2", 0); header.writeUInt32BE(flavor, 4); header.writeUInt16BE(tags.length, 12); header.writeUInt32BE(Math.max(100, total), 16); header.writeUInt32BE(comp.length, 20); header.writeUInt32BE(priv ? 1 : 0, 44);
  const out = Buffer.concat([header, Buffer.from(dir), comp]);
  out.writeUInt32BE(out.length, 8);
  return out;
}

test("les 72 polices de la bibliothèque et des vraies polices passent ; le nom, la graisse et le style sont lus dans le fichier", () => {
  const r = checkWoff2(kalam);
  assert.deepEqual(r.ok && [r.family, r.weight, r.style, r.variable], ["Kalam", "700", "normal", false]);
  assert.deepEqual((({ family, weight }) => [family, weight])(checkWoff2(real("kalam-400-latin.woff2"))), ["Kalam", "400"]);
  assert.equal(KNOWN_TAGS.length, 63, "la table des étiquettes connues du format");
  for (const f of fs.readdirSync("fonts/files")) assert.equal(code(real(f), 40 * 1024), "ok", f);
});

test("ce qui n'est pas une police : exécutables, pages, archives, vide, tout autre type, même renommé en .woff2", () => {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(200, 0x41)]);
  for (const [what, bytes] of [
    ["Windows (MZ)", pad(Buffer.from("MZ\x90\x00"))], ["ELF", pad(Buffer.from("\x7fELF\x02\x01"))], ["script", pad(Buffer.from("#!/bin/sh\nrm -rf /\n"))],
    ["PHP", pad(Buffer.from("<?php system($_GET[1]); ?>"))], ["page web", pad(Buffer.from("<!doctype html><script>alert(1)</script>"))], ["SVG", pad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))],
    ["zip", pad(Buffer.from("PK\x03\x04"))], ["WOFF 1", pad(Buffer.from("wOFF\x00\x01\x00\x00"))], ["TrueType brut", pad(Buffer.from([0, 1, 0, 0]))], ["PNG", pad(Buffer.from("\x89PNG\r\n\x1a\n"))],
  ]) assert.equal(code(bytes), "not-woff2", what);
  assert.equal(code(Buffer.alloc(0)), "empty");
  assert.equal(code(Buffer.from("wOF2")), "not-woff2", "trop court");
});

test("signature juste mais fichier retouché ou abîmé : longueur annoncée, en-tête, troncature, flux corrompu, tailles de tables", () => {
  assert.equal(code(kalam.subarray(0, kalam.length - 40)), "header", "tronqué : la longueur annoncée ne correspond plus");
  const longer = Buffer.concat([kalam, Buffer.alloc(8)]);
  assert.equal(code(longer), "header", "octets ajoutés à la fin sans corriger la longueur");
  const bad = (edit) => { const b = Buffer.from(kalam); edit(b); return code(b); };
  assert.equal(bad((b) => b.writeUInt16BE(0, 12)), "header", "aucune table");
  assert.equal(bad((b) => b.writeUInt16BE(500, 12)), "header", "trop de tables");
  assert.equal(bad((b) => b.writeUInt16BE(7, 14)), "header", "champ réservé");
  assert.equal(bad((b) => b.writeUInt32BE(0x12345678, 4)), "header", "type de police inconnu");
  assert.equal(bad((b) => b.writeUInt32BE(0x74746366, 4)), "collection", "collection de polices");
  assert.equal(bad((b) => b.writeUInt32BE(9_000_000, 16)), "header", "taille décompressée déclarée absurde");
  assert.equal(bad((b) => b.writeUInt32BE(1, 44)), "private", "données privées");
  assert.equal(bad((b) => b.writeUInt32BE(b.length * 2, 20)), "truncated", "flux plus long que le fichier");
  assert.match(bad((b) => { for (let i = b.length - 400; i < b.length - 100; i++) b[i] ^= 0xff; }), /compressed|sizes/, "flux Brotli corrompu");
  assert.match(bad((b) => b.writeUInt32BE(b.readUInt32BE(20) - 8, 20)), /compressed|sizes|trailing/, "flux Brotli coupé");
  assert.equal(code(kalam, kalam.length - 1), "too-large", "au-delà de la taille permise");
});

test("police fabriquée : tailles de tables incohérentes, tables manquantes, SVG embarqué, bombe de décompression", () => {
  assert.equal(code(fake()), "head", "tables présentes mais vides : head sans nombre magique");
  assert.equal(code(fake({ payload: Buffer.alloc(10) })), "sizes", "moins d'octets que la somme des tables");
  assert.equal(code(fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "glyf", "loca", "OS/2"] })), "missing", "table name absente");
  assert.equal(code(fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post"] })), "missing", "ni glyf ni CFF");
  assert.equal(code(fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "name", "glyf", "loca", "SVG "] })), "svg", "dessins SVG embarqués");
  assert.equal(code(fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "name", "cmap"] })), "tables", "table en double");
  const bomb = fake({ payload: Buffer.alloc(40_000_000) });
  assert.ok(bomb.length < 150 * 1024, `la bombe tient dans ${bomb.length} octets`);
  assert.equal(code(bomb), "compressed", "décompression plafonnée : refusée, sans avoir rempli la mémoire");
});

test("nom : nettoyé (lettres, chiffres, signes simples, 60 caractères) ; identifiant de famille sans accents ni signes", () => {
  assert.equal(cleanFontName("  Ma   Police <b>Gras</b> \u0000 "), "Ma Police bGrasb");
  assert.equal(cleanFontName("x".repeat(100)).length, 60);
  assert.equal(cleanFontName("</style><script>"), "stylescript");
  assert.equal(familySlug("Ma Police Éléphant & Co"), "ma-police-elephant-co");
  assert.equal(familySlug("???"), "");
  assert.ok(familySlug("a".repeat(80)).length <= 32);
});

test("suivi sécurité : nom de longueur impaire = refus propre ; octets après la police (polyglotte) = refus ; les vraies polices passent toujours", () => {
  // une police réelle dont l'enregistrement « name » (plateforme 3) a une longueur impaire n'est plus qu'ignoré : jamais d'exception
  const naming = (len) => { const n = Buffer.alloc(6 + 12 + 8); n.writeUInt16BE(1, 2); n.writeUInt16BE(18, 4); n.writeUInt16BE(3, 6); n.writeUInt16BE(1, 8); n.writeUInt16BE(1, 12); n.writeUInt16BE(len, 14); return n; };
  const res = fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "name", "glyf", "loca"], lengths: [64, 64, 64, 64, 64, 24, 64, 0], payload: Buffer.concat([Buffer.alloc(64 * 5), naming(3), Buffer.alloc(64)]) });
  assert.doesNotThrow(() => checkWoff2(res));
  assert.equal(checkWoff2(res).ok, false);
  const html = Buffer.from("<html><script>alert(1)</script></html>".padEnd(2048, " "));
  const poly = Buffer.concat([kalam, html]);
  poly.writeUInt32BE(poly.length, 8);
  assert.equal(code(poly), "trailing");
  for (const f of fs.readdirSync("fonts/files")) assert.equal(code(real(f), 40 * 1024), "ok", f);
});

test("suivi : un WOFF2 avec CFF2 est refusé avec son code dédié", () => {
  assert.equal(code(fake({ tags: ["cmap", "head", "hhea", "hmtx", "maxp", "name", "CFF2"] })), "cff2");
});
