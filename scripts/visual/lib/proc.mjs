// Petits utilitaires de processus : lancement détaché, arrêt PAR PID (jamais par nom), attente d'un port.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";

export function sh(cmd, args, opts = {}) { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }); }

export function pidTree(pid) {
  const out = [pid];
  try { for (const c of sh("pgrep", ["-P", String(pid)]).split("\n").filter(Boolean)) out.push(...pidTree(Number(c))); } catch {}
  return out;
}

export function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

export async function stopPid(pid, waitMs = 15000) {
  const tree = pidTree(pid);
  for (const p of tree.reverse()) { try { process.kill(p, "SIGTERM"); } catch {} }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs && tree.some(alive)) await new Promise((r) => setTimeout(r, 200));
  for (const p of tree) if (alive(p)) { try { process.kill(p, "SIGKILL"); } catch {} }
  await new Promise((r) => setTimeout(r, 300));
  return !tree.some(alive);
}

export function start(cmd, args, { cwd, env, logFile }) {
  const out = fs.openSync(logFile, "a");
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  return child.pid;
}

export async function waitHttp(url, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
