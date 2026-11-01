import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { makeTempDir } from "../helpers/tmp.mjs";

/**
 * scripts/install.sh parle plusieurs langues (catalogues en fin de fichier : catalog_en, catalog_fr…).
 * Ce que ce test garantit :
 *  - PARITÉ : mêmes clés et mêmes {arguments} dans tous les catalogues ; aucune clé utilisée par le code et absente ; aucune clé orpheline ;
 *  - ÉCRITURE : vouvoiement, pas de point d'exclamation ni de « Veuillez », pas de jargon interdit (docs/ERGONOMIE-ADMIN.md, R9 à R13) ;
 *  - CHOIX DE LA LANGUE : --lang > CURIOSA_LANG > LC_ALL > LC_MESSAGES > LANG, anglais par défaut, question seulement si on ne peut pas deviner ;
 *  - SORTIES MACHINE : codes de sortie, fichiers écrits, commande pour lire le code d'installation : identiques dans toutes les langues.
 * Le script n'est jamais lancé pour de vrai (racine fictive et bouchons, comme tests/core/install-script.test.mjs).
 */
const SCRIPT = path.resolve("scripts/install.sh");
const SRC = fs.readFileSync(SCRIPT, "utf8");
const NODE = process.execPath;

// ── Les catalogues, lus dans le fichier ───────────────────────────────────────────────────────────────────────────
function catalogs() {
  const out = {};
  for (const m of SRC.matchAll(/^catalog_([a-z]{2,3})\(\) \{ cat <<'CATALOG_([A-Z]+)'\n([\s\S]*?)\nCATALOG_\2\n\}/gm)) {
    assert.equal(m[1].toUpperCase(), m[2], `catalog_${m[1]} : le délimiteur doit être CATALOG_${m[1].toUpperCase()}`);
    const lines = new Map();
    for (const [i, line] of m[3].split("\n").entries()) {
      const k = /^(\S+)(?: (.*))?$/.exec(line);
      assert.ok(k, `catalog_${m[1]} ligne ${i + 1} : « clé texte » attendu, trouvé « ${line} »`);
      assert.ok(!lines.has(k[1]), `catalog_${m[1]} : clé en double « ${k[1]} »`);
      lines.set(k[1], k[2] ?? "");
    }
    out[m[1]] = lines;
  }
  return out;
}
const CATS = catalogs();
const LANGS = (/^LANGS="([a-z ]+)"$/m.exec(SRC) ?? [])[1]?.split(" ") ?? [];
const holes = (text) => [...new Set([...text.matchAll(/\{(\d)\}/g)].map((m) => m[1]))].sort().join(",");
const code = SRC.replace(/^catalog_[a-z]+\(\) \{ cat <<'CATALOG_[A-Z]+'\n[\s\S]*?\nCATALOG_[A-Z]+\n\}/gm, "");

test("les langues annoncées (LANGS) sont exactement les catalogues du fichier ; l'anglais est la langue par défaut", () => {
  assert.deepEqual([...LANGS].sort(), Object.keys(CATS).sort());
  assert.equal(LANGS[0], "en", "la première langue de LANGS est la langue par défaut");
  assert.deepEqual([...LANGS].sort(), ["en", "fr"], "langues prises en charge : si vous en ajoutez une, mettez à jour ce test, docs/INSTALL.md et le CHANGELOG");
});

