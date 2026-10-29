// Lecture de /proc et arrêt propre du site — Node seul, aucune dépendance, aucune commande externe, aucun secret lu.
//
// Pourquoi ce fichier : un site peut tourner sous plusieurs processus (`npm exec next` → `sh -c next start` → `next-server` quand l'unité systemd
// utilise npx), et parfois sous DEUX gestionnaires à la fois (systemd ET pm2). Arrêter « un » processus ne libère pas le port : le site reste
// à moitié vivant ou est repris par l'autre gestionnaire. On regarde donc TOUS les processus du site, on les arrête, on vérifie que le port est
// libre, et si quelqu'un d'autre le tient on le DIT (sans jamais le tuer).
//
// Règle de sécurité : on n'envoie JAMAIS de signal à un processus dont le dossier courant n'est pas EXACTEMENT le dossier du site
// (chemins réels, comparaison d'égalité, jamais de préfixe : /var/www/a ≠ /var/www/a-autre). Deux sites sur une même machine ne se touchent pas.
//
// Tout ce qui lit le système passe par un objet `sys` injectable (voir systemProc) : les tests fournissent de fausses listes /proc.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (s) => String(s).split("/").pop();

// ── lecture de /proc ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Processus lisibles : { pid, ppid, cwd (chemin réel ou null), args, cgroup (texte ou null) }. Un processus illisible ou disparu est ignoré. */
export function readProcTable(procDir = "/proc") {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(procDir).filter((n) => /^\d+$/.test(n)); } catch { return out; }
  for (const name of names) {
    const dir = path.join(procDir, name);
    try {
      const stat = fs.readFileSync(path.join(dir, "stat"), "utf8");
      const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(after[1]);
      const state = after[0];
      let cwd = null;
      try { cwd = fs.realpathSync(path.join(dir, "cwd")); } catch { /* autre utilisateur ou processus disparu */ }
      let args = [];
      try { args = fs.readFileSync(path.join(dir, "cmdline"), "utf8").split("\0").filter(Boolean); } catch { /* idem */ }
      let cgroup = null;
      try { cgroup = fs.readFileSync(path.join(dir, "cgroup"), "utf8"); } catch { /* idem */ }
      out.push({ pid: Number(name), ppid: Number.isFinite(ppid) ? ppid : 0, state, cwd, args, cgroup });
    } catch { /* disparu entre-temps */ }
  }
  return out;
}

/** Ports en écoute (IPv4 + IPv6) : Map port → inodes des sockets. */
export function readListeningSockets(procDir = "/proc") {
  const map = new Map();
  for (const f of ["net/tcp", "net/tcp6"]) {
    let text = "";
    try { text = fs.readFileSync(path.join(procDir, f), "utf8"); } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length < 10 || c[3] !== "0A") continue; // 0A = LISTEN
      const port = parseInt(c[1].split(":")[1], 16);
      if (!Number.isFinite(port)) continue;
      map.set(port, [...(map.get(port) ?? []), c[9]]);
    }
  }
  return map;
}

/** Qui tient ce port ? { listening, pids } — `pids` ne contient que les processus dont on peut lire les descripteurs (les nôtres, ou tous en root). */
export function readPortHolders(port, procDir = "/proc") {
  const inodes = readListeningSockets(procDir).get(port);
  if (!inodes) return { listening: false, pids: [] };
  const wanted = new Set(inodes.map((i) => `socket:[${i}]`));
  const pids = [];
  let names = [];
  try { names = fs.readdirSync(procDir).filter((n) => /^\d+$/.test(n)); } catch { /* pas de /proc */ }
  for (const name of names) {
    try {
      for (const fd of fs.readdirSync(path.join(procDir, name, "fd"))) {
        try { if (wanted.has(fs.readlinkSync(path.join(procDir, name, "fd", fd)))) { pids.push(Number(name)); break; } } catch { /* descripteur fermé */ }
      }
    } catch { /* autre utilisateur */ }
  }
  return { listening: true, pids };
}

