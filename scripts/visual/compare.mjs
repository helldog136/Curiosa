#!/usr/bin/env node
// Comparaison de deux captures, pixel par pixel.
//   node scripts/visual/compare.mjs <référence> <candidate> [--out <dossier-du-rapport>] [--tolerances <fichier.json>] [--only <texte>] [--channel N]
// Seuil par défaut : 0 pixel différent. Une tolérance n'existe que par un fichier explicite (voir le README) : { "règles": [ { "motif": "night/fr/*/audience*", "maxPixels": 40, "raison": "…" } ] }.
// Sortie : rapport texte, rapport.html, images de différence ; code 0 = identique (ou dans la tolérance), 1 = écarts, 2 = usage / captures incomparables.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--help"].includes(argv[i - 1]) && ["--out", "--tolerances", "--only", "--channel"].includes(argv[i - 1])));
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
if (pos.length < 2) { console.error("usage : compare.mjs <référence> <candidate> [--out dossier] [--tolerances fichier.json] [--only texte] [--channel N]"); process.exit(2); }
const [A, B] = [path.resolve(pos[0]), path.resolve(pos[1])];
const OUT = path.resolve(opt("out", path.join(B, "compare")));
const ONLY = opt("only", "");
const CHANNEL = Number(opt("channel", "0")); // écart toléré par canal (0 = exact)
const tolFile = opt("tolerances", "");
const rules = tolFile ? JSON.parse(fs.readFileSync(tolFile, "utf8")).règles ?? [] : [];
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$");
const ruleFor = (file) => rules.find((r) => globRe(r.motif).test(file.replace(/\.png$/, "")) || globRe(r.motif).test(file));

const mA = JSON.parse(fs.readFileSync(path.join(A, "manifest.json"), "utf8"));
const mB = JSON.parse(fs.readFileSync(path.join(B, "manifest.json"), "utf8"));
const mapOf = (m) => new Map(m.shots.filter((s) => s.file).map((s) => [s.file, s]));
const ma = mapOf(mA), mb = mapOf(mB);
const warnings = [];
if (mA.snapshot?.dbSha256 !== mB.snapshot?.dbSha256) warnings.push(`instantanés différents (${mA.snapshot?.dbSha256?.slice(0, 10)} / ${mB.snapshot?.dbSha256?.slice(0, 10)}) : les contenus ne sont pas les mêmes, la comparaison n'a pas de sens`);
if (mA.snapshot?.extrasCommit !== mB.snapshot?.extrasCommit) warnings.push(`modules différents (${mA.snapshot?.extrasCommit?.slice(0, 8)} / ${mB.snapshot?.extrasCommit?.slice(0, 8)})`);
if (mA.fonts !== mB.fonts) warnings.push("polices système différentes entre les deux captures : écarts de texte probables");
if (mA.browser !== mB.browser) warnings.push(`Chromium différent (${mA.browser} / ${mB.browser})`);
if (mA.now !== mB.now) warnings.push("horloge figée différente");

const names = [...new Set([...ma.keys(), ...mb.keys()])].sort().filter((f) => !ONLY || f.includes(ONLY));
const rows = [];
fs.mkdirSync(path.join(OUT, "diff"), { recursive: true });

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function compareOne(f) {
  const sa = ma.get(f), sb = mb.get(f);
  if (!sa) return { file: f, kind: "extra", detail: "présente seulement dans la candidate" };
  if (!sb) return { file: f, kind: "manquante", detail: "absente de la candidate" };
  if (sa.sha256 === sb.sha256) return { file: f, kind: "identique", diff: 0, w: 0, h: 0 };
  const a = await raw(path.join(A, f)), b = await raw(path.join(B, f));
  const W = Math.max(a.w, b.w), H = Math.max(a.h, b.h);
  let diff = 0, minX = W, minY = H, maxX = -1, maxY = -1;
  const mask = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inA = x < a.w && y < a.h, inB = x < b.w && y < b.h;
      let d = !(inA && inB);
      if (!d) {
        const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4;
        d = Math.abs(a.data[i] - b.data[j]) > CHANNEL || Math.abs(a.data[i + 1] - b.data[j + 1]) > CHANNEL || Math.abs(a.data[i + 2] - b.data[j + 2]) > CHANNEL || Math.abs(a.data[i + 3] - b.data[j + 3]) > CHANNEL;
      }
      if (d) { diff++; mask[y * W + x] = 1; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (diff === 0) return { file: f, kind: "identique", diff: 0, w: W, h: H, note: "fichiers différents mais mêmes pixels" };
  // Image de différence : la référence éclaircie, écarts en rouge vif (un cadre magenta autour de la zone).
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (mask[y * W + x]) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 40; out[o + 3] = 255; }
    else if (x < a.w && y < a.h) { const i = (y * a.w + x) * 4; out[o] = 255 - (255 - a.data[i]) * 0.3; out[o + 1] = 255 - (255 - a.data[i + 1]) * 0.3; out[o + 2] = 255 - (255 - a.data[i + 2]) * 0.3; out[o + 3] = 255; }
    else { out[o] = out[o + 1] = out[o + 2] = 200; out[o + 3] = 255; }
  }
  const diffName = f.replace(/\//g, "__");
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 6 }).toFile(path.join(OUT, "diff", diffName));
  return { file: f, kind: "différente", diff, w: W, h: H, sizeA: `${a.w}x${a.h}`, sizeB: `${b.w}x${b.h}`, bbox: [minX, minY, maxX, maxY], diffImage: `diff/${diffName}` };
}

