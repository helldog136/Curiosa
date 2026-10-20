// Redémarrage sûr d'une mise à jour supervisée (0.1.28) : arrêt de TOUT le site, port libre vérifié, diagnostic clair, version confirmée.
// Né d'un incident réel : unité `npx next start` (3 processus) + pm2 sur le même port → boucle EADDRINUSE et « Internal Server Error ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  cgroupUnit, confirmNewServer, describeCommand, detectHosting, diagnosePort, explainBlocker, explainHosting, findServerPid, findSiteProcesses,
  isSiteCommand, listeningPortsOf, portFromArgs, readPortHolders, readProcTable, resolveSitePort, stopSite, systemProc, timeouts,
} from "../../scripts/update-proc.mjs";
import { hashVersion, makeSiteWaiter, readState, runUpdate, runUpdateChain } from "../../scripts/update-lib.mjs";
import { opts, setup } from "../helpers/update-harness.mjs";
import { freePort, health, installFakeSite, killAllUnder, startSupervised, until } from "../helpers/fake-site.mjs";

/* ───────────── /proc simulé ───────────── */

const SYSTEMD = (unit) => `0::/system.slice/${unit}\n`;
const P = (pid, ppid, cwd, args, cgroup = SYSTEMD("curiosa.service")) => ({ pid, ppid, state: "S", cwd, args, cgroup });
const SITE = "/var/www/monsite";
/** L'incident : unité npx (3 processus) + pm2 (npm start → sh → next-server) sur le même dossier, plus des voisins qui n'ont rien à voir. */
const incident = () => [
  P(1, 0, "/", ["/sbin/init"], "0::/init.scope\n"),
  P(100, 1, SITE, ["npm exec next start -p 3000"]),
  P(101, 100, SITE, ["sh", "-c", "next start -p 3000"]),
  P(102, 101, SITE, ["next-server (v16.3.8)"]),
  P(200, 1, "/root/.pm2", ["PM2 v5.4.2: God Daemon (/root/.pm2)"], SYSTEMD("pm2-monsite.service")),
  P(201, 200, SITE, ["npm", "start"], SYSTEMD("pm2-monsite.service")),
  P(202, 201, SITE, ["sh", "-c", "next start"], SYSTEMD("pm2-monsite.service")),
  P(300, 1, "/var/www/autresite", ["next-server (v16.3.8)"], SYSTEMD("autresite.service")),
  P(301, 1, "/var/www/monsite-autre", ["next-server (v16.3.8)"], SYSTEMD("autre.service")),
  P(400, 1, "/opt/jeu", ["/opt/jeu/serveur-de-jeu", "+exec", "server.cfg"], SYSTEMD("jeu.service")),
  P(500, 1, SITE, ["node", "scripts/update.mjs", "v0.1.27"]),
  P(600, 1, null, ["next-server (v16.3.8)"], null),
];

test("reconnaître le site : next, next-server, npm exec next, npm start, sh -c next — jamais l'outil de mise à mise à jour ni un build", () => {
  for (const ok of [["next-server (v16.3.8)"], ["npm exec next start -p 3000"], ["sh", "-c", "next start -p 3000"], ["node", "node_modules/next/dist/bin/next", "start"], ["/usr/bin/npx", "next", "start"], ["npm", "start"], ["npm", "run", "start"], ["node", "/usr/lib/node_modules/npm/bin/npm-cli.js", "start"]]) assert.equal(isSiteCommand(ok), true, ok.join(" "));
  for (const no of [[], ["node", "scripts/update.mjs", "v1.2.3"], ["npm", "run", "build"], ["node", "node_modules/next/dist/bin/next", "build"], ["bash"], ["/opt/jeu/serveur-de-jeu"], ["sh", "-c", "tar -xzf x.tgz"], ["vim", "notes.txt"]]) assert.equal(isSiteCommand(no), false, no.join(" "));
});

test("arrêt : TOUS les processus du site (wrapper, shell, serveur, ET le second gestionnaire), enfants d'abord ; aucun processus étranger", () => {
  const found = findSiteProcesses({ appDir: SITE, procs: incident(), selfPid: 500 });
  assert.deepEqual(found.map((p) => p.pid), [102, 101, 202, 100, 201], "feuilles d'abord (102 avant 101 avant 100), même dossier seulement");
  const ids = new Set(found.map((p) => p.pid));
  for (const foreign of [1, 200, 300, 301, 400, 500, 600]) assert.ok(!ids.has(foreign), `${foreign} n'est pas au site`);
});

test("arrêt : comparaison de dossiers EXACTE — /var/www/a ne touche pas /var/www/a-autre, ni un sous-dossier, ni un lien qui y mène par erreur", () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-cwd-"));
  try {
    const dirA = path.join(a, "site"), dirB = path.join(a, "site-autre"), sub = path.join(dirA, "sub");
    for (const d of [dirA, dirB, sub]) fs.mkdirSync(d, { recursive: true });
    const procs = [P(10, 1, fs.realpathSync(dirA), ["next-server (v1)"]), P(11, 1, fs.realpathSync(dirB), ["next-server (v1)"]), P(12, 1, fs.realpathSync(sub), ["next-server (v1)"])];
    assert.deepEqual(findSiteProcesses({ appDir: dirA, procs, selfPid: 99999 }).map((p) => p.pid), [10]);
    assert.deepEqual(findSiteProcesses({ appDir: dirB, procs, selfPid: 99999 }).map((p) => p.pid), [11]);
    const link = path.join(a, "lien"); fs.symlinkSync(dirA, link);
    assert.deepEqual(findSiteProcesses({ appDir: link, procs, selfPid: 99999 }).map((p) => p.pid), [10], "un lien symbolique est résolu en chemin réel");
  } finally { fs.rmSync(a, { recursive: true, force: true }); }
});

