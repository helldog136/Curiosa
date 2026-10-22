// Scripts de page d'un module : fichiers du dossier scripts/, servis par le cœur, bornés, jamais en ligne.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { pageScriptTags, readModuleScript, MAX_PAGE_SCRIPTS, MAX_SCRIPT_BYTES, scriptVersion } = await import("@/core/modules/pageScripts");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ps-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));
fs.mkdirSync(path.join(base, "scripts"));
const put = (name, text) => fs.writeFileSync(path.join(base, "scripts", name), text);
put("a.js", "console.log('a');");
put("b.js", "console.log('b');");
put("c.js", "1");
put("d.js", "2");
put("big.js", "x".repeat(MAX_SCRIPT_BYTES + 1));
fs.writeFileSync(path.join(base, "secret.js"), "SECRET");
fs.symlinkSync(path.join(base, "secret.js"), path.join(base, "scripts", "link.js"));

test("un script déclaré donne une adresse du cœur, une empreinte SRI sha256 et une version dans l'adresse", () => {
  const [t] = pageScriptTags("monsite", "faq", ["a.js"], base);
  assert.match(t.src, /^\/m\/faq\/_script\/a\.js\?v=[A-Za-z0-9]{12}$/);
  assert.match(t.integrity, /^sha256-[A-Za-z0-9+/]{43}=$/);
  assert.equal(t.src.split("?v=")[1], scriptVersion(t.integrity));
});

test("l'empreinte suit le contenu", () => {
  const before = pageScriptTags("monsite", "faq", ["c.js"], base)[0].integrity;
  put("c.js", "changed");
  assert.notEqual(pageScriptTags("monsite", "faq", ["c.js"], base)[0].integrity, before);
});

test("bornes : 3 scripts au plus, doublons écartés, trop gros / absent / lien symbolique / nom suspect ignorés", () => {
  assert.equal(MAX_PAGE_SCRIPTS, 3);
  assert.equal(pageScriptTags("monsite", "faq", ["a.js", "a.js", "b.js", "c.js", "d.js"], base).length, 3);
  for (const bad of ["big.js", "none.js", "link.js", "../secret.js", "..%2Fsecret.js", "a/b.js", "A.js", "a.mjs", "a.js\n", "", 7, null, {}]) {
    assert.deepEqual(pageScriptTags("monsite", "faq", [bad], base), [], String(bad));
  }
  assert.deepEqual(pageScriptTags("monsite", "faq", "a.js", base), []);
  assert.deepEqual(pageScriptTags("monsite", "faq", undefined, base), []);
  assert.equal(readModuleScript("monsite", "link.js", base), null);
  assert.equal(readModuleScript("monsite", "a.js", base)?.body.toString(), "console.log('a');");
});

test("lecture d'une liste énorme : seuls les 20 premiers noms sont regardés", () => {
  const many = Array.from({ length: 5000 }, () => "none.js");
  assert.deepEqual(pageScriptTags("monsite", "faq", many, base), []);
});
