// Crochets de chargement du banc d'essai (docs/SKINS.md §14) : permettent à Node d'importer les VRAIS composants du cœur (.tsx) sans Next ni base de données.
//   - `.tsx` : transpilé avec TypeScript (JSX automatique), comme le ferait le compilateur de Next ;
//   - les sources de DONNÉES (menu, réseaux sociaux, emplacements de modules, réglages) sont remplacées par de petits doubles aux données fixes (stubs/) :
//     les composants, eux, sont ceux du cœur, inchangés. Rien d'autre n'est remplacé.
// Ce fichier n'est utilisé que par `npm run skin:bench:refresh` (génération des fragments) ; le banc lui-même ne lit que les fragments produits.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const STUBS = path.join(HERE, "stubs");

/** Spécificateur (alias `@/…` ou relatif résolu) → double. Les chemins sont ceux de src/ sans extension. */
const REPLACED = new Map([
  ["core/social", "social.mjs"],
  ["core/menuResolve", "menu.mjs"],
  ["core/modules/runtime", "runtime.mjs"],
  ["core/settings", "settings.mjs"],
  ["core/db", "db.mjs"],
  ["core/feeds", "feeds.mjs"],
  ["core/modules/downloadAccess", "empty.mjs"],
  ["core/netHealthText", "empty.mjs"],
  ["components/admin/AdminBlocks", "empty.mjs"],
  ["components/admin/ui", "empty.mjs"],
  ["components/admin/GridEditor", "empty.mjs"],
  ["components/admin/floating", "empty.mjs"],
  ["components/admin/SuggestInstall", "empty.mjs"],
]);

function srcKey(file) {
  const rel = path.relative(path.join(ROOT, "src"), file).split(path.sep).join("/");
  if (rel.startsWith("..")) return null;
  return rel.replace(/\.(tsx?|mjs|js)$/, "").replace(/\/index$/, "");
}

const EXT = ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx"];
function firstExisting(base) {
  for (const e of EXT) { const f = base + e; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}

const NEXT_STUBBED = new Set(["next/headers", "next/navigation", "next/font/local"]);

export async function resolve(specifier, context, next) {
  if (NEXT_STUBBED.has(specifier)) return { url: pathToFileURL(path.join(STUBS, "next.mjs")).href, shortCircuit: true };
  let file = null;
  if (specifier.startsWith("@/")) file = firstExisting(path.join(ROOT, "src", specifier.slice(2)));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file://")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(path.join(ROOT, "src"))) file = firstExisting(path.resolve(path.dirname(parent), specifier));
  }
  if (file) {
    const key = srcKey(file);
    const stub = key && REPLACED.get(key);
    if (stub) return { url: pathToFileURL(path.join(STUBS, stub)).href, shortCircuit: true };
    return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return next(specifier, context);
}

/**
 * Les seuls écarts avec le code du cœur : l'ÉTAT INITIAL de deux composants à état, pour pouvoir montrer dans une planche le panneau du menu sobre ouvert et un
 * formulaire en erreur (un rendu serveur ne les montre jamais : ils n'existent qu'après un clic). Chaque motif est vérifié : s'il change dans le cœur, le banc le dit.
 */
const INITIAL_STATE = {
  "MenuToggle.tsx": [['useState(false)', 'useState(globalThis.__benchMenuOpen === true)']],
  "ModuleForm.tsx": [
    ['useState<"idle" | "sending" | "done" | "error">("idle")', 'useState(globalThis.__benchFormState ?? "idle")'],
    ['useState<string | null>(null)', 'useState(globalThis.__benchFormMessage ?? null)'],
  ],
};

let ts;
export async function load(url, context, next) {
  if (url.startsWith("file://") && /\.tsx$/.test(url)) {
    ts ??= (await import("typescript")).default;
    let source = fs.readFileSync(fileURLToPath(url), "utf8");
    const tweaks = INITIAL_STATE[path.basename(fileURLToPath(url))];
    for (const [from, to] of tweaks ?? []) {
      if (!source.includes(from)) throw new Error(`Le banc d'essai ne retrouve plus « ${from} » dans ${path.basename(fileURLToPath(url))} : mettez à jour testsupport/skins/bench/hooks.mjs.`);
      source = source.replace(from, to);
    }
    const out = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  if (url.startsWith("file://") && url.endsWith(".json") && url.includes("/src/")) {
    return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return next(url, context);
}
