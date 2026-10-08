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
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", branch); g("add", "-A"); g("commit", "-q", "-m", "init");
  return { dir, url: "file://" + dir, commit: String(g("rev-parse", "HEAD")).trim(), g };
}
