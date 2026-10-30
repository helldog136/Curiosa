// Faux dépôt « curiosa-skins » pour les tests. Comme tests/helpers/catalogue.mjs pour les modules : un VRAI dépôt git local (un dossier par skin sous skins/,
// une étiquette `<id>-v<version>` par version publiée) avec son index factice (catalogue/index.json). Aucun réseau : l'adresse https que l'index annonce est
// redirigée vers le dépôt local par le gitconfig global jetable de useTestDb(), et CURIOSA_SKINS_REPO désigne ce dépôt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo } from "./repo.mjs";
import { makeTempDir } from "./tmp.mjs";

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/skins");
export const SKINS_HTTPS = "https://github.com/test/curiosa-skins";
/** Le cœur « de test » : les fixtures suivent l'exemple du §17 de docs/SKINS.md (minCore 0.4.0). */
export const TEST_CORE = "0.4.0";

/** Copie un dossier de fixture sous un autre id (et le patche) : `copySkin("plain-light", dest, { id, version, patch(manifest) })`. */
export function copySkin(fixture, dest, { id, version, patch, files } = {}) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(FIXTURES, fixture), dest, { recursive: true });
  const file = path.join(dest, "skin.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (id) m.id = id;
  if (version) m.version = version;
  patch?.(m);
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  for (const [name, content] of Object.entries(files ?? {})) {
    if (content === null) { fs.rmSync(path.join(dest, name), { recursive: true, force: true }); continue; }
    fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
    fs.writeFileSync(path.join(dest, name), content);
  }
  return m;
}

/** Octets minimaux avec la bonne signature (les contrôles lisent les premiers octets). */
export const fakeFont = (n = 64) => Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(n)]);
export const fakePng = (n = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
export const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cccccc"/></svg>';

export function createSkinsRepo() {
  const tmp = makeTempDir("curiosa-skins-");
  const gitconfig = process.env.GIT_CONFIG_GLOBAL || path.join(tmp, "gitconfig");
  const repo = makeRepo({ "catalogue/index.json": { version: 1, skins: [] }, "README.md": "# faux dépôt de skins\n" });
  fs.appendFileSync(gitconfig, `[url "${repo.url}"]\n\tinsteadOf = ${SKINS_HTTPS}\n`);
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  const indexFile = path.join(repo.dir, "catalogue/index.json");
  const index = () => JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const forget = async () => (await import("@/core/skins/catalogue")).clearSkinCatalogueCache();
  const commit = (message) => { repo.g("add", "-A"); repo.g("commit", "-q", "--allow-empty", "--no-verify", "-m", message); };
  const self = {
    dir: repo.dir, url: repo.url, https: SKINS_HTTPS, repo,
    /**
     * Publie une version d'un skin : copie la fixture sous skins/<id>, la patche, commit + étiquette `<id>-v<version>`, et (listed) la met à l'index.
     * `tag: false` : pas d'étiquette. `entry` : champs de l'entrée d'index à remplacer. Renvoie l'entrée.
     */
    async publish(id, { from = "plain-light", version = "1.0.0", patch, files, listed = true, entry = {}, tag = `${id}-v${version}`, folder = id } = {}) {
      const dest = path.join(repo.dir, "skins", folder);
      const m = copySkin(from, dest, { id, version, patch, files });
      commit(`${id} ${version}`);
      if (tag) repo.g("tag", "-f", tag);
      const item = { id, name: m.name, description: m.description, repo: SKINS_HTTPS, subdir: `skins/${folder}`, ref: tag || undefined, version, skinContract: m.skinContract, author: m.author?.name, tags: m.tags, modes: m.modes, requires: { core: m.minCore }, ...entry };
      if (listed) { const idx = index(); idx.skins = [...idx.skins.filter((x) => x.id !== id), item]; fs.writeFileSync(indexFile, JSON.stringify(idx)); commit(`index ${id}`); }
      await forget();
      return item;
    },
    /** Remplace l'index tel quel (entrées brutes). */
    async setIndex(...entries) { fs.writeFileSync(indexFile, JSON.stringify({ version: 1, skins: entries })); commit("index"); await forget(); },
    async unlist(id) { const idx = index(); idx.skins = idx.skins.filter((x) => x.id !== id); fs.writeFileSync(indexFile, JSON.stringify(idx)); commit(`unlist ${id}`); await forget(); },
    /** Catalogue injoignable (panne réseau). `wipe` : la dernière copie reçue est oubliée aussi. */
    async down({ wipe = false } = {}) {
      process.env.CURIOSA_SKINS_REPO = "file:///nonexistent/curiosa-skins";
      if (wipe) fs.rmSync(path.join(process.env.DATA_DIR, "cache", "skins-index.json"), { force: true });
      await forget();
    },
    async up() { process.env.CURIOSA_SKINS_REPO = repo.url; await forget(); },
    async clear() {
      fs.rmSync(path.join(repo.dir, "skins"), { recursive: true, force: true });
      fs.writeFileSync(indexFile, JSON.stringify({ version: 1, skins: [] }));
      commit("clear");
      for (const t of repo.g("tag", "-l").toString().split("\n").filter(Boolean)) repo.g("tag", "-d", t);
      await self.up();
    },
    close() { fs.rmSync(repo.dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
  process.env.CURIOSA_SKINS_REPO = repo.url;
  return self;
}