test("PARITÉ : mêmes clés et mêmes {arguments} dans tous les catalogues (aucun texte manquant, aucun argument oublié)", () => {
  const [ref, ...others] = Object.keys(CATS);
  const problems = [];
  for (const lang of others) {
    for (const k of CATS[ref].keys()) if (!CATS[lang].has(k)) problems.push(`${lang} : clé manquante « ${k} »`);
    for (const k of CATS[lang].keys()) if (!CATS[ref].has(k)) problems.push(`${ref} : clé manquante « ${k} » (présente en ${lang})`);
    for (const [k, v] of CATS[ref]) if (CATS[lang].has(k) && holes(v) !== holes(CATS[lang].get(k))) problems.push(`« ${k} » : arguments {${holes(v)}} en ${ref}, {${holes(CATS[lang].get(k))}} en ${lang}`);
  }
  assert.deepEqual(problems, [], "\n" + problems.join("\n"));
  for (const lang of Object.keys(CATS)) for (const [k, v] of CATS[lang]) assert.ok(!/\{0\}|\{[a-zA-Z]/.test(v), `${lang} « ${k} » : arguments {1} à {9} seulement`);
});

test("chaque clé utilisée par le code existe, et chaque clé du catalogue est utilisée (pas de texte orphelin)", () => {
  const keys = new Set(CATS.en.keys());
  const used = new Set();
  // Les clés citées dans le code : a.b ou a.b_c (jamais suivies d'un point-lettre, qui serait un nom de fichier ou de domaine).
  for (const m of code.matchAll(/(?<![\w./-])([a-z]{1,8}\.[a-z0-9_]+(?:\.[a-z]+)?)(?![\w/-])/g)) used.add(m[1]);
  // Les clés suffixées par une fonction : tn p.pkgs → p.pkgs.one / p.pkgs.other ; usage → help.NN ; fail X → X.fix.
  const callKeys = [...code.matchAll(/\b(?:say|info|sub|ok|warn|title|bullet|fail|consent|logged|manual_proxy_note|report_error|info_n|tn|t|ask [A-Z_]+|_render|_render_n) +"?([a-z]{1,8}\.[a-z0-9_.]+)"?/g)].map((m) => m[1]);
  const missing = callKeys.filter((k) => !keys.has(k) && !keys.has(`${k}.one`));
  assert.deepEqual([...new Set(missing)], [], "clés utilisées par le code mais absentes du catalogue");
  const orphans = [];
  for (const k of keys) {
    const base = k.replace(/\.(fix|one|other)$/, "");
    if (/^help\.\d\d$/.test(k)) continue;
    const isUsed = used.has(k) || used.has(base) || (/\.fix$/.test(k) && keys.has(base) && (used.has(base) || keys.has(base)));
    if (!isUsed) orphans.push(k);
  }
  assert.deepEqual(orphans, [], "clés du catalogue que le code n'utilise pas");
  for (const k of keys) if (k.endsWith(".one")) assert.ok(keys.has(k.replace(/\.one$/, ".other")), `${k} : il faut aussi la forme .other`);
});

test("ÉCRITURE : vouvoiement, pas de point d'exclamation ni de « Veuillez »/« Please », pas de jargon interdit (R9 à R13)", () => {
  const FORBIDDEN = /\b(slug|webhook|payload|json|jeton|eventsub|oauth)\b|(?<![A-Z_])token\b/i;
  const TUTOIEMENT = /(?:^|[\s(«'])(tu|ton|ta|tes|toi|te|t')\s/i;
  const problems = [];
  for (const lang of Object.keys(CATS)) {
    for (const [k, v] of CATS[lang]) {
      if (/^help\./.test(k) || /^lang\./.test(k)) continue;
      if (/!/.test(v)) problems.push(`${lang} ${k} : point d'exclamation`);
      if (/veuillez|please/i.test(v)) problems.push(`${lang} ${k} : « Veuillez/Please »`);
      if (FORBIDDEN.test(v)) problems.push(`${lang} ${k} : mot technique interdit (${FORBIDDEN.exec(v)[0]})`);
      if (lang === "fr" && TUTOIEMENT.test(v)) problems.push(`fr ${k} : tutoiement (vouvoyez)`);
      if (lang === "fr" && /\b(?:il|elle|lui)\b[^.]*\b(?:connecté|inscrit|abonné)\b/i.test(v)) problems.push(`fr ${k} : accord genré`);
      if (/[A-ZÀ-Ý]{12,}/.test(v.replace(/SETUP_TOKEN|SHA-256/g, ""))) problems.push(`${lang} ${k} : MAJUSCULES`);
    }
  }
  assert.deepEqual(problems, [], "\n" + problems.join("\n"));
});

test("l'aide (--help) cite toutes les options que le script reconnaît, dans chaque langue, et les codes de sortie", () => {
  const options = [...new Set([...code.matchAll(/^\s+(--[a-z-]+)(?:=\*)?(?:\|-[a-z])?\)/gm)].map((m) => m[1]))];
  assert.ok(options.length >= 14, `options trouvées : ${options.join(" ")}`);
  for (const lang of LANGS) {
    const r = spawnSync("bash", [SCRIPT, "--help", "--lang", lang], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    for (const o of options) assert.ok(r.stdout.includes(o), `--help (${lang}) ne cite pas ${o}`);
    assert.match(r.stdout, /--lang/);
    assert.match(r.stdout, /\b10\b/);
  }
});

// ── Choix de la langue : on charge les fonctions du script sans le lancer ─────────────────────────────────────────
/** Exécute un petit programme bash après avoir « sourcé » le script (main ne se lance pas). */
function inScript(program, env = {}, input = "") {
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return spawnSync("bash", ["-c", `source "${SCRIPT}"\n${program}`], { encoding: "utf8", env: clean, input });
}
const detect = (env, args = "") => {
  const r = inScript(`pre_scan_lang ${args}; detect_lang; printf '%s %s' "$LANG_CODE" "$LANG_AMBIGUOUS"`, env);
  return { out: r.stdout, status: r.status, err: r.stderr };
};

test("langue : --lang l'emporte sur CURIOSA_LANG, qui l'emporte sur LC_ALL, LC_MESSAGES puis LANG ; anglais si rien n'est reconnu", () => {
  const cases = [
    [{}, "", "en 1"],                                                        // rien : anglais, ambigu
    [{ LANG: "C" }, "", "en 1"],
    [{ LANG: "C.UTF-8" }, "", "en 1"],
    [{ LANG: "POSIX" }, "", "en 1"],
    [{ LANG: "de_DE.UTF-8" }, "", "en 1"],                                   // langue non proposée : anglais, ambigu
    [{ LANG: "fr_FR.UTF-8" }, "", "fr 0"],
    [{ LANG: "fr_BE.UTF-8" }, "", "fr 0"],
    [{ LANG: "fr_CA@euro" }, "", "fr 0"],
    [{ LANG: "FR" }, "", "fr 0"],
    [{ LANG: "en_US.UTF-8" }, "", "en 0"],
    [{ LANG: "en_GB" }, "", "en 0"],
    [{ LANG: "fr_FR.UTF-8", LC_MESSAGES: "en_US.UTF-8" }, "", "en 0"],       // LC_MESSAGES avant LANG
    [{ LANG: "en_US.UTF-8", LC_MESSAGES: "fr_FR.UTF-8" }, "", "fr 0"],
    [{ LANG: "fr_FR.UTF-8", LC_ALL: "en_US.UTF-8" }, "", "en 0"],            // LC_ALL avant tout
    [{ LANG: "fr_FR.UTF-8", LC_ALL: "C" }, "", "en 1"],                      // règle POSIX : LC_ALL=C l'emporte
    [{ LANG: "en_US.UTF-8", CURIOSA_LANG: "fr" }, "", "fr 0"],
    [{ LANG: "fr_FR.UTF-8", CURIOSA_LANG: "en" }, "", "en 0"],
    [{ LANG: "C", CURIOSA_LANG: "fr_BE.UTF-8" }, "", "fr 0"],
    [{ LANG: "fr_FR.UTF-8", CURIOSA_LANG: "klingon" }, "", "fr 0"],          // CURIOSA_LANG inconnue : ignorée, on continue
    [{ LANG: "C", CURIOSA_LANG: "klingon" }, "", "en 1"],
    [{ LANG: "fr_FR.UTF-8", CURIOSA_LANG: "fr" }, "--lang en", "en 0"],      // --lang l'emporte
    [{ LANG: "C", CURIOSA_LANG: "en" }, "--lang fr", "fr 0"],
    [{ LANG: "C" }, "--lang=fr", "fr 0"],
    [{ LANG: "C" }, "--lang FR_be.UTF-8", "fr 0"],
  ];
  for (const [env, args, want] of cases) {
    const r = detect(env, args);
    assert.equal(r.out, want, `${JSON.stringify(env)} ${args} -> ${r.out} ${r.err}`);
  }
});

test("--lang invalide : code 2, message sans dépendre de la langue, rien n'est lancé", () => {
  for (const env of [{ LANG: "fr_FR.UTF-8" }, { LANG: "C" }]) {
    for (const bad of ["xx", "klingon", "d3"]) {
      const r = spawnSync("bash", [SCRIPT, "--lang", bad, "--dry-run", "--site", "x"], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /Langue inconnue \/ Unknown language/);
      assert.match(r.stderr, /en, fr/);
      assert.equal(r.stdout, "", "rien n'est affiché sur la sortie normale");
    }
  }
  assert.equal(spawnSync("bash", [SCRIPT, "--lang"], { encoding: "utf8" }).status, 2, "--lang sans valeur");
});

test("options inconnues et valeur manquante : code 2 dans toutes les langues, message dans la langue choisie", () => {
  const en = spawnSync("bash", [SCRIPT, "--zzz", "--lang", "en"], { encoding: "utf8" });
  const fr = spawnSync("bash", [SCRIPT, "--zzz", "--lang", "fr"], { encoding: "utf8" });
  assert.equal(en.status, 2); assert.equal(fr.status, 2);
  assert.match(en.stderr, /Unknown option: --zzz/); assert.match(fr.stderr, /Option inconnue : --zzz/);
  const nv = spawnSync("bash", [SCRIPT, "--site", "--lang", "en"], { encoding: "utf8" });
  assert.equal(nv.status, 2);
});

test("la question de langue : seulement si ambigu et interactif ; Entrée = anglais ; 2 ou « fr » = français", () => {
  const ask = (answer) => inScript(`LANG_CODE=en; load_catalogs; ask_lang >/dev/null; printf '%s' "$LANG_CODE"`, {}, answer).stdout;
  assert.equal(ask("\n"), "en");
  assert.equal(ask("1\n"), "en");
  assert.equal(ask("2\n"), "fr");
  assert.equal(ask("fr\n"), "fr");
  assert.equal(ask("Français\n"), "fr");
  assert.equal(ask("English\n"), "en");
  assert.equal(ask("n'importe quoi\n"), "en", "réponse incompréhensible : langue par défaut, jamais d'erreur");
  const shown = inScript(`LANG_CODE=en; load_catalogs; ask_lang`, {}, "\n").stdout;
  assert.match(shown, /Language \/ Langue/); assert.match(shown, /1\) English/); assert.match(shown, /2\) Français/);
  // Pas interactif (entrée non terminale) : aucune question, quelle que soit la langue devinée.
  const r = spawnSync("bash", [SCRIPT, "--dry-run", "--site", "x", "--no-domain"], { encoding: "utf8", env: { PATH: process.env.PATH, LANG: "C" }, input: "2\n" });
  assert.doesNotMatch(r.stdout, /Language \/ Langue/);
});

test("moteur de messages : arguments dans l'ordre voulu, valeurs jamais réinterprétées, repli sur l'anglais, pluriels", () => {
  const run = (p, env = {}) => inScript(`LANG_CODE=${env.L ?? "en"}; load_catalogs\n${p}`, env).stdout;
  assert.equal(run(`t un.service_removed "ab"`), "Service ab stopped and removed.");
  // une valeur qui ressemble à un argument, à un motif ou à une substitution n'est pas réinterprétée
  assert.equal(run(`t d.node_ok '{2}' '&' `), "Node.js {2} (&).");
  assert.equal(run(`t d.node_ok 'a&b' '$HOME'`), "Node.js a&b ($HOME).");
  assert.equal(run(`t no.such.key`), "[no.such.key]");
  assert.equal(run(`t d.mem_ok 512`, { L: "fr" }), "Mémoire : 512 Mo.");
  assert.equal(run(`t d.mem_ok 512`), "Memory: 512 MB.");
  // pluriels : 1 -> .one ; autres -> .other ; 0 -> selon la langue (anglais : pluriel ; français : singulier)
  assert.equal(run(`tn d.tools_todo 1 curl`), "Tool to install: curl");
  assert.equal(run(`tn d.tools_todo 2 "curl git"`), "Tools to install: curl git");
  assert.equal(run(`tn d.tools_todo 0 ""`), "Tools to install: ");
  assert.equal(run(`tn d.tools_todo 1 curl`, { L: "fr" }), "Outil à installer : curl");
  assert.equal(run(`tn d.tools_todo 3 "a b c"`, { L: "fr" }), "Outils à installer : a b c");
  assert.equal(run(`tn d.tools_todo 0 ""`, { L: "fr" }), "Outil à installer : ");
  // clé absente d'une langue : repli sur l'anglais (test avec un catalogue fictif)
  const fb = inScript(`catalog_xx() { printf 'lang.name Xx\\nplural.zero other\\n'; }; LANGS="en fr xx"; LANG_CODE=xx; load_catalogs; t d.mem_ok 9`);
  assert.equal(fb.stdout, "Memory: 9 MB.");
});

test("ajouter une langue = ajouter un bloc : une langue fictive est choisie par --lang, CURIOSA_LANG et LANG, avec repli sur l'anglais", () => {
  // On fabrique une copie du script avec un troisième bloc minimal (la vraie procédure est décrite dans docs/INSTALL.md).
  const dir = makeTempDir("i18n-lang-");
  const copy = path.join(dir, "install.sh");
  fs.writeFileSync(copy, SRC.replace('LANGS="en fr"', 'LANGS="en fr xx"').replace(/\n# Le script se lance lui-même/, "\ncatalog_xx() { cat <<'CATALOG_XX'\nlang.name Xxx\nplural.zero other\nd.mem_ok XX {1}\nhelp.01 XX aide\nCATALOG_XX\n}\n\n# Le script se lance lui-même"));
  const sh = (env, args = "") => spawnSync("bash", ["-c", `source "${copy}"; pre_scan_lang ${args}; detect_lang; load_catalogs; printf '%s|' "$LANG_CODE"; t d.mem_ok 7; printf '|'; t d.mem_low 7`], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } }).stdout;
  assert.equal(sh({ LANG: "xx_YY.UTF-8" }), "xx|XX 7|Memory: only 7 MB. This is tight: plan for at least 1 GB (1 to 2 GB recommended), otherwise the site may stop.");
  assert.equal(sh({ CURIOSA_LANG: "xx" }), "xx|XX 7|Memory: only 7 MB. This is tight: plan for at least 1 GB (1 to 2 GB recommended), otherwise the site may stop.");
  assert.match(sh({ LANG: "C" }, "--lang xx"), /^xx\|XX 7\|/);
  const help = spawnSync("bash", [copy, "--help", "--lang", "xx"], { encoding: "utf8" });
  assert.ok(help.stdout.startsWith("XX aide\n"), "les lignes traduites d'abord ; ce qui manque s'affiche en anglais");
  assert.match(help.stdout, /--dry-run/);
});

// ── Le script en entier, dans chaque langue : même comportement, mêmes sorties machine ─────────────────────────────
const STUBS = {
  useradd: `#!/bin/sh\nlast=""; for a in "$@"; do last="$a"; done\nhome=""; while [ $# -gt 0 ]; do [ "$1" = "--home-dir" ] && home="$2"; shift; done\necho "$last:$home" >> "$CURIOSA_ROOT/.users"\n`,
  userdel: `#!/bin/sh\necho "$1" >> "$CURIOSA_ROOT/.deleted-users"\n`,
  chown: `#!/bin/sh\nexit 0\n`,
  getent: `#!/bin/sh\nif [ "$1" = passwd ]; then l=$(grep "^$2:" "$CURIOSA_ROOT/.users" 2>/dev/null | head -n1); [ -n "$l" ] || exit 2; echo "$2:x:999:999::$(echo "$l" | cut -d: -f2):/usr/sbin/nologin"; exit 0; fi\nexec /usr/bin/getent "$@"\n`,
  nginx: `#!/bin/sh\nexit 0\n`,
  systemctl: `#!/bin/sh
state="$CURIOSA_ROOT/.systemctl"; mkdir -p "$state"
echo "$@" >> "$state/calls"
cmd="$1"; shift
case "$cmd" in
  is-active) [ "$1" = "--quiet" ] && shift; n="\${1%.service}"; case ",$FAKE_ACTIVE," in *",$n,"*) exit 0 ;; esac; [ -f "$state/active-$n" ] && exit 0; exit 3 ;;
  daemon-reload|reload|restart|stop|disable) exit 0 ;;
  enable)
    [ "$1" = "--now" ] && shift; n="\${1%.service}"; u="$CURIOSA_ROOT/etc/systemd/system/$n.service"
    exec_line=$(sed -n 's/^ExecStart=//p' "$u"); wd=$(sed -n 's/^WorkingDirectory=//p' "$u")
    touch "$state/active-$n"
    cd "$CURIOSA_ROOT$wd" && nohup sh -c "$exec_line" >"$state/$n.out" 2>&1 &
    echo $! >> "$state/pids"; exit 0 ;;
esac
exit 0
`,
};
function buildRelease(dir, tag = "v9.9.9") {
  const src = path.join(dir, "src");
  const w = (f, c) => { fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true }); fs.writeFileSync(path.join(src, f), c); };
  w("release.json", JSON.stringify({ name: "curiosa", version: tag.slice(1), platform: "linux-x64" }, null, 2));
  w(".env.example", 'DATABASE_URL="file:../data/curiosa.db"\nSITE_URL="http://localhost:3000"\n# SETUP_TOKEN=""\n');
  w("prisma/schema.prisma", "// fixture\n");
  w("node_modules/prisma/build/index.js", 'const fs=require("fs");fs.mkdirSync("data",{recursive:true});fs.writeFileSync("data/curiosa.db","db");console.log("All migrations have been successfully applied.");\n');
  w("node_modules/next/dist/bin/next", 'const http=require("http");const i=process.argv.indexOf("-p");const h=process.argv.indexOf("-H");http.createServer((q,r)=>{r.statusCode=200;r.end("ok")}).listen(Number(process.argv[i+1]),process.argv[h+1]||"0.0.0.0");\n');
  const file = `curiosa-${tag}-linux-x64.tar.gz`;
  execFileSync("tar", ["-czf", path.join(dir, file), "-C", src, "."]);
  fs.writeFileSync(path.join(dir, `${file}.sha256`), `${crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex")}  ${file}\n`);
  return { tag, file };
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function lab(t, o = {}) {
  const base = makeTempDir("inst18-");
  const root = path.join(base, "root");
  for (const d of ["run/systemd/system", "etc", "var/www", "var/log"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, "os-release"), 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n');
  const bin = path.join(base, "bin"); fs.mkdirSync(bin);
  for (const [n, c] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, n), c, { mode: 0o755 });
  const relDir = path.join(base, "rel"); fs.mkdirSync(relDir);
  const rel = buildRelease(relDir);
  const srv = http.createServer((q, r) => {
    if (q.url.endsWith("/releases/latest")) { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ tag_name: rel.tag })); }
    const m = /\/releases\/download\/[^/]+\/([^/]+)$/.exec(q.url);
    if (!m || !fs.existsSync(path.join(relDir, m[1]))) { r.statusCode = 404; return r.end(); }
    r.end(fs.readFileSync(path.join(relDir, m[1])));
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const port = o.port ?? await freePort();
  const env = {
    PATH: `${bin}:${path.dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: base, TMPDIR: base,
    CURIOSA_ROOT: root, CURIOSA_ALLOW_NONROOT: "1", CURIOSA_UNAME_M: "x86_64", CURIOSA_OS_RELEASE: path.join(root, "os-release"),
    CURIOSA_GITHUB_API: url, CURIOSA_GITHUB_WEB: url, CURIOSA_MIN_FREE_MB: "1", CURIOSA_PORT_START: String(port),
    CURIOSA_PUBLIC_IP: "203.0.113.7", CURIOSA_DOMAIN_IP: "203.0.113.7",
  };
  const L = { base, root, port };
  L.run = (args, extra = {}) => new Promise((res) => {
    const c = spawn("bash", [SCRIPT, ...args], { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => res({ status, stdout, stderr, out: stdout + stderr }));
  });
  t.after(async () => {
    const pids = path.join(root, ".systemctl/pids");
    if (fs.existsSync(pids)) for (const p of fs.readFileSync(pids, "utf8").split("\n").filter(Boolean)) { try { process.kill(Number(p)); } catch { /* déjà arrêté */ } }
    await new Promise((res) => srv.close(res)); fs.rmSync(base, { recursive: true, force: true });
  });
  return L;
}
/** Efface ce qui varie légitimement d'une exécution à l'autre (port, date, code d'installation, dossier jetable). */
const normalize = (s, L) => s.replaceAll(L.base, "<BASE>").replaceAll(String(L.port), "<PORT>").replace(/\d{8}-\d{6}/g, "<DATE>").replace(/\d{4}-\d\d-\d\dT[\d:]+Z/g, "<ISO>").replace(/\b[0-9a-f]{32}\b/g, "<TOKEN>").replace(/\b\d+ (Mo|MB) (libres|free)/g, "<MB>");
const filesOf = (root) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name.startsWith(".systemctl") || e.name === "os-release" || e.name === "node_modules" || e.name === "prisma") continue; if (e.isDirectory()) walk(p); else out[p.slice(root.length)] = fs.readFileSync(p, "utf8"); } };
  walk(root); return out;
};

test("--dry-run : en français et en anglais, même code de sortie, même plan, rien n'est modifié ; chaque langue parle sa langue", async (t) => {
  const fr = await lab(t), en = await lab(t);
  const before = JSON.stringify(filesOf(fr.root));
  const a = await fr.run(["--site", "monsite", "--no-domain", "--dry-run", "--lang", "fr"]);
  const b = await en.run(["--site", "monsite", "--no-domain", "--dry-run", "--lang", "en"]);
  assert.equal(a.status, 0, a.out); assert.equal(b.status, 0, b.out);
  assert.match(a.out, /Rien n'a été modifié/); assert.match(b.out, /Nothing was changed/);
  assert.doesNotMatch(b.out, /Rien n'a été|Que faire|Je regarde/); assert.doesNotMatch(a.out, /Nothing was changed|What to do/);
  assert.match(a.out, /monsite-web/); assert.match(b.out, /monsite-web/);
  assert.equal(JSON.stringify(filesOf(fr.root)), before, "rien n'a été modifié (fr)");
  // même structure : autant de lignes dans les deux langues
  assert.equal(a.out.split("\n").length, b.out.split("\n").length);
});

test("--dry-run avec un outil manquant : singulier ; avec plusieurs : pluriel (français et anglais)", async (t) => {
  const L = await lab(t); let toolsDirs = 0;
  // Un PATH fait de liens vers tout /usr/bin et /bin SAUF les outils qu'on veut « absents ».
  const tools = (skip) => {
    const dir = path.join(L.base, `tools-${++toolsDirs}`); fs.mkdirSync(dir);
    for (const d of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      if (!fs.existsSync(d)) continue;
      for (const n of fs.readdirSync(d)) { if (skip.includes(n) || fs.existsSync(path.join(dir, n))) continue; try { fs.symlinkSync(path.join(d, n), path.join(dir, n)); } catch { /* déjà là */ } }
    }
    for (const n of Object.keys(STUBS)) { try { fs.rmSync(path.join(dir, n)); } catch { /* absent */ } fs.symlinkSync(path.join(L.base, "bin", n), path.join(dir, n)); }
    return `${dir}:${path.dirname(NODE)}`;
  };
  const args = (lang) => ["--site", "monsite", "--no-domain", "--dry-run", "--lang", lang];
  const one = await L.run(args("en"), { PATH: tools(["git"]) });
  assert.equal(one.status, 0, one.out);
  assert.match(one.out, /Tool to install: git\b/); assert.match(one.out, /install the missing tool: git\b/);
  const oneFr = await L.run(args("fr"), { PATH: tools(["git"]) });
  assert.match(oneFr.out, /Outil à installer : git\b/); assert.match(oneFr.out, /installer l'outil manquant : git\b/);
  const two = await L.run(args("en"), { PATH: tools(["git", "openssl"]) });
  assert.match(two.out, /Tools to install: git openssl/); assert.match(two.out, /install the missing tools: git openssl/);
  const twoFr = await L.run(args("fr"), { PATH: tools(["git", "openssl"]) });
  assert.match(twoFr.out, /Outils à installer : git openssl/); assert.match(twoFr.out, /installer les outils manquants : git openssl/);
});

test("LANG=C : anglais ; LANG=fr_BE.UTF-8 : français ; --lang l'emporte ; le code de sortie est le même partout", async (t) => {
  const L = await lab(t);
  const base = ["--site", "monsite", "--no-domain", "--dry-run"];
  const c = await L.run(base, { LANG: "C" });
  const be = await L.run(base, { LANG: "fr_BE.UTF-8" });
  const forced = await L.run([...base, "--lang", "fr"], { LANG: "C" });
  const back = await L.run([...base, "--lang", "en"], { LANG: "fr_BE.UTF-8" });
  assert.deepEqual([c.status, be.status, forced.status, back.status], [0, 0, 0, 0]);
  assert.match(c.out, /Nothing was changed/); assert.match(be.out, /Rien n'a été modifié/);
  assert.match(forced.out, /Rien n'a été modifié/); assert.match(back.out, /Nothing was changed/);
  assert.equal(normalize(be.out, L), normalize(forced.out, L), "même résultat avec LANG ou avec --lang");
  assert.equal(normalize(c.out, L), normalize(back.out, L));
});

test("erreurs : même code de sortie (1, 2, 10) et même point d'arrêt dans les deux langues, texte dans la langue choisie", async (t) => {
  const L = await lab(t);
  const scenarios = [
    [["--site", "monsite", "--no-domain", "--yes"], { CURIOSA_UNAME_M: "aarch64" }, 1, /ARM/],
    [["--site", "Mon Site", "--no-domain", "--yes", "--dry-run"], {}, 1, /"?Mon Site"?|« Mon Site »/],
    [["--site", "monsite", "--no-domain", "--user", "root", "--yes", "--dry-run"], {}, 1, /root/],
    [["--site", "monsite", "--domain", "monsite.example.org", "--yes", "--skip-proxy"], { CURIOSA_DOMAIN_IP: "198.51.100.9" }, 1, /203\.0\.113\.7/],
    [["--nope"], {}, 2, /--nope/],
    [["--purge"], {}, 1, /--purge/],
    [["--uninstall"], {}, 1, /--site/],
    [["--uninstall", "--site", "inconnu"], {}, 1, /inconnu/],
  ];
  for (const [args, extra, status, re] of scenarios) {
    const fr = await L.run([...args, "--lang", "fr"], extra), en = await L.run([...args, "--lang", "en"], extra);
    assert.equal(fr.status, status, `${args.join(" ")} (fr) ${fr.out}`);
    assert.equal(en.status, status, `${args.join(" ")} (en) ${en.out}`);
    assert.match(fr.out, re); assert.match(en.out, re);
    if (status === 1 && !/--nope/.test(args.join(" "))) { assert.match(fr.stderr, /ERREUR/); assert.match(fr.stderr, /Que faire/); assert.match(en.stderr, /ERROR/); assert.match(en.stderr, /What to do/); }
    assert.doesNotMatch(en.out, /Que faire|ERREUR/); assert.doesNotMatch(fr.out, /What to do|ERROR/);
  }
  // 10 : installé, adresse publique muette (domaine déjà géré ailleurs par nginx)
  const av = path.join(L.root, "etc/nginx/sites-available"); fs.mkdirSync(av, { recursive: true });
  fs.writeFileSync(path.join(av, "ancien.conf"), "server { server_name monsite.example.org; }\n");
  const ten = await L.run(["--site", "monsite", "--domain", "monsite.example.org", "--yes", "--port", String(L.port), "--lang", "en"], { FAKE_ACTIVE: "nginx" });
  assert.equal(ten.status, 10, ten.out); assert.match(ten.out, /nginx already manages monsite\.example\.org/);
  assert.match(ten.out, /To do so that the public address works/);
});

test("installation complète : les fichiers écrits et les sorties machine sont identiques en français et en anglais", async (t) => {
  const fr = await lab(t), en = await lab(t);
  const a = await fr.run(["--site", "monsite", "--no-domain", "--yes", "--lang", "fr"]);
  const b = await en.run(["--site", "monsite", "--no-domain", "--yes", "--lang", "en"]);
  assert.equal(a.status, 0, a.out); assert.equal(b.status, 0, b.out);
  const fa = filesOf(fr.root), fb = filesOf(en.root);
  const keys = Object.keys(fa).sort();
  assert.deepEqual(Object.keys(fb).sort(), keys, "mêmes fichiers créés");
  for (const k of keys) {
    if (/\.log$/.test(k)) continue;   // le journal contient la sortie des commandes (le contenu varie avec le port), pas un fichier lu par une machine
    assert.equal(normalize(fb[k], en), normalize(fa[k], fr), `fichier ${k} identique dans les deux langues`);
  }
  assert.match(fa["/var/www/monsite/.env"], /^# ─── Ajouté par scripts\/install\.sh \(site : monsite\) ───$/m, "marque technique inchangée");
  assert.match(fa["/etc/systemd/system/monsite.service"], /^# Géré par install-curiosa \(scripts\/install\.sh\), site : monsite$/m);
  // lignes lisibles par une machine ou copiées par la personne : l'adresse et la commande qui lit le code d'installation
  const machine = (s) => s.split("\n").filter((l) => /^ {8}\S/.test(l)).map((l) => l.replace(/\s+\(.*$/, ""));
  assert.deepEqual(machine(normalize(b.stdout, en)), machine(normalize(a.stdout, fr)));
  assert.match(b.stdout, /sudo sed -n 's\/\^SETUP_TOKEN=\/\/p' \/var\/www\/monsite\/\.env \| tr -d '"'/);
  const tok = /^SETUP_TOKEN="(.+)"$/m.exec(fb["/var/www/monsite/.env"])[1];
  assert.ok(!b.out.includes(tok), "le code d'installation n'apparaît dans aucune sortie");
  // en anglais, la page finale prévient que l'assistant s'ouvre en français ; en français, rien de plus qu'avant
  assert.match(b.stdout, /opens in French by default/);
  assert.doesNotMatch(a.stdout, /s'ouvre en français/);
  assert.match(b.stdout, /5\/5  Done/); assert.match(a.stdout, /5\/5  Terminé/);
});

test("relancer en changeant de langue ne casse rien : reprise, désinstallation et marques sont indépendantes de la langue", async (t) => {
  const L = await lab(t);
  assert.equal((await L.run(["--site", "monsite", "--no-domain", "--yes", "--lang", "fr"])).status, 0);
  const env = fs.readFileSync(path.join(L.root, "var/www/monsite/.env"), "utf8");
  const again = await L.run(["--site", "monsite", "--no-domain", "--yes", "--lang", "en"]);
  assert.equal(again.status, 0, again.out); assert.match(again.out, /resume it where it stopped/);
  assert.equal(fs.readFileSync(path.join(L.root, "var/www/monsite/.env"), "utf8"), env);
  const un = await L.run(["--uninstall", "--site", "monsite", "--lang", "en"]);
  assert.equal(un.status, 0, un.out); assert.match(un.out, /Service monsite stopped and removed/);
  assert.ok(!fs.existsSync(path.join(L.root, "etc/systemd/system/monsite.service")));
  assert.ok(fs.existsSync(path.join(L.root, "var/www/monsite/data/curiosa.db")), "les données sont gardées");
  const purge = await L.run(["--uninstall", "--purge", "--site", "monsite", "--yes", "--lang", "en"]);
  assert.equal(purge.status, 1); assert.match(purge.stderr, /typed in a terminal/);
});

test("shellcheck propre sur le script (s'il est installé), et le script reste UN seul fichier autonome (aucun fichier de langue à côté)", () => {
  assert.equal(spawnSync("bash", ["-n", SCRIPT]).status, 0);
  assert.ok(!fs.readdirSync("scripts").some((f) => /^install\..+/.test(f) && f !== "install.sh"), "pas de scripts/install.* à côté : le script est téléchargé seul");
  assert.ok(!/\bsource\b|^\s*\. /m.test(code.replace(/^\s*#.*$/gm, "").replace(/\$\(\. "\$osr".*$/gm, "")), "le script ne charge aucun autre fichier");
  const sc = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
  if (sc.error) { console.log("# SKIP shellcheck n'est pas installé ici"); return; }
  const r = spawnSync("shellcheck", ["-x", "-S", "warning", SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});

test("compatible bash 3 : pas de tableau associatif, ni de ${var,,}, ni de mapfile, ni de |&", () => {
  const plain = code.replace(/^\s*#.*$/gm, "");
  assert.ok(!/declare -A|local -A|typeset -A/.test(plain), "pas de tableau associatif (bash 4)");
  assert.ok(!/\$\{[A-Za-z_]+(,,|\^\^)/.test(plain), "pas de ${var,,} ni ${var^^} (bash 4)");
  assert.ok(!/\bmapfile\b|\breadarray\b|\|&|&>>/.test(plain), "pas de mapfile, |& ni &>> (bash 4)");
  assert.ok(!/\bcoproc\b|\bwait -n\b/.test(plain));
});
