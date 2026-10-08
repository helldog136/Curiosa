// Récupère les modules livrés avec cette version : un instantané du dépôt de modules (`curiosa-extras`), posé dans `extras/`.
// Le cœur ne contient aucun module ; l'archive de release embarque cet instantané pour que l'assistant de première installation
// (et le Catalogue hors ligne) fonctionnent sans réseau. `extras/` n'est jamais versionné ici.
//
//   node scripts/fetch-extras.mjs                     dépôt voisin (même propriétaire), branche master (dev sur dev)
//   EXTRAS_REPO=propriétaire/nom ou une adresse git   autre dépôt de modules
//   EXTRAS_REF=dev                                    autre branche, étiquette ou commit
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAME = "curiosa-extras";
const current = process.env.GITHUB_REPOSITORY ?? process.env.CURIOSA_RELEASE_REPO ?? "";
const spec = process.env.EXTRAS_REPO ?? (current.includes("/") ? `${current.split("/")[0]}/${NAME}` : "");
if (!spec) { console.error("Dépôt de modules inconnu : indiquez EXTRAS_REPO (« propriétaire/nom » ou une adresse git)."); process.exit(1); }
const url = /^[\w.-]+\/[\w.-]+$/.test(spec) ? `https://github.com/${spec}` : spec;
const branch = process.env.GITHUB_REF_NAME ?? "";
const ref = process.env.EXTRAS_REF ?? (/^(master|main|v\d+\.\d+\.\d+)$/.test(branch) ? "master" : "dev");
if (!/^[\w./-]{1,100}$/.test(ref)) { console.error(`Référence invalide : ${ref}`); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-extras-"));
try {
  execFileSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, "--", url, tmp], { stdio: "inherit" });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp, encoding: "utf8" }).trim();
  fs.rmSync("extras", { recursive: true, force: true });
  fs.mkdirSync("extras", { recursive: true });
  for (const dir of ["modules", "examples", "catalogue"]) if (fs.existsSync(path.join(tmp, dir))) fs.cpSync(path.join(tmp, dir), path.join("extras", dir), { recursive: true });
  fs.writeFileSync("extras/SOURCE.json", JSON.stringify({ repo: url, ref, commit }, null, 2) + "\n");
  const count = fs.readdirSync("extras/modules").length + (fs.existsSync("extras/examples") ? fs.readdirSync("extras/examples").length : 0);
  console.log(`extras/ ← ${url} @ ${ref} (${commit.slice(0, 7)}) : ${count} modules`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