test("l'outil de mise à jour et ce qu'il lance ne sont jamais arrêtés, même s'ils ressemblent au site ; le serveur qui l'a lancé, si", () => {
  const procs = [P(1, 0, "/", ["init"]), P(50, 1, SITE, ["sh", "-c", "next start"]), P(51, 50, SITE, ["node", "x.js"]), P(52, 51, SITE, ["npm", "start"])];
  assert.deepEqual(findSiteProcesses({ appDir: SITE, procs, selfPid: 51 }).map((p) => p.pid), [50], "51 est l'outil, 52 est ce qu'il a lancé : intacts ; 50 (le serveur parent) est arrêté");
});

test("findServerPid : le serveur (pas son enveloppe), de préférence celui qui tient le port", () => {
  const sys = { procs: incident, holders: (port) => ({ listening: true, pids: port === 3000 ? [102] : [] }) };
  assert.equal(findServerPid({ appDir: SITE, port: 3000, sys, selfPid: 500 }), 102);
  assert.equal(findServerPid({ appDir: "/nulle/part", port: 3000, sys, selfPid: 500 }), undefined);
});

test("cgroup : l'unité systemd est lue en cgroup v2 comme v1 ; illisible → null", () => {
  assert.equal(cgroupUnit("0::/system.slice/curiosa.service\n"), "curiosa.service");
  assert.equal(cgroupUnit("12:pids:/system.slice/pm2-monsite.service\n1:name=systemd:/system.slice/pm2-monsite.service\n0::/system.slice/pm2-monsite.service/sub"), "pm2-monsite.service");
  assert.equal(cgroupUnit("0::/user.slice/user-1000.slice/session-3.scope\n"), "session-3.scope");
  assert.equal(cgroupUnit("0::/\n"), null);
  assert.equal(cgroupUnit(null), null);
  assert.equal(describeCommand(["node", "x", "--token=SECRET123", "API_KEY=abc"]), "node x --token=… API_KEY=…", "aucun secret dans un message");
  assert.equal(portFromArgs(["next", "start", "-p", "3001"]), 3001);
  assert.equal(portFromArgs(["sh", "-c", "next start --port=3002"]), 3002);
  assert.equal(portFromArgs(["next", "start"]), null);
});

