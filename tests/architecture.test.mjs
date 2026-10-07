// Frontières d'architecture : le cœur OFFRE des services génériques ; les modules APPORTENT des
// fonctionnalités. Ces tests empêchent que l'un déborde sur l'autre. (`npm test`)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      })
    : [];
/** Spécificateurs d'import / export-from d'un fichier source. */
const importsOf = (file) => [...read(file).matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const code = (dir) => walk(dir).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));

test("les services du cœur sont génériques : chacun n'importe que ce qu'il a le droit de connaître", () => {
  // service → imports autorisés (hors modules node:*, paquets tiers et fichiers du même service)
  const rules = {
    "src/core/services/qr.ts": [],
    "src/core/services/store.ts": ["@/core/db"],
    "src/core/services/uploads.ts": ["@/core/config"],
    "src/core/services/index.ts": [],
    // Le mécanisme MCP ne connaît ni les modules, ni le contenu, ni les instances.
    "src/core/services/mcp": ["@/core/db", "@/core/settings", "@/core/modules/types"],
    // Les sujets connaissent les modules (c'est leur objet) ; le sujet du cœur vient du moteur de contenu.
    "src/core/services/topics.ts": ["@/core/content/topics", "@/core/instances", "@/core/settings", "@/core/modules/context", "@/core/modules/registry", "@/core/modules/types"],
  };
  for (const [target, allowed] of Object.entries(rules)) {
    const files = fs.statSync(target).isDirectory() ? code(target) : [target];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith("@/") && !spec.startsWith("../")) continue; // tiers, node:, next/…
        assert.ok(allowed.includes(spec), `${file} importe « ${spec} » : un service du cœur ne doit pas dépendre de cela`);
      }
    }
  }
});

test("aucun service du cœur ne cite un module en particulier", () => {
  const ids = fs.readdirSync("src/modules-builtin", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  ids.push("blog", "links", "codes", "pages", "hero", "partnerships", "sponsors", "maze-overlay");
  for (const file of code("src/core/services")) {
    for (const id of new Set(ids)) assert.ok(!new RegExp(`["'\`]${id}["'\`]`).test(read(file)), `${file} cite le module « ${id} »`);
  }
});

test("le cœur (hors registre des modules livrés) ne connaît aucun module par son identifiant", () => {
  const ids = ["blog", "links", "codes", "pages", "hero", "collection", "feeds", "contact-form", "live-status", "ticker-overlay", "partnerships", "sponsors", "sponsor-ticker", "maze-overlay"];
  for (const file of [...code("src/core"), ...code("src/app"), ...code("src/components")]) {
    if (file.endsWith("src/core/modules/registry.ts")) continue; // importe la liste des modules livrés
    const text = read(file);
    for (const id of ids) {
      // Une valeur de display ("links", "codes") ou un type de bloc n'est pas un identifiant de module : on ne
      // cherche que les comparaisons/accès directs à un module précis.
      assert.ok(!new RegExp(`(manifest\\.id|moduleId|\\.id)\\s*===?\\s*["']${id}["']`).test(text), `${file} compare un identifiant à « ${id} »`);
      assert.ok(!new RegExp(`find\\([^)]*===\\s*["']${id}["']`).test(text), `${file} cherche le module « ${id} »`);
    }
  }
});

test("les modules (livrés, communautaires, exemples) n'importent rien du cœur hormis les types", () => {
  for (const file of code("src/modules-builtin")) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith("@/")) continue;
      assert.ok(["@/core/modules/types", "@/core/modules/manifest"].includes(spec) || spec === "@/modules-builtin", `${file} importe « ${spec} »`);
    }
  }
  for (const dir of ["modules-community", "modules-examples"]) {
    for (const file of code(dir)) {
      for (const spec of importsOf(file)) assert.ok(!spec.startsWith("@/") && !spec.includes("/src/"), `${file} importe du cœur (« ${spec} ») : un module n'a que ctx.api`);
    }
  }
});

test("les modules n'appellent jamais Prisma ni le disque du cœur : tout passe par ctx.api", () => {
  for (const dir of ["modules-community", "modules-examples"]) {
    for (const file of code(dir).filter((f) => f.endsWith(".mjs"))) {
      assert.ok(!/prisma|@prisma\/client/.test(read(file)), `${file} accède directement à la base`);
    }
  }
});

test("chaque service du catalogue existe et est documenté dans docs/PLATFORM.md", () => {
  const catalogue = read("src/core/services/index.ts");
  const doc = read("docs/PLATFORM.md");
  for (const m of catalogue.matchAll(/id: "([a-z]+)".*?where: "([^"]+)"/g)) {
    assert.ok(fs.existsSync(`src/core/${m[2]}`), `service ${m[1]} : ${m[2]} introuvable`);
    assert.ok(doc.includes(`\`${m[1]}\``) || doc.includes(m[2]), `service ${m[1]} absent de docs/PLATFORM.md`);
  }
});

test("le service QR produit un SVG et borne l'entrée", async () => {
  const { qrSvg } = await import("../src/core/services/qr.ts");
  const svg = await qrSvg("https://example.com");
  assert.match(svg, /^<svg/);
  assert.ok((await qrSvg("x".repeat(5000))).startsWith("<svg"));
});

test("le kit presse ne stocke rien : il lit l'identité du cœur (ctx.api.brand) et c'est tout", () => {
  const code = read("src/modules-builtin/press-kit/index.ts");
  assert.ok(code.includes("ctx.api.brand"), "le kit presse doit lire l'identité via ctx.api.brand");
  for (const forbidden of ["ctx.api.store", "adminActions", "adminPanel", "setSetting", "prisma"]) {
    assert.ok(!code.includes(forbidden), `le kit presse ne doit pas utiliser « ${forbidden} » : il n'a aucune donnée à lui`);
  }
});

test("l'identité visuelle a UNE source : le site et les modules lisent la même palette", () => {
  const brand = read("src/core/brand.ts");
  const layout = read("src/app/(site)/layout.tsx");
  assert.ok(brand.includes("buildPalette") && layout.includes("buildPalette"), "brand.ts et le layout doivent partager buildPalette");
});

test("une case à cocher lue avec getAll() porte une valeur (sinon le navigateur envoie « on »)", () => {
  const files = [...code("src/app"), ...code("src/components")];
  const names = new Set();
  for (const f of files) for (const m of read(f).matchAll(/formData\.getAll\(\s*"([^"]+)"/g)) names.add(m[1]);
  for (const f of files) {
    for (const m of read(f).matchAll(/<Checkbox\b[^>]*?name="([^"]+)"[^>]*?\/?>/g)) {
      if (names.has(m[1])) assert.ok(/\bvalue=/.test(m[0]), `${f} : <Checkbox name="${m[1]}"> est lu avec getAll() mais n'a pas de value`);
    }
  }
});

test("l'admin ne montre pas les identifiants techniques d'instance en mode simple", () => {
  // L'identifiant technique (instance.key / i.key) n'apparaît dans l'interface que derrière « advanced ».
  const listing = read("src/app/admin/(panel)/modules/page.tsx");
  assert.ok(/advanced && <span className="font-mono">\{i\.key\}/.test(listing), "la liste des modules ne doit montrer la clé qu'en mode avancé");
  const detail = read("src/app/admin/(panel)/instances/[id]/page.tsx");
  assert.ok(/advanced && <>[^]*instances\.technicalId[^]*instance\.key/.test(detail), "la page d'une instance ne doit montrer la clé qu'en mode avancé");
});
