import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Crée un vrai dépôt git local à partir de fichiers { nom: texte | objet JSON }. */
export function makeRepo(files, { branch = "main" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-repo-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  // Dépôt jetable : modèle vide, pas de fsync, pas de signature — cinq fois plus rapide, sans rien changer au dépôt obtenu.
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.fsync=none", "-c", "gc.auto=0", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q", "--template=", "-b", branch); g("add", "-A"); g("commit", "-q", "--no-verify", "-m", "init");
  return { dir, url: "file://" + dir, commit: fs.readFileSync(path.join(dir, ".git/refs/heads", branch), "utf8").trim(), g };
}