test("lecture réelle de /proc (faux /proc sur disque) : processus, dossier courant, ports en écoute et leur propriétaire", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-proc-"));
  try {
    const site = path.join(root, "site"); fs.mkdirSync(site);
    const proc = path.join(root, "proc");
    const mk = (pid, ppid, cwd, cmd, extra = {}) => {
      const d = path.join(proc, String(pid)); fs.mkdirSync(path.join(d, "fd"), { recursive: true });
      fs.writeFileSync(path.join(d, "stat"), `${pid} (next-server (v1)) S ${ppid} 0 0 0`);
      fs.writeFileSync(path.join(d, "cmdline"), cmd.join("\0") + "\0");
      fs.writeFileSync(path.join(d, "cgroup"), extra.cgroup ?? "0::/system.slice/curiosa.service\n");
      if (cwd) fs.symlinkSync(cwd, path.join(d, "cwd"));
      for (const [fd, target] of Object.entries(extra.fds ?? {})) fs.symlinkSync(target, path.join(d, "fd", fd));
    };
    mk(42, 1, site, ["next-server (v1)"], { fds: { 3: "socket:[777]" } });
    mk(43, 42, null, ["autre"]);
    fs.mkdirSync(path.join(proc, "net"));
    fs.writeFileSync(path.join(proc, "net", "tcp"), "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 777 1 0\n   1: 0100007F:0BB9 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 888 1 0\n");
    fs.writeFileSync(path.join(proc, "net", "tcp6"), "  sl  local_address\n   0: 00000000000000000000000000000000:0BBA 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 999 1 0\n");
    const table = readProcTable(proc);
    assert.deepEqual(table.map((p) => [p.pid, p.ppid, p.cwd === null ? null : path.basename(p.cwd), p.args[0]]), [[42, 1, "site", "next-server (v1)"], [43, 42, null, "autre"]]);
    assert.deepEqual(readPortHolders(3000, proc), { listening: true, pids: [42] }, "0x0BB8 = 3000, en écoute, tenu par 42");
    assert.deepEqual(readPortHolders(3001, proc), { listening: false, pids: [] }, "3001 est seulement connecté (état 01), pas en écoute");
    assert.deepEqual(readPortHolders(3002, proc), { listening: true, pids: [] }, "IPv6 : port tenu, propriétaire illisible (autre utilisateur)");
    assert.deepEqual(listeningPortsOf(42, proc), [3000]);
    assert.equal(resolveSitePort({ env: {}, sys: systemProc({ procDir: proc }), serverPid: 42 }), 3000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("port du site : adresse de contrôle, puis PORT, puis le port réel du serveur (-p 3001), jamais un 3000 supposé quand on sait mieux", () => {
  const sys = { listeningPortsOf: (pid) => (pid === 7 ? [3001] : []) };
  assert.equal(resolveSitePort({ env: { CURIOSA_READY_URL: "http://127.0.0.1:3005/" }, sys, serverPid: 7 }), 3005);
  assert.equal(resolveSitePort({ env: { CURIOSA_READY_URL: "https://exemple.org/" }, sys }), 443);
  assert.equal(resolveSitePort({ env: { PORT: "3002" }, sys, serverPid: 7 }), 3002);
  assert.equal(resolveSitePort({ env: {}, sys, serverPid: 7 }), 3001, "unité avec `-p 3001` : aucune variable, mais le serveur écoute sur 3001");
  assert.equal(resolveSitePort({ env: {}, sys, serverPid: 8 }), 3000);
  assert.equal(resolveSitePort({ env: { PORT: "abc" }, sys }), 3000);
});

test("détection préventive : second gestionnaire du MÊME site (dossier ou port) et unité npx ; jamais d'alarme pour un voisin sans rapport", () => {
  const warn = (procs, over = {}) => detectHosting({ appDir: SITE, port: 3000, procs, selfPid: 500, serverPid: 102, ...over });
  const w = warn(incident());
  assert.deepEqual(w.map((x) => [x.code, x.manager ?? null, x.unit ?? null]), [["npx", null, null], ["second-manager", "pm2", "pm2-monsite.service"]]);
  // L'unité est propre (direct, sans npx) et seule : rien à dire — malgré un autre site, un pm2 sans rapport et un serveur de jeu.
  const clean = [
    P(1, 0, "/", ["init"], "0::/init.scope\n"), P(102, 1, SITE, ["next-server (v16.3.8)"]),
    P(200, 1, "/root/.pm2", ["PM2 v5 God Daemon"], SYSTEMD("pm2-bob.service")), P(201, 200, "/home/bob/app", ["npm", "start"], SYSTEMD("pm2-bob.service")), P(202, 201, "/home/bob/app", ["next-server (v16.3.8)"], SYSTEMD("pm2-bob.service")),
    P(300, 1, "/var/www/autresite", ["next", "start", "-p", "3001"], SYSTEMD("autresite.service")), P(400, 1, "/opt/jeu", ["FXServer"], SYSTEMD("jeu.service")),
  ];
  assert.deepEqual(warn(clean), []);
  // Même port, autre dossier, autre gestionnaire (une application pm2 configurée sur ce port) : signalé.
  const samePort = [...clean, P(210, 200, "/home/bob/autre", ["sh", "-c", "next start -p 3000"], SYSTEMD("pm2-bob.service"))];
  assert.deepEqual(warn(samePort).map((x) => [x.code, x.manager]), [["second-manager", "pm2"]]);
  // Le second site (autresite) sur SON port : jamais signalé quand c'est lui qu'on met à jour non plus.
  assert.deepEqual(warn(clean, { appDir: "/var/www/autresite", port: 3001, serverPid: 300 }), []);
  // Cgroups illisibles (autre utilisateur) : aucune conclusion hâtive.
  assert.deepEqual(warn([P(102, 1, SITE, ["next-server"], null), P(150, 1, SITE, ["npm", "start"], null)]).filter((x) => x.code === "second-manager"), []);
  assert.match(explainHosting(w[1]), /un seul gestionnaire par site/i);
  assert.match(explainHosting(w[0]), /npx/);
});

test("délais : par défaut raisonnables, ×1 à ×3 sur une machine très chargée, réglables par variable d'environnement (secondes)", () => {
  assert.deepEqual(timeouts({}, 0), { stopMs: 30_000, portMs: 20_000, siteMs: 300_000, killMs: 5_000, settleMs: 2_000 });
  assert.equal(timeouts({}, 2).stopMs, 60_000, "charge 2 par cœur : deux fois plus patient");
  assert.equal(timeouts({}, 50).siteMs, 900_000, "plafonné à ×3");
  assert.equal(timeouts({}, 0.1).stopMs, 30_000, "jamais moins que la valeur de base");
  const env = { CURIOSA_STOP_SECONDS: "90", CURIOSA_PORT_SECONDS: "45", CURIOSA_SITE_SECONDS: "600" };
  assert.deepEqual(timeouts(env, 3), { stopMs: 90_000, portMs: 45_000, siteMs: 600_000, killMs: 5_000, settleMs: 2_000 }, "une valeur explicite est respectée telle quelle");
  assert.equal(timeouts({ CURIOSA_STOP_SECONDS: "abc" }, 0).stopMs, 30_000, "valeur invalide : défaut");
  assert.equal(timeouts({ CURIOSA_STOP_SECONDS: "0" }, 0).stopMs, 30_000);
});

/* ───────────── messages ───────────── */

test("diagnostic du port : qui tient le port, en mots simples et en français, avec quoi faire — et sans rien tuer", () => {
  const procs = incident();
  const diag = (holderPids, over = {}) => diagnosePort({ appDir: SITE, port: 3000, procs, holders: { listening: true, pids: holderPids }, oldPids: new Set([100, 101, 102]), referenceCgroup: SYSTEMD("curiosa.service"), ...over });
  const pm2 = diag([202]);
  assert.deepEqual([pm2.code, pm2.manager, pm2.unit, pm2.pid], ["other-manager", "pm2", "pm2-monsite.service", 202]);
  assert.equal(explainBlocker(pm2, { serviceUnit: "curiosa.service" }),
    "Le port 3000 est tenu par un autre gestionnaire : pm2 (pm2-monsite.service) (processus 202 : sh -c next start). Il redémarre le site avant le nouveau : arrêtez-le (`pm2 list` puis `pm2 stop <nom>`, et `pm2 delete <nom>` puis `pm2 save` pour qu'il ne revienne pas), puis relancez le service (`sudo systemctl restart curiosa`). La nouvelle version est déjà installée.");
  assert.equal(diag([102]).code, "stuck", "l'ancien serveur qui ne part pas");
  assert.equal(diag([]).code, "unknown-owner");
  assert.equal(diag([], { holders: { listening: false, pids: [] } }), null, "port libre : rien à dire");
  // Un NOUVEAU processus du site sous le même gestionnaire = le superviseur a relancé : pas un blocage.
  const relaunched = [...procs, P(900, 100, SITE, ["next-server (v16.3.8)"])];
  assert.equal(diagnosePort({ appDir: SITE, port: 3000, procs: relaunched, holders: { listening: true, pids: [900] }, oldPids: new Set([102]), referenceCgroup: SYSTEMD("curiosa.service") }), null);
  // Un autre site de la machine, ou le serveur de jeu : nommés, jamais tués.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-other-"));
  try {
    fs.writeFileSync(path.join(dir, "release.json"), "{}");
    const other = diagnosePort({ appDir: SITE, port: 3001, procs: [P(300, 1, dir, ["next-server (v16.3.8)"], SYSTEMD("autresite.service"))], holders: { listening: true, pids: [300] }, oldPids: new Set(), referenceCgroup: SYSTEMD("curiosa.service") });
    assert.equal(other.code, "other-site");
    assert.match(explainBlocker(other), new RegExp(`^Le port 3001 est tenu par un autre site de ce serveur : ${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(processus 300`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const game = diag([400]);
  assert.equal(game.code, "other-program");
  assert.match(explainBlocker(game), /autre programme de ce serveur \(dossier \/opt\/jeu\)/);
  assert.match(explainBlocker({ code: "unknown-owner", port: 3000 }), /ss -ltnp \| grep :3000/);
});

test("textes de la page : chaque diagnostic et chaque avertissement existe en français ET en anglais, avec les mêmes variables", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const keys = ["other-manager", "other-site", "other-program", "unknown-owner", "stuck"].map((c) => `updates.diag.${c}`).concat(["updates.diag.help", "updates.diagnostic.title", "updates.hosting.title", "updates.hosting.second-manager", "updates.hosting.npx", "updates.failure.port-busy", "updates.failure.site-not-back", "updates.failure.wrong-version", "updates.step.restarting", "updates.step.waiting"]);
  const vars = (t) => [...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) { assert.ok(fr[k] && en[k], `${k} manque`); assert.equal(vars(fr[k]), vars(en[k]), `${k} : variables différentes`); }
});

/* ───────────── arrêt avec de vrais processus ───────────── */

/** Un site jetable : dossier racine, site (release 1.0.0 du banc d'essai), faux Next installé, ports libres. Nettoyage garanti. */
function world() {
  const s = setup();
  installFakeSite(s.app);
  const sys0 = systemProc();
  const w = {
    s, sys: sys0, root: s.root,
    cleanup() { killAllUnder(s.root, sys0.procs()); s.cleanup(); },
  };
  return w;
}
/** Donne un nom d'unité systemd (cgroup) à tout ce qui descend d'un superviseur du test. */
function withCgroups(sys) {
  // Le gestionnaire d'un processus se lit sur sa ligne de commande (`--unit=…`, posée par startSupervised), PAS sur sa filiation : un processus
  // dont le shell parent vient d'être arrêté est « adopté » par init, et sa filiation ne dit plus rien. Aucune dépendance à l'ordre des événements.
  return { ...sys, procs: () => sys.procs().map((p) => { const m = p.args.join(" ").match(/--unit=(\S+?)(?:;|\s|$)/); return m ? { ...p, cgroup: SYSTEMD(m[1]) } : p; }) };
}
const fast = { stopMs: 10_000, portMs: 2500, siteMs: 60_000, killMs: 5000, settleMs: 1500 };
/** Un faux pm2 relance en quelques dizaines de ms… plus le démarrage de node : sous charge, bien plus. On guette donc longtemps ; la boucle s'arrête dès qu'un détenteur apparaît. */
const patient = { ...fast, settleMs: 30_000, portMs: 1500 };
const logTo = (lines) => (l) => lines.push(l);

test("arbre « npm exec + sh + serveur » sous un superviseur : TOUT s'arrête, le port est libre, le superviseur relance, aucun processus étranger touché", async () => {
  const w = world(); try {
    const port = await freePort(), otherPort = await freePort();
    const other = `${w.s.app}-autre`; fs.mkdirSync(other); installFakeSite(other); fs.writeFileSync(path.join(other, "package.json"), '{"version":"9.9.9"}');
    const mine = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 1000, tree: "npx" });
    const theirs = startSupervised({ unit: "autresite.service", rootDir: w.root, appDir: other, port: otherPort, delay: 200, tree: "npx" });
    assert.ok(await until(() => health(port)), "le site démarre");
    assert.ok(await until(() => health(otherPort)), "le voisin démarre");
    const sys = withCgroups(w.sys);
    const before = findSiteProcesses({ appDir: w.s.app, procs: sys.procs() });
    assert.equal(before.length, 3, "wrapper + shell + serveur");
    const neighbours = findSiteProcesses({ appDir: other, procs: sys.procs() }).map((p) => p.pid);
    assert.equal(neighbours.length, 3);
    const lines = [];
    const r = await stopSite({ appDir: w.s.app, port, sys, log: logTo(lines), timeouts: fast, serverPid: findServerPid({ appDir: w.s.app, port, sys }) });
    assert.equal(r.ok, true, lines.join("\n"));
    assert.deepEqual(r.killed, [], "SIGTERM a suffi : aucun SIGKILL");
    assert.ok(before.every((p) => !sys.procs().some((q) => q.pid === p.pid && q.state !== "Z")), "les trois processus ont disparu");
    for (const pid of neighbours) assert.ok(sys.procs().some((p) => p.pid === pid), `le voisin ${pid} est intact`);
    assert.ok(await health(otherPort), "le site voisin répond toujours");
    assert.match(lines.join("\n"), /arrêt du site \(port \d+\) : 3 processus/);
    assert.match(lines.join("\n"), /ancien serveur arrêté en/);
    assert.match(lines.join("\n"), /port \d+ libre|déjà repris par le superviseur/);
    // Le superviseur relance (3 s dans la vraie vie, 1 s ici).
    assert.ok(await until(() => health(port), 40_000), "le superviseur a relancé le site");
    for (const x of [mine, theirs]) x.stop();
  } finally { w.cleanup(); }
});

test("deux gestionnaires (systemd + pm2) sur le même dossier et le même port : l'ancienne boucle EADDRINUSE devient un échec expliqué, jamais un faux succès", async () => {
  const w = world(); try {
    const port = await freePort();
    const systemd = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 60_000, // jamais autorisé à relancer pendant ce test : seul le faux pm2 peut reprendre le port
       tree: "npx" });
    assert.ok(await until(() => health(port)));
    const pm2 = startSupervised({ unit: "pm2-monsite.service", rootDir: w.root, appDir: w.s.app, port, delay: 50, tree: "sh" }); // plante en boucle : le port est pris
    assert.ok(await until(() => findSiteProcesses({ appDir: w.s.app, procs: withCgroups(w.sys).procs() }).some((p) => /pm2/.test(cgroupUnit(p.cgroup) ?? "")), 40_000), "le faux pm2 a lancé sa première tentative");
    const sys = withCgroups(w.sys);
    w.s.build("1.0.1");
    const serverPid = findServerPid({ appDir: w.s.app, port, sys });
    // Le pm2 prend le port dès que l'ancien serveur tombe (il relance sans délai) : le nouveau ne pourra jamais démarrer.
    const r = await runUpdate({ ...opts(w.s), tag: "v1.0.1", exec: w.s.make(), supervised: true, serverPid, port, sys, timeouts: patient,
      confirmServer: async () => { throw new Error("ne doit pas attendre un site qui ne peut pas démarrer"); } });
    const st = readState(w.s.dataDir);
    assert.deepEqual([r.ok, r.error], [false, "port-busy"]);
    assert.deepEqual([st.status, st.error, st.restart], ["failed", "port-busy", "blocked"]);
    assert.deepEqual([st.diagnostic.code, st.diagnostic.manager, st.diagnostic.unit, st.diagnostic.port], ["other-manager", "pm2", "pm2-monsite.service", port]);
    assert.match(st.diagnostic.message, new RegExp(`^Le port ${port} est tenu par un autre gestionnaire : pm2 \\(pm2-monsite\\.service\\)`));
    const log = fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8");
    assert.match(log, /✘ Le port \d+ est tenu par un autre gestionnaire/);
    assert.match(log, /arrêtez-le \(`pm2 list`/);
    assert.match(log, /La nouvelle version est déjà installée/);
    assert.equal(w.s.buildId(), "build-1.0.1", "la nouvelle version est bien installée (rien n'est annulé à tort)");
    for (const x of [systemd, pm2]) x.stop();
  } finally { w.cleanup(); }
});

test("un seul gestionnaire : la mise à jour supervisée réussit et ne l'annonce QUE quand le nouveau serveur répond sa version", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 1000, tree: "npx" });
    const first = await until(() => health(port));
    assert.equal(first.version, hashVersion("1.0.0"));
    const sys = withCgroups(w.sys);
    w.s.build("1.1.0");
    const waiter = makeSiteWaiter({ appDir: w.s.app, dataDir: w.s.dataDir, readyUrl: `http://127.0.0.1:${port}/`, port, sys, timeouts: fast, intervalMs: 200 });
    const r = await runUpdate({ ...opts(w.s), tag: "v1.1.0", exec: w.s.make(), supervised: true, serverPid: findServerPid({ appDir: w.s.app, port, sys }), port, sys, timeouts: fast, confirmServer: waiter });
    assert.equal(r.ok, true, fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8"));
    assert.equal((await health(port)).version, hashVersion("1.1.0"), "c'est bien le nouveau serveur qui répond");
    const st = readState(w.s.dataDir);
    assert.deepEqual([st.status, st.step, st.restart], ["success", "done", "signal"]);
    const log = fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8");
    assert.match(log, /✔ le nouveau site répond \(version confirmée par le site\)/);
    sup.stop();
  } finally { w.cleanup(); }
});

