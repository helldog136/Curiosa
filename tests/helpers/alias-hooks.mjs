import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stubs = path.join(root, "tests/helpers/stubs");

// Paquets Next que le code du cœur importe mais qui n'ont de sens que dans un serveur Next : remplacés par de petits doubles.
const STUBBED = new Map([
  ["next/headers", "next-headers.mjs"],
  ["next/navigation", "next-navigation.mjs"],
  ["next/cache", "next-cache.mjs"],
  // La session (next-auth) : choisie par le test (stubs/auth.mjs).
  ["@/auth", "auth.mjs"],
]);

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

function firstExisting(base) {
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (STUBBED.has(specifier)) return { url: pathToFileURL(path.join(stubs, STUBBED.get(specifier))).href, shortCircuit: true };

  // Alias du projet : "@/core/db" → src/core/db.ts
  if (specifier.startsWith("@/")) {
    const file = firstExisting(path.join(root, "src", specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }

  // Imports relatifs sans extension écrits pour le bundler : "./slug" → ./slug.ts
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file://")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(path.join(root, "src"))) {
      const file = firstExisting(path.resolve(path.dirname(parent), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }

  // Sous-chemins de paquets Next sans extension ("next/server" → next/server.js)
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  return next(specifier, context);
}

/** Les composants du site et de l'administration sont en .tsx : transpilés à la volée (TypeScript, JSX automatique), pour les rendre avec react-dom/server dans les tests. */
let tsPromise = null;
async function transpileTsx(file) {
  tsPromise ??= import("typescript").then((m) => m.default ?? m);
  const ts = await tsPromise;
  return ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}

export async function load(url, context, next) {
  if (url.startsWith("file://") && url.endsWith(".tsx") && url.includes("/src/")) {
    return { format: "module", source: await transpileTsx(fileURLToPath(url)), shortCircuit: true };
  }
  // JSON importé sans attribut `with { type: "json" }` (comme le fait le bundler) : servi comme module.
  if (url.startsWith("file://") && url.endsWith(".json") && url.includes("/src/")) {
    const text = fs.readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return next(url, context);
}
