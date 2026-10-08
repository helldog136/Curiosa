import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const L = await import("@/core/logos");
// Logos abstraits : de simples adresses, aucune image réelle.
const A = (n) => `/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f${n}.png`;
const full = { wide: A(1), square: A(2), wideDark: A(3), squareDark: A(4), favicon: A(5), share: A(6) };
const only = (o) => ({ ...L.EMPTY_LOGOS, ...o });

test("logos : chaque rôle prend la version qui convient au fond (clair ou sombre)", () => {
  assert.equal(L.pickLogo(full, "wide", false), full.wide);
  assert.equal(L.pickLogo(full, "wide", true), full.wideDark);
  assert.equal(L.pickLogo(full, "icon", false), full.square);
  assert.equal(L.pickLogo(full, "icon", true), full.squareDark);
  assert.equal(L.pickLogo(full, "favicon", true), full.favicon);
  assert.equal(L.pickLogo(full, "share", false), full.share);
});

test("logos : au mieux avec ce qu'on a — l'autre version plutôt que rien, jamais un horizontal dans un carré", () => {
  assert.equal(L.pickLogo(only({ wide: A(1) }), "wide", true), A(1), "pas de version sombre : on garde la claire");
  assert.equal(L.pickLogo(only({ squareDark: A(4) }), "icon", false), A(4));
  assert.equal(L.pickLogo(only({ wide: A(1) }), "icon", false), null, "pas d'icône : le site n'en invente pas à partir du logo horizontal");
  assert.equal(L.pickLogo(only({ wide: A(1) }), "favicon", false), null, "le favicon n'est jamais le logo horizontal (le site fabrique alors le sien)");
  assert.equal(L.pickLogo(only({ square: A(2) }), "favicon", false), A(2), "icône carrée = favicon à défaut");
  assert.equal(L.pickLogo(only({ square: A(2), wide: A(1) }), "share", false), A(2));
  assert.equal(L.pickLogo(only({ wide: A(1) }), "share", false), A(1));
  assert.equal(L.pickLogo(only({ wide: A(1) }), "any", false), A(1), "un seul visuel de marque : l'icône, sinon l'horizontal");
  assert.equal(L.pickLogo(only({ square: A(2), wide: A(1) }), "any", false), A(2));
  assert.equal(L.pickLogo(L.EMPTY_LOGOS, "any", false), null);
});

test("logos : fond sombre reconnu à la couleur de fond du site ; adresses de logo vérifiées", () => {
  assert.equal(L.isDarkBackground("#121214"), true);
  assert.equal(L.isDarkBackground("#ffffff"), false);
  assert.equal(L.isDarkBackground("pas une couleur"), false);
  assert.ok(L.isLogoUrl(A(1)) && L.isLogoUrl("https://exemple.test/logo.webp"));
  for (const bad of ["javascript:alert(1)", "http://exemple.test/l.png", "/uploads/../x.png", '/uploads/x"onerror=.png', "", null]) assert.ok(!L.isLogoUrl(bad), String(bad));
  assert.deepEqual(L.listLogos(only({ wide: A(1), squareDark: A(4), favicon: A(5) })).map((l) => l.kind), ["wide", "squareDark"], "kit presse : seulement les logos (ni favicon ni image de partage)");
});

test("logos : branchés — en-tête (horizontal / icône), favicon, partage, données structurées, kit presse, réglages enregistrés", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  const header = read("src/components/site/Header.tsx");
  assert.match(header, /pickLogo\(config\.logos, "wide", dark\)/);
  assert.match(header, /hidden sm:block/, "horizontal sur grand écran, icône sur téléphone");
  const layout = read("src/app/(site)/layout.tsx");
  assert.match(layout, /pickLogo\(config\.logos, "favicon", false\)/);
  assert.match(layout, /pickLogo\(config\.logos, "share", false\)/);
  assert.match(read("src/core/modules/api.ts"), /pickLogo\(c\.logos, "any"/);
  assert.match(read("src/core/brand.ts"), /listLogos\(config\.logos\)/);
  const actions = read("src/app/admin/(panel)/settings/actions.ts");
  for (const f of ["logoWide", "logoDark", "logoWideDark", "logoShare", "favicon"]) assert.ok(actions.includes(`"${f}"`), f);
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  for (const f of ["logoWide", "logo\"", "logoShare", "logoWideDark", "logoDark", "favicon"]) assert.ok(page.includes(`name="${f.replace('"', "")}"`), f);
});