test("le site de la machine voisine n'est jamais touché : deux installations côte à côte (ports, dossiers et superviseurs différents)", async () => {
  const w = world(); try {
    const portA = await freePort(), portB = await freePort();
    const dirB = path.join(w.root, "site-b"); fs.mkdirSync(dirB); installFakeSite(dirB); fs.writeFileSync(path.join(dirB, "package.json"), '{"version":"2.0.0"}');
    const a = startSupervised({ unit: "monsite.service", rootDir: w.root, appDir: w.s.app, port: portA, delay: 600, tree: "npx" });
    const b = startSupervised({ unit: "autresite.service", rootDir: w.root, appDir: dirB, port: portB, delay: 600, tree: "npx" });
    assert.ok(await until(() => health(portA)) && await until(() => health(portB)));
    const sys = withCgroups(w.sys);
    const pidsB = findSiteProcesses({ appDir: dirB, procs: sys.procs() }).map((p) => p.pid);
    assert.equal(pidsB.length, 3);
    const killed = []; const spy = { ...sys, kill: (pid, sig) => { killed.push(pid); return sys.kill(pid, sig); } };
    w.s.build("1.1.0");
    const waiter = makeSiteWaiter({ appDir: w.s.app, dataDir: w.s.dataDir, readyUrl: `http://127.0.0.1:${portA}/`, port: portA, sys: spy, timeouts: fast, intervalMs: 200 });
    const r = await runUpdate({ ...opts(w.s), tag: "v1.1.0", exec: w.s.make(), supervised: true, serverPid: findServerPid({ appDir: w.s.app, port: portA, sys }), port: portA, sys: spy, timeouts: fast, confirmServer: waiter });
    assert.equal(r.ok, true);
    assert.ok(killed.length > 0 && killed.every((pid) => !pidsB.includes(pid)), "aucun signal vers le site voisin");
    assert.equal((await health(portB)).version, hashVersion("2.0.0"));
    assert.deepEqual(findSiteProcesses({ appDir: dirB, procs: sys.procs() }).map((p) => p.pid).sort(), [...pidsB].sort(), "mêmes processus qu'avant : pas même redémarré");
    // Le port du voisin tenu quand on met à jour A : on le nomme, on ne le tue pas.
    const occupied = await stopSite({ appDir: w.s.app, port: portB, sys: spy, log: () => {}, timeouts: { ...fast, portMs: 300 } });
    assert.equal(occupied.ok, false);
    assert.equal(occupied.diagnostic.code, "other-program", "dossier voisin sans release.json : un autre programme");
    fs.writeFileSync(path.join(dirB, "release.json"), "{}");
    const named = await stopSite({ appDir: w.s.app, port: portB, sys: spy, log: () => {}, timeouts: { ...fast, portMs: 300 } });
    assert.equal(named.diagnostic.code, "other-site");
    assert.equal(named.diagnostic.cwd, fs.realpathSync(dirB));
    assert.ok(await health(portB), "le voisin répond toujours");
    for (const x of [a, b]) x.stop();
  } finally { w.cleanup(); }
});

