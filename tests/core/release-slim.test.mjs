import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pack = fs.readFileSync("scripts/release-pack.mjs", "utf8");
const smoke = fs.readFileSync("scripts/smoke-release.mjs", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("archive allégée : ce que le serveur de production n'utilise jamais n'est pas livré, et chaque exclusion est vérifiée absente par le test de fumée", () => {
  const list = JSON.parse(/NOT_SHIPPED = (\[.*?\]);/s.exec(pack)[1]);
  assert.ok(list.length >= 8);
  assert.match(pack, /--exclude=\$\{p\}/, "chaque exclusion est passée à tar");
  // l'essentiel : compilateur, sharp, TypeScript, SVG d'icônes, variantes wasm et moteurs en double
  for (const frag of ["@next/swc-", "next-swc-fallback", "@img", "node_modules/typescript", "simple-icons/icons", "runtime/*wasm*", "prisma/libquery_engine", "@prisma/engines/libquery_engine"]) assert.ok(list.some((p) => p.includes(frag)), `${frag} doit être exclu de l'archive`);
  // jamais ce dont le site a besoin pour démarrer (motif de tar : « * » = n'importe quels caractères hors « / »)
  const hit = (pattern, file) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}(/|$)`).test(file);
  for (const needed of ["node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node", "node_modules/.prisma/client/index.js", "node_modules/@prisma/client/runtime/library.js", "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x", "node_modules/next/dist/server/next.js", "node_modules/simple-icons/index.js", "node_modules/zod/package.json", "node_modules/react/index.js"]) {
    for (const p of list) assert.ok(!hit(p, needed), `${p} recouvre ${needed}, dont le site a besoin`);
  }
  assert.ok(!list.some((p) => /^node_modules\/(\.prisma|next|react|react-dom|zod|bcryptjs|next-auth)\/?$/.test(p)), "aucun paquet nécessaire n'est exclu en entier");
  for (const gone of ["@img", "typescript", "simple-icons/icons", "swc-linux-x64-gnu", "next-swc-fallback"]) assert.ok(smoke.includes(gone), `le test de fumée vérifie l'absence de ${gone}`);
  assert.match(smoke, /3000/, "le test de fumée vérifie que les icônes fonctionnent sans leurs SVG");
});

test("le serveur de production n'a besoin ni du compilateur ni de TypeScript : configuration en JavaScript, images non optimisées par Next, types en dépendances de développement ; sharp, lui, est une dépendance déclarée (recadrage des images)", () => {
  assert.ok(fs.existsSync("next.config.mjs") && !fs.existsSync("next.config.ts"));
  const cfg = fs.readFileSync("next.config.mjs", "utf8");
  assert.match(cfg, /images: \{ unoptimized: true \}/);
  assert.match(pack, /"next\.config\.mjs"/);
  assert.ok(!fs.readFileSync("package.json", "utf8").includes("\"@types/qrcode\"") || pkg.devDependencies["@types/qrcode"], "@types/qrcode est un outil de développement");
  assert.ok(!Object.keys(pkg.dependencies).some((d) => d.startsWith("@types/")), "aucun paquet de types en dépendance de production");
  assert.ok(pkg.dependencies.sharp, "sharp est déclaré : le recadrage des images en dépend, l'archive le livre");
  // le code n'emploie ni next/image ni TypeScript à l'exécution (sinon l'exclusion casserait le site) ; sharp n'est chargé que par core/imageDerive.ts, à la demande
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) assert.ok(!/next\/image|from "typescript"/.test(fs.readFileSync(f, "utf8")) && (f.endsWith("imageDerive.ts") || !/sharp/.test(fs.readFileSync(f, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""))), `${f} emploie un paquet que l'archive n'embarque pas`);
});

test("release archive: next.config.mjs starts without src/ (languages come from release.json) and still exposes the language rewrites", async () => {
  const { makeTempDir } = await import("../helpers/tmp.mjs");
  const dir = makeTempDir("archive-like-");
  try {
    // What the archive ships: no src/, but next.config.mjs, package.json, scripts/ and release.json (written by release-pack.mjs).
    fs.copyFileSync("next.config.mjs", `${dir}/next.config.mjs`);
    fs.copyFileSync("package.json", `${dir}/package.json`);
    fs.cpSync("scripts", `${dir}/scripts`, { recursive: true });
    assert.equal(fs.existsSync(`${dir}/src`), false);
    const load = async (name) => (await import(`file://${dir}/next.config.mjs?${name}`)).default.rewrites();
    const codes = (rewrites) => /\/:locale\(([^)]*)\)/.exec(rewrites.beforeFiles.find((r) => r.destination === "/:path*").source)[1].split("|");
    // 1. Neither src/ nor release.json: never throws, falls back to English and French.
    assert.deepEqual(codes(await load("none")), ["en", "fr"]);
    // 2. release.json written by the pack step: a community language keeps its prefix.
    fs.writeFileSync(`${dir}/release.json`, JSON.stringify({ languages: ["en", "fr", "de", "NOT_A_CODE"] }));
    assert.deepEqual(codes(await load("pack")), ["en", "fr", "de"]);
    // 3. Corrupt release.json: still no throw.
    fs.writeFileSync(`${dir}/release.json`, "{");
    assert.deepEqual(codes(await load("corrupt")), ["en", "fr"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(pack, /Object\.keys\(JSON\.parse\(fs\.readFileSync\("src\/locales\/languages\.json"[\s\S]*languages: languageCodes\(\)/, "the pack step writes the language codes into release.json");
});

test("smoke test: the archive is started like production (-H 127.0.0.1, X-Forwarded-Proto: https) and a secondary-language path must not fail", () => {
  assert.match(smoke, /"next", "start", "-H", "127\.0\.0\.1"/);
  assert.match(smoke, /x-forwarded-proto/);
  assert.match(smoke, /"\/fr", "\/fr\/privacy"/);
  assert.match(smoke, /\/fr\/introuvable/);
});
