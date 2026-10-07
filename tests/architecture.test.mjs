// Frontières d'architecture : le cœur OFFRE des services génériques ; les modules APPORTENT des
// fonctionnalités. Ces tests empêchent que l'un déborde sur l'autre. (`npm test`)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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
    "src/core/services/render.ts": [],
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
  const ids = ["blog", "links", "codes", "pages", "hero", "collection", "contact-form", "live-status", "ticker-overlay", "partnerships", "sponsors", "sponsor-ticker", "maze-overlay", "discord-announcer", "youtube-channel", "twitch-channel", "alerts-overlay", "game-suggestions", "contacts"];
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

test("l'identité visuelle a UNE source : le site, les overlays et les modules lisent la même palette", () => {
  const brand = read("src/core/brand.ts");
  assert.ok(brand.includes("buildPalette"), "brand.ts calcule sa palette avec buildPalette");
  assert.ok(read("src/core/color.ts").includes("buildPalette(background, accent)"), "buildTheme repose sur buildPalette");
  for (const f of ["src/app/(site)/layout.tsx", "src/app/overlays/[key]/page.tsx", "src/core/modules/context.ts"]) {
    assert.ok(read(f).includes("buildTheme"), `${f} doit lire le thème via buildTheme (même calcul que le site)`);
  }
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

test("sujets : ceux de nos modules sont en anglais, en minuscules, et listés dans docs/MODULES.md", () => {
  const doc = read("docs/MODULES.md");
  const used = new Set();
  for (const dir of ["modules-community", "modules-examples"]) {
    for (const mod of fs.readdirSync(dir)) {
      const file = `${dir}/${mod}/module.json`;
      if (fs.existsSync(file)) for (const m of read(file).matchAll(/"topic": *"([^"]+)"/g)) used.add(m[1]);
    }
  }
  for (const f of code("src/modules-builtin")) for (const m of read(f).matchAll(/\btopic: "([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size >= 5, "des sujets doivent être trouvés");
  for (const topic of used) {
    assert.match(topic, /^[a-z]+(\.[a-z]+)+$/, `sujet « ${topic} » : minuscules, domaine.objet`);
    assert.ok(doc.includes(`\`${topic}\``), `sujet « ${topic} » absent du tableau « Sujets connus » de docs/MODULES.md`);
  }
});

test("accueil fluide : la liste d'entrées s'adapte à la place de sa case, pas à la largeur de l'écran", () => {
  const list = read("src/components/site/EntryList.tsx");
  assert.ok(list.includes("auto-fill") && list.includes("minmax("), "colonnes intrinsèques (auto-fill + minmax)");
  assert.ok(!/\b(sm|md|lg|xl):grid-cols-/.test(list), "pas de colonnes réglées sur la largeur de l'écran : dans une case étroite, les cartes seraient écrasées");
});

test("le framework est agnostique de toute donnée métier : aucun nom de site, de marque ou de personne dans le dépôt", () => {
  // Les motifs sont assemblés pour que ce fichier ne contienne pas lui-même ce qu'il interdit.
  const forbidden = [["rosa", "li"], ["hell", "dog"], ["brux", "elles"], ["brus", "sels"]].map((p) => new RegExp(p.join(""), "i"));
  const AUTHOR = new RegExp(["hell", "dog136(\\.be)?"].join(""), "gi");
  const AUTHOR_FIELD = new RegExp(`author"?: "${["hell", "dog136"].join("")}"`, "gi");
  const ATTRIBUTION_FILES = new Set(["LICENSE", "README.md", "package.json", "scripts/licenses.mjs", "THIRD-PARTY-NOTICES.md"]);
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => f && !/(package-lock\.json|\.(png|jpe?g|ico|woff2?))$/.test(f) && fs.existsSync(f));
  assert.ok(files.length > 100, "les fichiers suivis doivent être listés");
  for (const f of files) {
    let text = fs.readFileSync(f, "utf8");
    // Seule exception : la mention du développeur du framework (licence, README, auteur du paquet, notices), rien d'autre.
    if (ATTRIBUTION_FILES.has(f)) text = text.replace(AUTHOR, "");
    text = text.replace(AUTHOR_FIELD, "");   // le champ « author » des modules livrés
    for (const re of forbidden) assert.ok(!re.test(text), `${f} contient une donnée propre à un site (${re.source}) : le framework doit rester neutre`);
  }
});

test("installation : chaque variable VITRINE_* lue par le code est documentée (.env.example ou docs/INSTALL.md)", () => {
  const doc = read(".env.example") + read("docs/INSTALL.md");
  const internal = new Set(["VITRINE_SERVER_PID"]); // passée par le serveur à la tâche de mise à jour, pas un réglage
  const used = new Set();
  for (const f of [...code("src"), "scripts/update.mjs", "scripts/update-lib.mjs"]) for (const m of read(f).matchAll(/process\.env\.(VITRINE_[A-Z_]+)/g)) used.add(m[1]);
  assert.ok(used.has("VITRINE_RESTART_COMMAND") && used.has("VITRINE_SUPERVISED") && used.has("VITRINE_INSTALL"));
  for (const v of used) if (!internal.has(v)) assert.ok(doc.includes(v), `${v} est lue par le code mais absente de .env.example / docs/INSTALL.md`);
});

test("mises à jour : le redémarrage n'est jamais supposé — sans commande ni superviseur, le serveur n'est pas coupé", () => {
  const lib = read("scripts/update-lib.mjs");
  assert.ok(lib.includes("supervised && serverPid"), "arrêt du serveur seulement s'il est supervisé");
  assert.ok(lib.includes('restart: "needed"') || lib.includes('save({ restart: "needed" })'));
});

test("pages d'admin : aucune fonction anonyme passée à un formulaire client (React la refuse) — on passe l'action serveur elle-même", () => {
  for (const f of code("src/app/admin")) {
    if (!f.endsWith(".tsx") || /^\s*["']use client["']/.test(read(f))) continue;
    assert.ok(!/<ActionForm[^>]*action=\{(async\s*)?\(/.test(read(f)), `${f} : <ActionForm action={() => …}> n'est pas sérialisable ; exportez une action depuis actions.ts`);
  }
});