test("machine chargée : un serveur lent à s'arrêter est attendu (pas de SIGKILL) ; un serveur sourd à SIGTERM est tué en dernier recours, après le délai, et c'est dit", async () => {
  const w = world(); try {
    const port = await freePort();
    // 1. arrêt lent (2,5 s) : le délai de 6 s suffit
    let sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "sh", env: { FAKE_STOP_MS: "2500" } });
    assert.ok(await until(() => health(port)));
    let lines = [];
    let t0 = Date.now();
    let r = await stopSite({ appDir: w.s.app, port, sys: w.sys, log: logTo(lines), timeouts: fast });
    assert.equal(r.ok, true, lines.join("\n"));
    assert.deepEqual(r.killed, []);
    assert.ok(Date.now() - t0 >= 2400, "on a bien attendu l'arrêt lent");
    sup.stop();
    // 2. sourd à SIGTERM 4 s, délai explicite de 1 s : SIGKILL, journalisé, port libéré
    sup = startSupervised({ unit: "curiosa.service", unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "direct", env: { FAKE_IGNORE_TERM_MS: "4000" } });
    assert.ok(await until(() => health(port)));
    lines = []; t0 = Date.now();
    r = await stopSite({ appDir: w.s.app, port, sys: w.sys, log: logTo(lines), timeouts: { ...fast, stopMs: 1000 } });
    assert.equal(r.ok, true, lines.join("\n"));
    assert.equal(r.killed.length, 1);
    const took = Date.now() - t0;
    assert.ok(took >= 950, `SIGKILL après le délai explicite, pas avant (${took} ms)`);
    assert.match(lines.join("\n"), /n'ont pas obéi en 1 s : arrêt forcé \(SIGKILL\)/);
    sup.stop();
  } finally { w.cleanup(); }
});