/** Ports sur lesquels un processus donné écoute (pour retrouver le port réel d'un serveur lancé avec `-p 3001`). */
export function listeningPortsOf(pid, procDir = "/proc") {
  const sockets = readListeningSockets(procDir);
  let inodes = new Set();
  try {
    for (const fd of fs.readdirSync(path.join(procDir, String(pid), "fd"))) {
      try { const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join(procDir, String(pid), "fd", fd))); if (m) inodes.add(m[1]); } catch { /* fermé */ }
    }
  } catch { return []; }
  return [...sockets].filter(([, list]) => list.some((i) => inodes.has(i))).map(([port]) => port).sort((a, b) => a - b);
}

/** L'accès au système réel. Les tests le remplacent. */
export function systemProc({ procDir = "/proc" } = {}) {
  return {
    procs: () => readProcTable(procDir),
    holders: (port) => readPortHolders(port, procDir),
    listeningPortsOf: (pid) => listeningPortsOf(pid, procDir),
    kill: (pid, signal) => process.kill(pid, signal),
    sleep: sleepMs,
    now: () => Date.now(),
    load: () => os.loadavg()[0] / Math.max(1, os.cpus().length),
  };
}

// ── port du site ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const portOf = (url) => { try { const u = new URL(url); return Number(u.port) || (u.protocol === "https:" ? 443 : 80); } catch { return null; } };

/**
 * Port du site, dans l'ordre : adresse de contrôle (CURIOSA_READY_URL), PORT, port sur lequel le serveur en cours écoute RÉELLEMENT
 * (`next start -p 3001` ne met rien dans l'environnement), enfin 3000. Jamais un 3000 supposé quand on peut savoir mieux.
 */
export function resolveSitePort({ env = process.env, sys = systemProc(), serverPid } = {}) {
  const fromUrl = env.CURIOSA_READY_URL ? portOf(env.CURIOSA_READY_URL) : null;
  if (fromUrl) return fromUrl;
  if (/^\d{1,5}$/.test(String(env.PORT ?? ""))) return Number(env.PORT);
  const live = serverPid ? sys.listeningPortsOf?.(serverPid) ?? [] : [];
  return live.length === 1 ? live[0] : 3000;
}

// ── reconnaître le site ─────────────────────────────────────────────────────────────────────────────────────────────────

const NOT_SERVER = new Set(["build", "lint", "telemetry", "info", "typegen"]);
const SHELLS = new Set(["sh", "bash", "dash", "ash", "zsh"]);
const NODE_PM = new Set(["npm", "npx", "pnpm", "yarn", "pnpx"]);

/** Cette ligne de commande est-elle celle d'un serveur Next (ou de l'un de ses enveloppes : npm, npx, sh -c) ? Jamais l'outil de mise à jour lui-même. */
export function isSiteCommand(args) {
  if (!Array.isArray(args) || args.length === 0) return false;
  const words = args.flatMap((a) => String(a).split(/\s+/)).filter(Boolean);
  if (words.some((w) => /(^|\/)update\.mjs$/.test(w))) return false;
  const i = words.findIndex((w) => base(w) === "next" || /^next-server/.test(base(w)));
  if (i >= 0) return !words.slice(i + 1).some((w) => NOT_SERVER.has(w));
  const a0 = base(args[0].split(/\s+/)[0]);
  const viaNode = a0 === "node" && /(npm|npx|pnpm|yarn)(-cli)?\.c?js$/.test(String(args[1] ?? ""));
  const launcher = NODE_PM.has(a0) || viaNode || SHELLS.has(a0);
  return launcher && words.includes("start") && !words.includes("build");
}

/** Une enveloppe (npm, npx, sh) plutôt que le serveur lui-même ? */
export const isWrapper = (args) => { const a0 = base(String(args?.[0] ?? "").split(/\s+/)[0]); return NODE_PM.has(a0) || SHELLS.has(a0) || (a0 === "node" && /(npm|npx)(-cli)?\.c?js$/.test(String(args?.[1] ?? ""))); };

/** Lancé par npm / npx / pnpm / yarn (trois processus au lieu d'un) ? */
export function isNpmWrapper(args) {
  const first = String(args?.[0] ?? "").split(/\s+/)[0];
  return NODE_PM.has(base(first)) || (base(first) === "node" && /(npm|npx|pnpm|yarn)(-cli)?\.c?js$/.test(String(args?.[1] ?? "")));
}

