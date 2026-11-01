// La bibliothèque de polices embarquée (docs/POLICES.md) : chaque fichier a sa licence, son auteur, sa source, une taille raisonnable et la bonne empreinte ;
// le budget total est tenu et documenté ; aucun nom réservé ; tous les fichiers sont de vraies polices WOFF2 ; l'archive de release les contient.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { loadLibrary, resetLibraryCache, urlNameOf, libraryDir } = await import("@/core/fonts/library");
const { checkWoff2 } = await import("@/core/fonts/woff2");
const { FONT_GROUPS } = await import("@/core/fonts/types");

const lib = loadLibrary();
const dir = libraryDir();
const MAX_FILE = 40 * 1024;
const MAX_TOTAL = 1.5 * 1024 * 1024;

test("bibliothèque : de quinze à vingt familles, six groupes, graisses 400 et 700 seulement", () => {
  assert.ok(lib.families.length >= 15 && lib.families.length <= 20, `${lib.families.length} familles`);
  assert.equal(new Set(lib.families.map((f) => f.id)).size, lib.families.length, "identifiants uniques");
  assert.deepEqual([...new Set(lib.families.map((f) => f.group))].sort(), [...FONT_GROUPS].sort(), "chaque groupe a au moins une famille");
  for (const f of lib.families) {
    assert.ok(f.weights.every((w) => w === 400 || w === 700) && f.weights.includes(400), f.id);
    assert.ok(f.files.some((x) => x.subset === "latin"), `${f.id} : le latin est là`);
    assert.deepEqual([...new Set(f.files.map((x) => x.weight))].sort(), f.weights, `${f.id} : graisses annoncées = graisses livrées`);
  }
});

test("licences : chaque famille a sa licence OFL-1.1 (fichier présent, texte réel), son auteur, sa source et sa mention de droits ; aucun nom réservé", () => {
  for (const f of lib.families) {
    assert.equal(f.license, "OFL-1.1", f.id);
    assert.ok(f.author && f.source.startsWith("https://") && f.copyright, `${f.id} : auteur, source, droits`);
    const text = fs.readFileSync(path.join(dir, f.licenseFile), "utf8");
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/, f.id);
    assert.doesNotMatch(text.split("This Font Software")[0], /with Reserved Font Name/i, `${f.id} : un nom réservé interdit de publier une version modifiée sous ce nom`);
  }
  const credits = fs.readFileSync(path.join(dir, "CREDITS.md"), "utf8");
  for (const f of lib.families) assert.ok(credits.includes(f.name) && credits.includes(f.source), `CREDITS.md cite ${f.name}`);
  assert.deepEqual(fs.readdirSync(path.join(dir, "LICENSES")).sort(), lib.families.map((f) => `${f.id}-OFL.txt`).sort(), "ni licence orpheline, ni famille sans licence");
});

test("fichiers : présents, ≤ 40 Ko, bonne empreinte, vraies polices WOFF2 ; aucun fichier qui ne soit pas dans l'inventaire ; budget total tenu", () => {
  let total = 0;
  const listed = new Set();
  for (const f of lib.families) for (const x of f.files) {
    const bytes = fs.readFileSync(path.join(dir, "files", x.file));
    listed.add(x.file);
    total += bytes.length;
    assert.equal(bytes.length, x.bytes, `${x.file} : taille de l'inventaire`);
    assert.ok(bytes.length <= MAX_FILE, `${x.file} : ${bytes.length} octets`);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), x.sha256, `${x.file} : empreinte`);
    const r = checkWoff2(bytes, MAX_FILE);
    assert.ok(r.ok, `${x.file} : ${JSON.stringify(r)}`);
    assert.ok(r.family.startsWith(f.name), `${x.file} : le nom écrit dans le fichier (${r.family}) est celui de l'inventaire`);
    assert.equal(r.weight, String(x.weight), `${x.file} : la graisse écrite dans le fichier`);
  }
  assert.deepEqual(fs.readdirSync(path.join(dir, "files")).sort(), [...listed].sort());
  assert.ok(total <= MAX_TOTAL, `bibliothèque : ${total} octets (budget ${MAX_TOTAL})`);
  assert.match(fs.readFileSync("docs/POLICES.md", "utf8"), new RegExp(`${lib.families.reduce((n, f) => n + f.files.length, 0)} fichiers`), "le budget documenté est celui du dépôt");
});

test("adresses : une empreinte de dix caractères, uniques, relues du disque ; une bibliothèque absente est vide, sans erreur", () => {
  const names = lib.families.flatMap((f) => f.files.map(urlNameOf));
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z0-9-]+-(?:400|700)-(?:latin|latin-ext)\.[0-9a-f]{10}\.woff2$/);
  assert.deepEqual(loadLibrary(path.join(dir, "nulle-part")).families, []);
  assert.deepEqual(loadLibrary(path.join(dir, "files")).families, [], "un dossier sans inventaire");
  resetLibraryCache();
  assert.equal(loadLibrary().families.length, lib.families.length);
});

test("release : l'archive embarque le dossier fonts ; l'inventaire est dans le dépôt", () => {
  assert.match(fs.readFileSync("scripts/release-pack.mjs", "utf8"), /"fonts"/);
  assert.ok(fs.existsSync("fonts/library.json"));
});