test("machine chargée : un serveur qui démarre lentement est attendu dans le délai, et au-delà on explique (qui écoute, quelle version, état du service)", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 300, tree: "direct", env: { FAKE_START_MS: "2500" } });
    const sys = withCgroups(w.sys);
    const base = { appDir: w.s.app, dataDir: w.s.dataDir, readyUrl: `http://127.0.0.1:${port}/`, port, sys, intervalMs: 200 };
    const lines = () => fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8");
    // Le superviseur a lancé son premier essai (sous charge, node met du temps à démarrer) : on ne mesure pas l'ordre de démarrage du test.
    assert.ok(await until(() => findSiteProcesses({ appDir: w.s.app, procs: sys.procs() }).length > 0, 40_000));
    // trop court : échec expliqué
    const tooShort = await makeSiteWaiter({ ...base, timeouts: { ...fast, siteMs: 1000 } })("v1.0.0", { oldPids: new Set() });
    assert.equal(tooShort, false);
    assert.match(lines(), /✘ le nouveau site n'est pas revenu : personne n'écoute sur le port \d+ ; le site ne répond pas ; \d+ processus du site en cours \(curiosa\.service\)\. Pour voir pourquoi : `sudo journalctl -u curiosa -n 60 --no-pager`/);
    // assez long : confirmé
    assert.equal(await makeSiteWaiter({ ...base, timeouts: { ...fast, siteMs: 10_000 } })("v1.0.0", { oldPids: new Set() }), true);
    sup.stop();
  } finally { w.cleanup(); }
});

test("un ancien serveur encore actif, ou la mauvaise version, ou une page 500 ne comptent JAMAIS comme « le site est revenu »", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "direct" });
    assert.ok(await until(() => health(port)));
    const base = { readyUrl: `http://127.0.0.1:${port}/`, port, sys: w.sys, timeoutMs: 1200, intervalMs: 150 };
    const old = new Set(findSiteProcesses({ appDir: w.s.app, procs: w.sys.procs() }).map((p) => p.pid));
    const wrong = await confirmNewServer({ ...base, expectedVersion: hashVersion("1.1.0"), oldPids: new Set() });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, "wrong-version", "l'ancienne version répond, ce n'est pas la nouvelle");
    const stale = await confirmNewServer({ ...base, expectedVersion: hashVersion("1.0.0"), oldPids: old });
    assert.equal(stale.ok, false, "l'ancien processus est encore là : même si la version « colle », on n'a pas redémarré");
    assert.equal(stale.reason, "old-process");
    const right = await confirmNewServer({ ...base, expectedVersion: hashVersion("1.0.0"), oldPids: new Set() });
    assert.deepEqual([right.ok, right.how], [true, "version"]);
    // Une page 500 : pas de route de contrôle (ancienne version) et accueil en erreur → pas revenu.
    sup.stop(); killAllUnder(w.root, w.sys.procs());
    const sup500 = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "direct", env: { FAKE_HOME_500: "1" } });
    assert.ok(await until(() => health(port)));
    const fetch404 = async (url, o) => (String(url).endsWith("/api/health") ? new Response("", { status: 404 }) : fetch(url, o));
    const five = await confirmNewServer({ ...base, expectedVersion: hashVersion("1.0.0"), oldPids: new Set(), fetchImpl: fetch404 });
    assert.equal(five.ok, false, "un 500 n'est pas un site revenu");
    sup500.stop();
  } finally { w.cleanup(); }
});

