import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const L = await import("../scripts/licenses.mjs");

test("le projet a sa licence (MIT) et la déclare ; chaque module livré déclare la sienne", () => {
  assert.match(fs.readFileSync("LICENSE", "utf8"), /^MIT License/);
  assert.equal(JSON.parse(fs.readFileSync("package.json", "utf8")).license, "MIT");
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
