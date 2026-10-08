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

test("le serveur de production n'a besoin ni du compilateur ni de TypeScript ni de sharp : configuration en JavaScript, images non optimisées, types en dépendances de développement", () => {
  assert.ok(fs.existsSync("next.config.mjs") && !fs.existsSync("next.config.ts"));
  const cfg = fs.readFileSync("next.config.mjs", "utf8");
  assert.match(cfg, /images: \{ unoptimized: true \}/);
  assert.match(pack, /"next\.config\.mjs"/);
  assert.ok(!fs.readFileSync("package.json", "utf8").includes("\"@types/qrcode\"") || pkg.devDependencies["@types/qrcode"], "@types/qrcode est un outil de développement");
  assert.ok(!Object.keys(pkg.dependencies).some((d) => d.startsWith("@types/")), "aucun paquet de types en dépendance de production");
  // le code n'emploie ni sharp ni next/image (sinon l'exclusion casserait le site)
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) assert.ok(!/from "sharp"|next\/image|from "typescript"/.test(fs.readFileSync(f, "utf8")), `${f} emploie un paquet que l'archive n'embarque pas`);
});
