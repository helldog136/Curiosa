// Faux dépôt « curiosa-extras » pour les tests. Le cœur ne contient aucun module et le catalogue vient UNIQUEMENT du réseau : un test qui a besoin
// d'un catalogue en fabrique donc un, ici — un VRAI dépôt git local (un dossier par module sous modules/, une étiquette épinglée par version) avec son
// index factice (catalogue/index.json) et sa liste de suggestions (catalogue/suggested.json). Aucun réseau : l'adresse https qu'annonce l'index est
// redirigée vers le dépôt local par un gitconfig global jetable, et CURIOSA_CATALOGUE_REPO désigne ce dépôt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "./repo.mjs";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/extras");
export const CATALOGUE_HTTPS = "https://github.com/test/curiosa-extras";
const code = (marker) => `export default { marker: ${JSON.stringify(marker)} };\n`;
const man = (id, over = {}) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...over });

/**
 * Crée le catalogue de test et l'installe dans l'environnement du processus. À appeler APRÈS useTestDb().
 *   cat.add(id, { manifest, marker, files, entry })   publie une version du module (commit + étiquette `<id>-v<version>`) et la liste dans l'index
 *   cat.fixtures(["blog", ...], { suggested })        publie des modules de tests/fixtures/extras tels quels
 *   cat.setIndex(...entrées brutes) · cat.suggest(ids) · cat.unlist(id) · cat.down({ forget }) · cat.up() · cat.clear()
 */
export function createCatalogue() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-cat-"));
  const gitconfig = process.env.GIT_CONFIG_GLOBAL || path.join(tmp, "gitconfig");
  const repo = makeRepo({ "catalogue/index.json": { version: 1, modules: [] }, "catalogue/suggested.json": [] });
  fs.appendFileSync(gitconfig, `[url "${repo.url}"]\n\tinsteadOf = ${CATALOGUE_HTTPS}\n`);
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  const indexFile = path.join(repo.dir, "catalogue/index.json");
  const suggestedFile = path.join(repo.dir, "catalogue/suggested.json");
  const index = () => JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const forget = async () => (await import("@/core/modules/recognized")).clearRecognizedCache();
  const commit = (message) => { repo.g("add", "-A"); repo.g("commit", "-q", "--allow-empty", "--no-verify", "-m", message); };
  const self = {
    dir: repo.dir, url: repo.url, https: CATALOGUE_HTTPS, repo,
    /** Publie une version d'un module du catalogue. Renvoie l'entrée d'index. */
    async add(id, { manifest = {}, marker = "v1", files = {}, entry = {}, listed = true } = {}) {
      const m = man(id, manifest);
      const base = path.join(repo.dir, "modules", id);
      fs.rmSync(base, { recursive: true, force: true });
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, "module.json"), JSON.stringify(m));
      fs.writeFileSync(path.join(base, "index.mjs"), code(marker));
      for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true }); fs.writeFileSync(path.join(base, name), typeof content === "string" ? content : JSON.stringify(content)); }
      const tag = `${id}-v${m.version}`;
      commit(`${id} ${m.version}`);
      repo.g("tag", "-f", tag);
      const item = { id, name: m.name, description: m.description ?? "d", repo: CATALOGUE_HTTPS, subdir: `modules/${id}`, ref: tag, version: m.version, apiVersion: m.apiVersion, ...entry };
      if (listed) { const idx = index(); idx.modules = [...idx.modules.filter((x) => x.id !== id), item]; fs.writeFileSync(indexFile, JSON.stringify(idx)); commit(`index ${id}`); }
      await forget();
      return item;
    },
    /** Publie des modules de tests/fixtures/extras/modules ou /examples (manifeste et fichiers tels quels). */
    async fixtures(ids, { suggested } = {}) {
      for (const id of ids) {
        const src = [path.join(fixtures, "modules", id), path.join(fixtures, "examples", id)].find((d) => fs.existsSync(d)) ?? path.join(fixtures, "modules", id);
        const dst = path.join(repo.dir, "modules", id);
        fs.rmSync(dst, { recursive: true, force: true });
        fs.cpSync(src, dst, { recursive: true });
        const m = JSON.parse(fs.readFileSync(path.join(src, "module.json"), "utf8"));
        const tag = `${id}-v${m.version}`;
        commit(`${id} ${m.version}`);
        repo.g("tag", "-f", tag);
        const idx = index();
        idx.modules = [...idx.modules.filter((x) => x.id !== id), { id, name: typeof m.name === "string" ? m.name : (m.name.fr ?? m.name.en ?? id), description: typeof m.description === "string" ? m.description : (m.description?.fr ?? m.description?.en ?? ""), repo: CATALOGUE_HTTPS, subdir: `modules/${id}`, ref: tag, version: m.version, apiVersion: m.apiVersion }];
        fs.writeFileSync(indexFile, JSON.stringify(idx));
      }
      if (suggested) fs.writeFileSync(suggestedFile, JSON.stringify(suggested));
      commit("fixtures");
      await forget();
    },
    /** Remplace l'index tel quel (entrées brutes, sans dépôt de module derrière) : pour les tests de lecture de l'index. */
    async setIndex(...entries) { self.writeIndex(...entries); await forget(); },
    /** Comme setIndex, mais synchrone (l'appelant vide lui-même la mémoire du catalogue : clearRecognizedCache). */
    writeIndex(...entries) { fs.writeFileSync(indexFile, JSON.stringify({ version: 1, modules: entries })); commit("index"); },
    /** Remplace la liste « suggérés » du dépôt du catalogue. */
    async suggest(ids) { fs.writeFileSync(suggestedFile, JSON.stringify(ids)); commit("suggested"); await forget(); },
    /** Retire un module de l'index (son dossier reste dans le dépôt). */
    async unlist(id) { const idx = index(); idx.modules = idx.modules.filter((x) => x.id !== id); fs.writeFileSync(indexFile, JSON.stringify(idx)); commit(`unlist ${id}`); await forget(); },
    /** Catalogue injoignable (panne réseau). `forget` : la dernière copie reçue (data/cache) est oubliée aussi. */
    async down({ forget: wipe = false } = {}) {
      process.env.CURIOSA_CATALOGUE_REPO = "file:///nonexistent/curiosa-extras";
      if (wipe) fs.rmSync(path.join(process.env.DATA_DIR, "cache", "recognized-index.json"), { force: true });
      await forget();
    },
    async up() { process.env.CURIOSA_CATALOGUE_REPO = repo.url; await forget(); },
    /** Remet le catalogue à zéro (entre deux tests). */
    async clear() {
      fs.rmSync(path.join(repo.dir, "modules"), { recursive: true, force: true });
      fs.writeFileSync(indexFile, JSON.stringify({ version: 1, modules: [] })); fs.writeFileSync(suggestedFile, "[]");
      commit("clear");
      for (const t of repo.g("tag", "-l").toString().split("\n").filter(Boolean)) repo.g("tag", "-d", t);
      await self.up();
    },
    close() { fs.rmSync(repo.dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
  process.env.CURIOSA_CATALOGUE_REPO = repo.url;
  return self;
}
