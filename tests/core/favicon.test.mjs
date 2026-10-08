import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { defaultFaviconSvg, faviconUrl } = await import("@/core/favicon");
const { sanitizeSvg } = await import("@/core/svg");

test("favicon : l'icône par défaut est un SVG valide aux couleurs du site, sans texte, et accepté par notre propre assainisseur", () => {
  const svg = defaultFaviconSvg("#117d83", "#031a1c");
  assert.match(svg, /^<svg [^>]*viewBox="0 0 64 64"/);
  assert.ok(svg.includes('fill="#117d83"') && svg.includes('fill="#031a1c"') && !/<text|<script|<image/.test(svg));
  assert.equal(sanitizeSvg(svg).ok, true);
  assert.notEqual(defaultFaviconSvg("#d6336c", "#1c1020"), svg, "suit les couleurs du site");
});

test("favicon : couleurs invalides → valeurs sûres (jamais de contenu libre dans le SVG généré)", () => {
  const svg = defaultFaviconSvg('red" onload="x', "url(javascript:1)");
  assert.ok(!svg.includes("onload") && !svg.includes("javascript"));
  assert.equal(sanitizeSvg(svg).ok, true);
});

test("favicon : l'image envoyée l'emporte, sinon /icon ; câblé dans le site, l'admin et les réglages", () => {
  assert.equal(faviconUrl("/uploads/123e4567-e89b-12d3-a456-426614174000.png"), "/uploads/123e4567-e89b-12d3-a456-426614174000.png");
  assert.equal(faviconUrl(null), "/icon");
  assert.match(fs.readFileSync("src/app/(site)/layout.tsx", "utf8"), /icons: \{ icon: faviconUrl\(config\.favicon\)/);
  assert.match(fs.readFileSync("src/app/admin/layout.tsx", "utf8"), /icons: \{ icon: faviconUrl\(/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8"), /name="favicon"/);
  const actions = fs.readFileSync("src/app/admin/(panel)/settings/actions.ts", "utf8");
  assert.match(actions, /favicon\.startsWith\("\/uploads\/"\) \|\| \/\^https:/, "uploads ou https seulement (jamais http, javascript:…)");
  for (const f of ["src/app/icon/route.ts", "src/app/favicon.ico/route.ts"]) assert.ok(fs.existsSync(f), f);
  const cfg = fs.readFileSync("src/core/config.ts", "utf8");
  assert.ok(cfg.includes('"icon"') && cfg.includes('"favicon.ico"'), "chemins réservés : aucune collection ne peut les prendre");
});