/** Ascendants d'un processus (lui exclu), du plus proche au plus lointain. */
function ancestorsOf(pid, byPid) {
  const out = []; const seen = new Set([pid]);
  for (let p = byPid.get(pid)?.ppid; p && !seen.has(p); p = byPid.get(p)?.ppid) { out.push(p); seen.add(p); }
  return out;
}

/**
 * TOUS les processus du site : ceux dont le dossier courant est exactement `appDir` et dont la ligne de commande est celle d'un serveur Next
 * ou de son enveloppe, plus leurs descendants qui ont ce même dossier. L'outil de mise à jour (`selfPid`) et ses descendants n'en font jamais partie.
 * Triés des feuilles vers la racine : les enfants d'abord.
 */
export function findSiteProcesses({ appDir, procs, selfPid = process.pid }) {
  const real = safeReal(appDir);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // Protégés : l'outil de mise à jour et ce qu'il lance lui-même (tar, prisma…). Ses ascendants, eux, NE le sont PAS : c'est le serveur
  // qui l'a lancé (CURIOSA_SERVER_PID), et c'est précisément lui qu'il faut arrêter ; l'outil est détaché, il lui survit.
  const protectedPids = new Set([selfPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) if (!protectedPids.has(p.pid) && protectedPids.has(p.ppid)) { protectedPids.add(p.pid); grew = true; }
  }
  const inSite = (p) => p.cwd !== null && p.cwd === real && !protectedPids.has(p.pid);
  const found = new Set(procs.filter((p) => inSite(p) && isSiteCommand(p.args)).map((p) => p.pid));
  for (let grew = true; grew;) { // descendants du site, au même dossier
    grew = false;
    for (const p of procs) if (!found.has(p.pid) && inSite(p) && found.has(p.ppid)) { found.add(p.pid); grew = true; }
  }
  const depth = (pid) => ancestorsOf(pid, byPid).filter((a) => found.has(a)).length;
  return procs.filter((p) => found.has(p.pid)).sort((a, b) => depth(b.pid) - depth(a.pid) || a.pid - b.pid);
}

function safeReal(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }

// ── gestionnaires (cgroup) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Unité systemd (ou scope) d'un texte /proc/<pid>/cgroup : « curiosa.service », « pm2-bob.service », « docker-ab12.scope » ; null si inconnu. */
export function cgroupUnit(text) {
  if (!text) return null;
  const paths = String(text).split("\n").map((l) => l.split(":").slice(2).join(":")).filter(Boolean);
  for (const p of paths) {
    const unit = p.split("/").filter(Boolean).reverse().find((s) => /\.(service|scope)$/.test(s));
    if (unit) return unit;
  }
  return null;
}

/** Même gestionnaire ? Deux cgroup illisibles ne prouvent rien : on ne conclut à une différence que sur deux valeurs connues et distinctes. */
const sameManager = (a, b) => !a || !b || a === b;
const normCgroup = (text) => (text ? String(text).split("\n").map((l) => l.split(":").slice(2).join(":")).filter(Boolean).sort().join("|") : null);

/** Le gestionnaire est-il pm2 ? (processus parent « PM2 v5 God Daemon », ou unité pm2-…) */
function managerKind(p, byPid) {
  const unit = cgroupUnit(p.cgroup);
  if (unit && /^pm2/i.test(unit)) return "pm2";
  for (const a of ancestorsOf(p.pid, byPid)) if (/pm2/i.test((byPid.get(a)?.args ?? []).join(" "))) return "pm2";
  return unit ? "systemd" : "other";
}