let n = 0;
for (const f of names) { rows.push(await compareOne(f)); if (++n % 100 === 0) process.stdout.write(`  ${n}/${names.length}\r`); }

const classify = (r) => {
  if (r.kind === "identique") return "ok";
  if (r.kind === "différente") { const rule = ruleFor(r.file); if (rule && r.diff <= rule.maxPixels) { r.tolerated = rule; return "toléré"; } return "écart"; }
  return "écart";
};
for (const r of rows) r.verdict = classify(r);
const bad = rows.filter((r) => r.verdict === "écart"), tol = rows.filter((r) => r.verdict === "toléré"), ok = rows.filter((r) => r.verdict === "ok");

const lines = [];
lines.push(`Référence : ${A}  (cœur ${mA.core}, ${mA.shots.length} captures)`);
lines.push(`Candidate : ${B}  (cœur ${mB.core}, ${mB.shots.length} captures)`);
for (const w of warnings) lines.push(`ATTENTION : ${w}`);
lines.push(`Comparées : ${rows.length} · identiques : ${ok.length} · tolérées : ${tol.length} · ÉCARTS : ${bad.length}  (écart par canal toléré : ${CHANNEL})`);
for (const r of bad) lines.push(r.kind === "différente"
  ? `ÉCART ${r.file} : ${r.diff} pixel(s) différent(s) (zone x${r.bbox[0]}-${r.bbox[2]} y${r.bbox[1]}-${r.bbox[3]}, tailles ${r.sizeA} → ${r.sizeB}) · ${r.diffImage}`
  : `ÉCART ${r.file} : ${r.kind} (${r.detail})`);
for (const r of tol) lines.push(`toléré ${r.file} : ${r.diff} pixel(s) ≤ ${r.tolerated.maxPixels} (${r.tolerated.raison ?? "sans raison"})`);
const errsA = mA.shots.filter((s) => !s.file).length, errsB = mB.shots.filter((s) => !s.file).length;
if (errsA || errsB) lines.push(`Captures en erreur : référence ${errsA}, candidate ${errsB}`);
lines.push(bad.length ? "RÉSULTAT : ÉCHEC (écarts hors tolérance)" : "RÉSULTAT : IDENTIQUE" + (tol.length ? ` (avec ${tol.length} tolérance(s) déclarée(s))` : " (0 pixel)"));
fs.writeFileSync(path.join(OUT, "rapport.txt"), lines.join("\n") + "\n");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const abs = (base, f) => "file://" + path.join(base, f);
const html = `<!doctype html><meta charset="utf-8"><title>Comparaison d'images</title><style>body{font:14px system-ui;margin:20px;background:#f6f6f6;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}.bad{background:#fde8e8}.ok{background:#e8f6e8}.tol{background:#fff6dd}img{max-width:320px;border:1px solid #999}.w{color:#a40}</style>
<h1>${bad.length ? "ÉCARTS : " + bad.length : "Identique"}</h1><p>Référence <code>${esc(A)}</code> (cœur ${esc(mA.core)}) · candidate <code>${esc(B)}</code> (cœur ${esc(mB.core)}) · ${rows.length} captures · identiques ${ok.length} · tolérées ${tol.length}</p>
${warnings.map((w) => `<p class="w">ATTENTION : ${esc(w)}</p>`).join("")}
<table><tr><th>Capture</th><th>Verdict</th><th>Pixels</th><th>Référence</th><th>Candidate</th><th>Différence</th></tr>
${[...bad, ...tol].map((r) => `<tr class="${r.verdict === "écart" ? "bad" : "tol"}"><td>${esc(r.file)}</td><td>${esc(r.verdict)}</td><td>${r.diff ?? ""} ${r.bbox ? `<br>zone ${r.bbox.join(",")}<br>${r.sizeA} → ${r.sizeB}` : esc(r.detail ?? "")}</td>
<td>${ma.has(r.file) ? `<a href="${abs(A, r.file)}"><img loading="lazy" src="${abs(A, r.file)}"></a>` : ""}</td><td>${mb.has(r.file) ? `<a href="${abs(B, r.file)}"><img loading="lazy" src="${abs(B, r.file)}"></a>` : ""}</td><td>${r.diffImage ? `<a href="${r.diffImage}"><img loading="lazy" src="${r.diffImage}"></a>` : ""}</td></tr>`).join("\n")}</table>
<p>Identiques (${ok.length}) : ${ok.map((r) => esc(r.file)).slice(0, 2000).join(" · ")}</p>`;
fs.writeFileSync(path.join(OUT, "rapport.html"), html);

console.log(lines.join("\n"));
console.log(`Rapport : ${path.join(OUT, "rapport.txt")} et ${path.join(OUT, "rapport.html")}`);
process.exit(bad.length ? 1 : 0);