test("logos SVG : acceptés à l'envoi seulement s'ils sont nettoyés ; scripts, styles, textes, images et liens externes refusés avec un message", async () => {
  const fsx = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), "curiosa-svg-"));
  process.env.DATA_DIR = dir;
  const U = { ...(await import("@/core/services/uploads")), ...(await import("@/core/logoUpload")) };
  const ok = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><circle cx="20" cy="20" r="18" fill="#e8337a"/></svg>';
  assert.equal(U.looksLikeSvg(Buffer.from(ok)), true);
  assert.equal(U.looksLikeSvg(Buffer.from("<html><svg></svg></html>")), false);
  assert.equal(U.looksLikeSvg(Buffer.from("GIF89a")), false);
  const bad = {
    "un script": '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
    "du style": '<svg viewBox="0 0 10 10"><style>.a{fill:red}</style></svg>',
    "du texte": '<svg viewBox="0 0 10 10"><text>Nom</text></svg>',
    "une image intégrée": '<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAAA"/></svg>',
    "un lien externe": '<svg viewBox="0 0 10 10"><use href="https://evil.example/x.svg#a"/></svg>',
    "un événement": '<svg viewBox="0 0 10 10" onload="alert(1)"><rect width="1" height="1"/></svg>',
  };
  for (const [what, svg] of Object.entries(bad)) {
    const r = await U.saveSvgUpload(Buffer.from(svg));
    assert.equal(r.error, "svg", what);
    assert.ok(r.detail.length > 5, `${what} : message précis`);
  }
  // Un dessin valable : enregistré NETTOYÉ (attribut d'événement absent, viewBox déduit des dimensions, ratio « contenir »).
  const saved = await U.saveSvgUpload(Buffer.from(ok));
  assert.match(saved.url, /^\/uploads\/[0-9a-f-]{36}\.svg$/);
  const stored = fsx.readFileSync(path.join(dir, "uploads", saved.url.slice(9)), "utf8");
  assert.ok(!stored.includes("<?xml"));
  assert.match(stored, /viewBox="0 0 120 40"/);
  assert.match(stored, /preserveAspectRatio="xMidYMid meet"/);
  assert.ok(U.UPLOAD_NAME_RE.test(saved.url.slice(9)));
  assert.equal(U.mimeFor("a.svg"), "image/svg+xml");
});

test("logos SVG : jamais proposé comme image de partage ; adresse valable pour un logo ; servi avec une politique qui n'exécute rien ; réservé aux champs de logo", () => {
  const SVG = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.svg";
  assert.ok(L.isLogoUrl(SVG));
  assert.equal(L.pickLogo(only({ square: SVG, wide: A(1) }), "share", false), A(1), "le SVG est sauté pour le partage");
  assert.equal(L.pickLogo(only({ square: SVG }), "share", false), null);
  assert.equal(L.pickLogo(only({ square: SVG }), "favicon", false), SVG);
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/app/uploads/[name]/route.ts"), /content-security-policy[\s\S]*default-src 'none'[\s\S]*sandbox/);
  assert.match(read("src/app/api/admin/upload/route.ts"), /form\.get\("kind"\) === "logo" && looksLikeSvg/, "autres envois : toujours pas de SVG");
  const page = read("src/app/admin/(panel)/settings/page.tsx");
  assert.ok(!/<ImageField svg name="logoShare"/.test(page), "pas de SVG pour l'image de partage");
  assert.match(page, /<ImageField svg name="logoWide"/);
});