/** Ligne de commande pour un message : programme + arguments, valeurs `clé=valeur` masquées, bornée. */
export function describeCommand(args, max = 100) {
  const s = (args ?? []).join(" ").replace(/(--?[\w-]+=)\S+/g, "$1…").replace(/\b([A-Z][A-Z0-9_]{2,}=)\S+/g, "$1…").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Port annoncé par une ligne de commande (`-p 3001`, `--port=3001`, `-p3001`) ; null sinon. */
export function portFromArgs(args) {
  const words = (args ?? []).flatMap((a) => String(a).split(/\s+/));
  for (let i = 0; i < words.length; i++) {
    const m = /^(?:-p|--port)(?:=|(\d+))?(\d*)$/.exec(words[i]);
    if (!m) continue;
    const v = m[1] ?? m[2] ?? "";
    if (/^\d+$/.test(v)) return Number(v);
    if (/^\d+$/.test(words[i + 1] ?? "")) return Number(words[i + 1]);
  }
  return null;
}

// ── détection préventive (page « Mises à jour ») ───────────────────────────────────────────────────────────────────────

/**
 * Situations dangereuses, repérées AVANT d'installer. Lecture de /proc seulement. Un avertissement ne concerne que CE site :
 * un autre gestionnaire n'est signalé que s'il lance le même dossier OU le même port ; un pm2 ou un serveur de jeu sans rapport n'alarme jamais.
 *  - `second-manager` : processus du site (même dossier) ou serveur Next sur le même port, sous un autre cgroup que le serveur actuel ;
 *  - `npx` : le serveur actuel est lancé par `npm exec` / `npx` (trois processus au lieu d'un).
 * @returns {{code:"second-manager"|"npx", unit?:string|null, manager?:string, pid?:number, command?:string, port?:number}[]}
 */
export function detectHosting({ appDir, port, procs, selfPid = process.pid, serverPid = selfPid }) {
  const real = safeReal(appDir);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const server = byPid.get(serverPid) ?? byPid.get(selfPid);
  const ref = normCgroup(server?.cgroup);
  const tree = new Set([serverPid, selfPid, ...ancestorsOf(serverPid, byPid), ...ancestorsOf(selfPid, byPid)]);
  const out = [];
  // 1. enveloppe npx/npm dans la chaîne du serveur actuel
  const chain = [serverPid, ...ancestorsOf(serverPid, byPid)].map((p) => byPid.get(p)).filter(Boolean);
  const npx = chain.find((p) => isNpmWrapper(p.args));
  if (npx) out.push({ code: "npx", pid: npx.pid, command: describeCommand(npx.args) });
  // 2. autres gestionnaires du MÊME site
  const seen = new Set();
  for (const p of procs) {
    if (tree.has(p.pid) || !isSiteCommand(p.args)) continue;
    const sameDir = p.cwd === real;
    const samePort = !sameDir && portFromArgs(p.args) === port && /next/.test(p.args.join(" "));
    if (!sameDir && !samePort) continue;
    const kind = managerKind(p, byPid);
    const refKind = server ? managerKind(server, byPid) : "other";
    if (sameManager(normCgroup(p.cgroup), ref) && !(kind === "pm2" && refKind !== "pm2")) continue;
    const unit = cgroupUnit(p.cgroup);
    const key = `${kind}:${unit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: "second-manager", manager: kind, unit, pid: p.pid, command: describeCommand(p.args), port });
  }
  return out;
}

// ── délais ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const secs = (v, d) => (/^\d{1,5}$/.test(String(v ?? "")) && Number(v) > 0 ? Number(v) * 1000 : d);

/**
 * Délais d'attente, en millisecondes. Valeurs par défaut prudentes, multipliées (jusqu'à ×3) quand la machine est très chargée
 * (charge par cœur > 1) ; une variable d'environnement explicite est respectée telle quelle :
 *  - CURIOSA_STOP_SECONDS (30)  : attente de l'arrêt après SIGTERM, avant SIGKILL en dernier recours ;
 *  - CURIOSA_PORT_SECONDS (20)  : attente de la libération du port ;
 *  - CURIOSA_SITE_SECONDS (300) : attente du retour du site sur la nouvelle version.
 */
export function timeouts(env = process.env, load = 0) {
  const k = Math.min(3, Math.max(1, load));
  return {
    stopMs: secs(env.CURIOSA_STOP_SECONDS, Math.round(30_000 * k)),
    portMs: secs(env.CURIOSA_PORT_SECONDS, Math.round(20_000 * k)),
    siteMs: secs(env.CURIOSA_SITE_SECONDS, Math.round(300_000 * k)),
    killMs: 5_000,
    settleMs: 2_000, // le port est libre : combien de temps guetter un gestionnaire qui relance aussitôt (pm2 relance en quelques dizaines de ms)
  };
}

// ── arrêt complet ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Explique, qui tient le port ? `holders` = { listening, pids } ; renvoie null si rien d'anormal.
 * Codes : `other-manager` (processus du site, autre gestionnaire), `other-site` (autre dossier avec release.json : un autre site de la machine),
 * `other-program` (autre programme), `unknown-owner` (port tenu, propriétaire illisible), `stuck` (un de NOS processus refuse de partir).
 */
export function diagnosePort({ appDir, port, procs, holders, oldPids, referenceCgroup }) {
  if (!holders.listening) return null;
  const real = safeReal(appDir);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const ref = normCgroup(referenceCgroup);
  const readable = holders.pids.map((pid) => byPid.get(pid)).filter(Boolean);
  if (readable.length === 0) return { code: "unknown-owner", port };
  for (const p of readable) {
    if (oldPids.has(p.pid)) return { code: "stuck", port, pid: p.pid, command: describeCommand(p.args) };
  }
  // Nouveau processus du site sous NOTRE gestionnaire = c'est le superviseur qui a relancé le site : pas un blocage.
  const verdicts = readable.map((p) => {
    const sameDir = p.cwd === real;
    if (sameDir && sameManager(normCgroup(p.cgroup), ref)) return null;
    if (sameDir) return { code: "other-manager", port, pid: p.pid, unit: cgroupUnit(p.cgroup), manager: managerKind(p, byPid), command: describeCommand(p.args) };
    const isSite = !!p.cwd && fs.existsSync(path.join(p.cwd, "release.json"));
    return { code: isSite ? "other-site" : "other-program", port, pid: p.pid, cwd: p.cwd, unit: cgroupUnit(p.cgroup), command: describeCommand(p.args) };
  });
  return verdicts.find(Boolean) ?? null;
}

/** Phrase en français, mots simples, pour le journal et la page : ce qui bloque et que faire. */
export function explainBlocker(d, { serviceUnit = null } = {}) {
  const svc = serviceUnit ?? "curiosa.service";
  const where = d.pid ? ` (processus ${d.pid}${d.command ? ` : ${d.command}` : ""})` : "";
  switch (d.code) {
    case "other-manager": {
      const who = d.manager === "pm2" ? `pm2${d.unit ? ` (${d.unit})` : ""}` : d.unit ?? "un autre service";
      const stop = d.manager === "pm2" ? "arrêtez-le (`pm2 list` puis `pm2 stop <nom>`, et `pm2 delete <nom>` puis `pm2 save` pour qu'il ne revienne pas)" : `arrêtez-le (\`sudo systemctl stop ${d.unit ?? "<service>"}\` et \`sudo systemctl disable ${d.unit ?? "<service>"}\`)`;
      return `Le port ${d.port} est tenu par un autre gestionnaire : ${who}${where}. Il redémarre le site avant le nouveau : ${stop}, puis relancez le service (\`sudo systemctl restart ${svc.replace(/\.service$/, "")}\`). La nouvelle version est déjà installée.`;
    }
    case "other-site":
      return `Le port ${d.port} est tenu par un autre site de ce serveur : ${d.cwd}${where}. Deux sites ne peuvent pas partager un port : changez le port de l'un des deux (option -p de next start, ou PORT), puis relancez le service. La nouvelle version est déjà installée.`;
    case "other-program":
      return `Le port ${d.port} est tenu par un autre programme de ce serveur${d.cwd ? ` (dossier ${d.cwd})` : ""}${where}. Arrêtez-le ou changez le port du site, puis relancez le service. La nouvelle version est déjà installée.`;
    case "unknown-owner":
      return `Le port ${d.port} est tenu par un processus que cette mise à jour n'a pas le droit d'examiner (probablement un autre compte du serveur). Cherchez-le avec \`sudo ss -ltnp | grep :${d.port}\`, arrêtez-le, puis relancez le service. La nouvelle version est déjà installée.`;
    case "stuck":
      return `Le port ${d.port} est encore tenu par l'ancien serveur${where}, qui ne s'arrête pas. Redémarrez le service (\`sudo systemctl restart ${svc.replace(/\.service$/, "")}\`) ; s'il persiste, regardez \`sudo ss -ltnp | grep :${d.port}\`. La nouvelle version est déjà installée.`;
    default:
      return `Le port ${d.port} est occupé.`;
  }
}

/**
 * Arrête TOUT le site proprement, puis vérifie que le port est libre.
 *  1. SIGTERM à chaque processus du site, les enfants d'abord (un par un, pas de groupe de processus : un groupe peut contenir l'outil de
 *     mise à jour ou, sous pm2/Docker, des processus qui ne sont pas au site). Le superviseur (systemd KillMode=control-group, pm2, Docker)
 *     voit alors son processus principal se terminer normalement ;
 *  2. attente bornée (`stopMs`) de leur disparition ;
 *  3. SIGKILL SEULEMENT à ceux qui restent, après ce délai explicite, et seulement s'ils sont toujours dans le dossier du site ;
 *  4. attente bornée (`portMs`) de la libération du port. Un processus NOUVEAU du site sous le même gestionnaire (le superviseur a déjà relancé) est
 *     le résultat voulu ; tout autre détenteur est un blocage qu'on décrit, sans y toucher.
 * @returns {{ok:boolean, stopped:number[], killed:number[], oldPids:number[], diagnostic?:object}}
 */
export async function stopSite({ appDir, port, sys = systemProc(), log = () => {}, timeouts: tm = timeouts(process.env, 0), selfPid = process.pid, serverPid, hintPid }) {
  const t0 = sys.now();
  const procs0 = sys.procs();
  const mine = findSiteProcesses({ appDir, procs: procs0, selfPid });
  const byPid0 = new Map(procs0.map((p) => [p.pid, p]));
  const refProc = byPid0.get(serverPid ?? -1) ?? byPid0.get(selfPid);
  const referenceCgroup = refProc?.cgroup ?? null;
  const oldPids = new Set(mine.map((p) => p.pid));
  // Sans /proc lisible, repli : le serveur qui nous a lancés (son pid nous est donné par lui-même) — jamais autre chose.
  const fallback = mine.length === 0 && procs0.length === 0 && hintPid ? hintPid : null;
  if (mine.length === 0 && !fallback) log(`aucun processus du site trouvé dans ${appDir} : rien à arrêter`);
  else if (mine.length) log(`arrêt du site (port ${port}) : ${mine.length} processus — ${mine.map((p) => `${p.pid} ${describeCommand(p.args, 40)}`).join(" ; ")}`);
  const signal = (pid, sig) => { try { sys.kill(pid, sig); return true; } catch (e) { if (e?.code !== "ESRCH") log(`signal ${sig} vers ${pid} impossible : ${e?.message}`); return false; } };
  if (fallback) { log(`lecture des processus impossible : arrêt du seul serveur qui a lancé la mise à jour (${fallback})`); signal(fallback, "SIGTERM"); oldPids.add(fallback); }
  for (const p of mine) signal(p.pid, "SIGTERM");
  if (oldPids.size) log("SIGTERM envoyé ; attente de l'arrêt…");

  const stillAlive = () => {
    const now = new Map(sys.procs().map((p) => [p.pid, p]));
    // Même pid ET toujours dans le dossier du site (un pid réutilisé par un autre programme ne compte pas, et on n'y touche pas).
    return [...oldPids].map((pid) => now.get(pid)).filter((p) => p && (p.cwd === safeReal(appDir) || p.cwd === null) && !String(p.state ?? "").startsWith("Z"));
  };
  const waitUntil = async (pred, ms) => { const end = sys.now() + ms; while (sys.now() < end) { if (pred()) return true; await sys.sleep(150); } return pred(); };

  const gone = oldPids.size === 0 || (await waitUntil(() => stillAlive().length === 0, tm.stopMs));
  const killed = [];
  if (!gone) {
    const left = stillAlive();
    log(`${left.length} processus n'ont pas obéi en ${Math.round(tm.stopMs / 1000)} s : arrêt forcé (SIGKILL) — ${left.map((p) => p.pid).join(", ")}`);
    for (const p of left) if (p.cwd === safeReal(appDir) && signal(p.pid, "SIGKILL")) killed.push(p.pid);
    await waitUntil(() => stillAlive().length === 0, tm.killMs);
  } else if (oldPids.size) log(`ancien serveur arrêté en ${((sys.now() - t0) / 1000).toFixed(1)} s`);

  // Le port : libre, ou repris par le bon gestionnaire, ou tenu par quelqu'un d'autre.
  let verdict = null;
  const check = () => {
    const holders = sys.holders(port);
    if (!holders.listening) return "free";
    verdict = diagnosePort({ appDir, port, procs: sys.procs(), holders, oldPids, referenceCgroup });
    return verdict ? "blocked" : "relaunched";
  };
  let state = check();
  // Port libre : un second gestionnaire (pm2…) relance en quelques dizaines de millisecondes. On guette un instant, SANS retarder le site :
  // le superviseur normal (RestartSec=3) n'a de toute façon pas encore relancé, et ce guet se fait pendant son attente.
  if (state === "free" && tm.settleMs) await waitUntil(() => (state = check()) !== "free", tm.settleMs);
  if (state === "blocked") await waitUntil(() => (state = check()) !== "blocked", tm.portMs);
  if (state === "free") { log(`port ${port} libre`); return { ok: true, stopped: [...oldPids], killed, oldPids: [...oldPids], referenceCgroup }; }
  if (state === "relaunched") { log(`port ${port} déjà repris par le superviseur (nouveau processus)`); return { ok: true, stopped: [...oldPids], killed, oldPids: [...oldPids], referenceCgroup, relaunched: true }; }
  log(`✘ ${explainBlocker(verdict, { serviceUnit: cgroupUnit(referenceCgroup) })}`);
  return { ok: false, stopped: [...oldPids], killed, oldPids: [...oldPids], referenceCgroup, diagnostic: verdict };
}

// ── confirmation du nouveau serveur ──────────────────────────────────────────────────────────────────────────────────────

/** En-tête que la route /api/health renvoie : empreinte de la version, construite au démarrage du serveur (voir next.config.mjs). */
export const VERSION_HEADER = "x-curiosa-version";
export const healthUrl = (readyUrl) => { try { return new URL("/api/health", readyUrl).toString(); } catch { return null; } };

/**
 * Le site qui répond est-il le NOUVEAU ? Preuves, de la plus forte à la plus faible :
 *  - l'en-tête de version de /api/health égale la version attendue (un ancien serveur répond une autre version ; 500/404 ne comptent pas) ;
 *  - sinon (version installée trop ancienne pour avoir la route) : le port est tenu par un processus qui n'existait pas avant l'arrêt ;
 *  - sinon, si aucun des anciens processus ne subsiste et que le site répond : accepté, en le disant (« version non vérifiable »).
 * Ne ment jamais : tant qu'un ancien processus tient le port, ou que la version est différente, la réponse est « pas encore ».
 */
export async function confirmNewServer({ readyUrl, expectedVersion, port, oldPids = new Set(), sys = systemProc(), fetchImpl = fetch, timeoutMs, intervalMs = 1500, log = () => {} }) {
  const limit = sys.now() + timeoutMs;
  let last = { reason: "no-answer" };
  const probe = async () => {
    const out = { status: null, version: null, home: null };
    const h = healthUrl(readyUrl);
    try {
      const res = h ? await fetchImpl(h, { redirect: "manual", signal: AbortSignal.timeout(10_000) }) : null;
      if (res) { out.status = res.status; out.version = res.headers.get(VERSION_HEADER); }
    } catch { /* ne répond pas */ }
    if (out.status === null || (out.version === null)) {
      try { out.home = (await fetchImpl(readyUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) })).status; } catch { /* ne répond pas */ }
    }
    return out;
  };
  while (sys.now() < limit) {
    const holders = sys.holders(port);
    const alive = [...oldPids].filter((pid) => sys.procs().some((p) => p.pid === pid));
    const r = await probe();
    last = { ...r, holders, alive };
    if (alive.length === 0 && r.version !== null) {
      if (r.version === expectedVersion && r.status === 200) return { ok: true, how: "version" };
      last.reason = "wrong-version";
    } else if (alive.length === 0 && r.version === null && r.home !== null && r.home < 500) {
      const fresh = holders.pids.length > 0 && holders.pids.every((pid) => !oldPids.has(pid));
      if (fresh) return { ok: true, how: "process" };
      if (holders.pids.length === 0) { log("le site répond ; sa version n'est pas vérifiable (processus illisible, route de contrôle absente)"); return { ok: true, how: "unverified" }; }
      last.reason = "old-process";
    } else last.reason = alive.length ? "old-process" : r.home === null && r.status === null ? "no-answer" : "error-page";
    await sys.sleep(intervalMs);
  }
  return { ok: false, ...last };
}

