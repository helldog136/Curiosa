import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const L = await import("../scripts/licenses.mjs");

test("le projet a sa licence (Curiosa License) et la déclare ; chaque module livré déclare la sienne", () => {
  const text = fs.readFileSync("LICENSE", "utf8");
  assert.match(text, /^Curiosa License, Version 1\.0/);
  assert.equal(JSON.parse(fs.readFileSync("package.json", "utf8")).license, "SEE LICENSE IN LICENSE");
  // Les trois exigences du propriétaire : usage pour sa propre activité (même commerciale) permis, vente interdite, crédit obligatoire, modules tiers libres.
  assert.match(text, /including\s+a commercial or profit-making activity/);
  assert.match(text, /Sell the Software or any Derivative Work/);
  assert.match(text, /hosted, managed or\s+white-label service/);
  assert.match(text, /Powered by Curiosa", where "Curiosa" is a link to the project\s+repository \(https:\/\/github\.com\/helldog136\/Curiosa\)/);
  assert.match(text, /3\. WHAT YOU MAY NOT DO[\s\S]*6\. THIRD-PARTY MODULES[\s\S]*free of the restrictions of section 3/);
  assert.match(text, /Versions of the Software released before version 0\.1\.2-rc\.4 were published under the MIT/);
});

test("le crédit « développé par » est affiché sur toutes les pages publiques (pied de page du site)", () => {
  const footer = fs.readFileSync("src/components/site/Footer.tsx", "utf8");
  assert.match(footer, /data-testid="credit"/);
  assert.match(footer, /href=\{CREDIT_URL\}[^>]*>Curiosa<\/a>/);
  assert.match(fs.readFileSync("src/core/credit.ts", "utf8"), /CREDIT_URL = "https:\/\/github\.com\/helldog136\/Curiosa"/);
  assert.ok(!/readVersion|version/i.test(footer), "jamais de numéro de version côté public");
  assert.match(fs.readFileSync("src/app/(site)/layout.tsx", "utf8"), /<Footer /);
  for (const dir of ["modules-community", "modules-examples"]) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const m = JSON.parse(fs.readFileSync(`${dir}/${d.name}/module.json`, "utf8"));
      assert.ok(m.license, `${dir}/${d.name} : licence absente de module.json`);
    }
  }
});

test("politique : aucune dépendance de production sous une licence qui contaminerait le projet (GPL, AGPL, SSPL…) ou inconnue", () => {
  for (const p of L.productionPackages()) {
    assert.ok(p.license !== "UNKNOWN", `${p.name}@${p.version} : licence inconnue`);
    assert.ok(!/(^|[^L])GPL|AGPL|SSPL|BUSL|Commons-Clause/i.test(p.license.replace(/LGPL/g, "")), `${p.name}@${p.version} : licence ${p.license} non acceptée`);
  }
});

test("THIRD-PARTY-NOTICES.md est à jour avec package-lock.json (npm run licenses)", () => {
  execFileSync("node", ["scripts/licenses.mjs", "--check"], { stdio: "pipe" });
});

test("le texte de chaque licence de dépendance de production est reproduit quand le paquet en fournit un", () => {
  const notice = fs.readFileSync("THIRD-PARTY-NOTICES.md", "utf8");
  assert.ok(notice.includes("Permission is hereby granted, free of charge"), "texte MIT présent");
  for (const p of L.productionPackages()) assert.ok(notice.includes(`${p.name}@${p.version}`), `${p.name}@${p.version} absent des notices`);
});