test("version installée trop ancienne pour avoir /api/health : le nouveau serveur est reconnu à son processus (pid inconnu avant l'arrêt), en le disant", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "direct" });
    assert.ok(await until(() => health(port)));
    const noRoute = async (url, o) => (String(url).endsWith("/api/health") ? new Response("", { status: 404 }) : fetch(url, o));
    const base = { readyUrl: `http://127.0.0.1:${port}/`, port, sys: w.sys, timeoutMs: 1500, intervalMs: 150, fetchImpl: noRoute, expectedVersion: hashVersion("0.1.26") };
    const oldPids = new Set(findSiteProcesses({ appDir: w.s.app, procs: w.sys.procs() }).map((p) => p.pid));
    const same = await confirmNewServer({ ...base, oldPids });
    assert.equal(same.ok, false, "c'est le même processus qu'avant : pas le nouveau");
    const fresh = await confirmNewServer({ ...base, oldPids: new Set([999999]) });
    assert.deepEqual([fresh.ok, fresh.how], [true, "process"]);
    sup.stop();
  } finally { w.cleanup(); }
});

/* ───────────── chaîne de deux étapes ───────────── */

const published = (files) => async (url) => {
  const m = /\/download\/(v[^/]+)\/upgrade\.json$/.exec(url);
  return files[m[1]] === undefined ? null : JSON.stringify(files[m[1]]);
};

test("chaîne 0.1.26 → 0.1.27 simulée de bout en bout : l'étape 2 n'est téléchargée qu'APRÈS confirmation du serveur de l'étape 1", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 800, tree: "npx" });
    assert.ok(await until(() => health(port)));
    const sys = withCgroups(w.sys);
    w.s.build("1.1.0"); w.s.build("1.2.0");
    const seen = [];
    const download = async (url, dest) => {
      if (url.includes("v1.2.0/") && url.endsWith(".tar.gz")) seen.push((await health(port))?.version);
      return w.s.download(url, dest);
    };
    const waiter = makeSiteWaiter({ appDir: w.s.app, dataDir: w.s.dataDir, readyUrl: `http://127.0.0.1:${port}/`, port, sys, timeouts: fast, intervalMs: 200 });
    const r = await runUpdateChain({ ...opts(w.s, { download }), tag: "v1.2.0", exec: w.s.make(), supervised: true, serverPid: findServerPid({ appDir: w.s.app, port, sys }), port, sys, timeouts: fast,
      fetchText: published({ "v1.2.0": { minFrom: "1.1.0" } }), waitForSite: waiter, confirmServer: waiter, findServerPid: () => findServerPid({ appDir: w.s.app, port, sys }) });
    assert.deepEqual(r, { ok: true }, fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8"));
    assert.deepEqual(seen, [hashVersion("1.1.0")], "au moment de télécharger l'étape 2, le serveur répondait DÉJÀ la version de l'étape 1");
    assert.equal((await health(port)).version, hashVersion("1.2.0"));
    assert.equal(readState(w.s.dataDir).status, "success");
    sup.stop();
  } finally { w.cleanup(); }
});

test("chaîne : le serveur de l'étape 1 ne revient pas (personne ne le relance) → l'étape 2 n'est ni téléchargée ni installée, échec expliqué", async () => {
  const w = world(); try {
    const port = await freePort();
    const sup = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: -1, tree: "direct" }); // ne relance jamais
    assert.ok(await until(() => health(port)));
    w.s.build("1.1.0"); w.s.build("1.2.0");
    const waiter = makeSiteWaiter({ appDir: w.s.app, dataDir: w.s.dataDir, readyUrl: `http://127.0.0.1:${port}/`, port, sys: w.sys, timeouts: { ...fast, siteMs: 1500 }, intervalMs: 150 });
    const r = await runUpdateChain({ ...opts(w.s), tag: "v1.2.0", exec: w.s.make(), supervised: true, serverPid: findServerPid({ appDir: w.s.app, port, sys: w.sys }), port, sys: w.sys, timeouts: { ...fast, siteMs: 1500 },
      fetchText: published({ "v1.2.0": { minFrom: "1.1.0" } }), waitForSite: waiter, confirmServer: waiter, findServerPid: () => undefined });
    assert.deepEqual(r, { ok: false, error: "site-not-back" });
    assert.ok(!w.s.downloads.some((u) => u.includes("v1.2.0/curiosa")), "l'étape 2 n'est même pas téléchargée");
    assert.equal(w.s.buildId(), "build-1.1.0");
    const log = fs.readFileSync(path.join(w.s.dataDir, "update", "update.log"), "utf8");
    assert.match(log, /✘ le nouveau site n'est pas revenu : personne n'écoute sur le port/);
    assert.match(log, /aucun processus du site n'est en cours : le service est arrêté ou plante au démarrage/);
    sup.stop();
  } finally { w.cleanup(); }
});