/** Phrase du journal quand le nouveau serveur n'est pas revenu : qui écoute, quelle version répond, et ce que montre le service. */
export function explainNotBack({ port, last, appDir, procs, referenceCgroup, expectedVersion, serviceUnit }) {
  const parts = [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const holders = (last.holders?.pids ?? []).map((pid) => byPid.get(pid)).filter(Boolean);
  if (!last.holders?.listening) parts.push(`personne n'écoute sur le port ${port}`);
  else if (holders.length) parts.push(`sur le port ${port} écoute : ${holders.map((p) => `${p.pid} (${describeCommand(p.args, 50)}${p.cwd ? `, dossier ${p.cwd}` : ""})`).join(" ; ")}`);
  else parts.push(`le port ${port} est tenu par un processus illisible`);
  if (last.version) parts.push(`le site répond la version ${last.version === expectedVersion ? "attendue" : "d'une autre empreinte (ancienne version)"}`);
  else if ((last.status ?? last.home) != null) parts.push(`le site répond avec le code ${last.status ?? last.home}${last.reason === "old-process" ? " (ancien processus encore actif)" : ""}`);
  else parts.push("le site ne répond pas");
  const site = findSiteProcesses({ appDir, procs, selfPid: -1 });
  parts.push(site.length ? `${site.length} processus du site en cours (${[...new Set(site.map((p) => cgroupUnit(p.cgroup) ?? "gestionnaire inconnu"))].join(", ")})` : "aucun processus du site n'est en cours : le service est arrêté ou plante au démarrage");
  const unit = serviceUnit ?? cgroupUnit(referenceCgroup);
  return `${parts.join(" ; ")}. Pour voir pourquoi : \`sudo journalctl -u ${unit ? unit.replace(/\.service$/, "") : "curiosa"} -n 60 --no-pager\`.`;
}

/** Pid du serveur du site (le `next-server`, pas son enveloppe npm/sh) : celui qui tient le port s'il est connu, sinon le premier. undefined si aucun. */
export function findServerPid({ appDir, port, sys = systemProc(), selfPid = process.pid }) {
  const site = findSiteProcesses({ appDir, procs: sys.procs(), selfPid });
  const leaves = site.filter((p) => !isWrapper(p.args));
  const held = port ? sys.holders(port).pids : [];
  return (leaves.find((p) => held.includes(p.pid)) ?? leaves[0] ?? site[0])?.pid;
}

/** Avertissement préventif en français (journal de la mise à jour) ; la page de l'admin a ses propres textes traduits (clés `updates.hosting.*`). */
export function explainHosting(w) {
  if (w.code === "npx") return "Attention : le service lance le site par npm/npx (trois processus au lieu d'un). Cela fonctionne, mais l'arrêt est moins fiable : remplacez la ligne ExecStart par `/usr/bin/node node_modules/next/dist/bin/next start -p <port>` (voir deploy/curiosa.service).";
  const who = w.manager === "pm2" ? "pm2" : w.unit ?? "un autre service";
  return `Attention : un second gestionnaire lance aussi ce site (${who}${w.pid ? `, processus ${w.pid}` : ""}). Il peut relancer l'ancienne version ou prendre le port pendant la mise à jour : un seul gestionnaire par site (systemd OU pm2, pas les deux). Arrêtez l'autre (\`pm2 stop <nom>\` ou \`sudo systemctl disable --now ${w.unit ?? "<service>"}\`).`;
}