test("chaîne : un port tenu par un autre gestionnaire à l'étape 1 arrête tout avec le diagnostic ; l'étape 2 n'a pas lieu", async () => {
  const w = world(); try {
    const port = await freePort();
    const systemd = startSupervised({ unit: "curiosa.service", rootDir: w.root, appDir: w.s.app, port, delay: 60_000, // jamais autorisé à relancer pendant ce test : seul le faux pm2 peut reprendre le port
       tree: "npx" });
    assert.ok(await until(() => health(port)));
    const pm2 = startSupervised({ unit: "pm2-monsite.service", rootDir: w.root, appDir: w.s.app, port, delay: 50, tree: "sh" });
    assert.ok(await until(() => findSiteProcesses({ appDir: w.s.app, procs: withCgroups(w.sys).procs() }).some((p) => /pm2/.test(cgroupUnit(p.cgroup) ?? "")), 40_000), "le faux pm2 a lancé sa première tentative");
    const sys = withCgroups(w.sys);
    w.s.build("1.1.0"); w.s.build("1.2.0");
    const r = await runUpdateChain({ ...opts(w.s), tag: "v1.2.0", exec: w.s.make(), supervised: true, serverPid: findServerPid({ appDir: w.s.app, port, sys }), port, sys, timeouts: patient,
      fetchText: published({ "v1.2.0": { minFrom: "1.1.0" } }), waitForSite: async () => assert.fail("pas d'attente"), findServerPid: () => undefined });
    assert.deepEqual(r, { ok: false, error: "port-busy" });
    assert.ok(!w.s.downloads.some((u) => u.includes("v1.2.0/curiosa")));
    assert.equal(readState(w.s.dataDir).diagnostic.code, "other-manager");
    for (const x of [systemd, pm2]) x.stop();
  } finally { w.cleanup(); }
});

/* ───────────── conclusion au démarrage (tâche arrêtée avec le service) ───────────── */

test("tâche arrêtée par le service pendant le redémarrage (KillMode=control-group) : le nouveau serveur conclut honnêtement, sur la version qui tourne", async () => {
  const { reconcileInterruptedUpdate } = await import("@/core/updates/service");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-rec-"));
  try {
    const write = (patch) => { fs.mkdirSync(path.join(dir, "update"), { recursive: true }); fs.writeFileSync(path.join(dir, "update", "state.json"), JSON.stringify({ status: "running", step: "restarting", target: "v1.2.0", expectedVersion: "1.2.0", updaterPid: 424242, startedAt: 1, ...patch })); };
    const dead = () => false, alive = () => true;
    write({});
    assert.equal(reconcileInterruptedUpdate({ dataDir: dir, version: "1.2.0", alive }), null, "la tâche vit encore : elle garde la main");
    assert.equal(readState(dir).status, "running");
    assert.equal(reconcileInterruptedUpdate({ dataDir: dir, version: "1.2.0", alive: dead }), "success");
    assert.equal(readState(dir).status, "success");
    write({});
    assert.equal(reconcileInterruptedUpdate({ dataDir: dir, version: "1.1.0", alive: dead }), "failed", "le site tourne sur une autre version : pas de faux succès");
    assert.deepEqual([readState(dir).status, readState(dir).error], ["failed", "wrong-version"]);
    write({ chain: { index: 1, total: 2, steps: ["v1.1.0", "v1.2.0"] }, target: "v1.1.0", expectedVersion: "1.1.0" });
    assert.equal(reconcileInterruptedUpdate({ dataDir: dir, version: "1.1.0", alive: dead }), "partial");
    const st = readState(dir);
    assert.deepEqual([st.status, st.target, st.remaining], ["success", "v1.1.0", ["v1.2.0"]]);
    write({ step: "download" });
    assert.equal(reconcileInterruptedUpdate({ dataDir: dir, version: "1.2.0", alive: dead }), null, "seulement pendant le redémarrage");
    assert.match(fs.readFileSync(path.join(dir, "update", "update.log"), "utf8"), /constaté par le nouveau serveur au démarrage/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ───────────── garde-fous de code ───────────── */

test("le code de mise à jour : aucune commande externe pour lire le système, aucun signal hors du dossier du site, aucune version brute exposée", () => {
  const proc = fs.readFileSync("scripts/update-proc.mjs", "utf8");
  assert.ok(!/child_process|execSync|execFile|spawn\(/.test(proc), "update-proc.mjs ne lance aucune commande");
  assert.ok(!/process\.kill\(-|killpg|kill\(-/.test(proc), "jamais de groupe de processus");
  assert.ok(!/proc\/[^\n]*environ\b|"environ"/.test(proc), "/proc/<pid>/environ n'est jamais lu (secrets)");
  const route = fs.readFileSync("src/app/api/health/route.ts", "utf8");
  assert.ok(!/version|prisma|process\.env/i.test(route.replace(/^\/\/.*$/gm, "")), "la route de contrôle ne renvoie ni version ni donnée");
  assert.match(fs.readFileSync("next.config.mjs", "utf8"), /hashVersion\(VERSION\)/);
});

test("modèle d'unité et documentation : pas de npx, KillMode, TimeoutStopSec, un seul gestionnaire, dépannage avec les 4 commandes", () => {
  const unit = fs.readFileSync("deploy/curiosa.service", "utf8");
  assert.match(unit, /^ExecStart=\/usr\/bin\/node node_modules\/next\/dist\/bin\/next start -p 3000$/m);
  assert.ok(!/^ExecStart=.*npx/m.test(unit));
  assert.match(unit, /^KillMode=control-group$/m);
  assert.match(unit, /^TimeoutStopSec=\d+$/m);
  assert.match(unit, /un seul gestionnaire par site/i);
  for (const f of ["docs/INSTALL.md", "docs/MAINTENANCE-IA.md", "README.md"]) {
    const t = fs.readFileSync(f, "utf8");
    assert.match(t, /un seul gestionnaire par site/i, f);
  }
  const install = fs.readFileSync("docs/INSTALL.md", "utf8");
  assert.match(install, /La mise à jour s'arrête sur une erreur 500 \/ EADDRINUSE/);
  for (const cmd of ["ss -ltnp | grep :3000", "systemctl status", "pm2 list", "journalctl"]) assert.ok(install.includes(cmd), cmd);
  for (const v of ["CURIOSA_STOP_SECONDS", "CURIOSA_PORT_SECONDS", "CURIOSA_SITE_SECONDS"]) assert.ok(install.includes(v), v);
  assert.ok(!/ExecStart=.*npx/.test(fs.readFileSync("README.md", "utf8")), "le README n'installe plus l'unité avec npx");
});

void execFileSync;
