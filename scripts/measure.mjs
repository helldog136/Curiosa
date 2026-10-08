// Mesure ce qu'une page envoie à un visiteur : requêtes, poids, services tiers, cookies. Aucune dépendance : n'importe qui peut vérifier les chiffres.
//   node scripts/measure.mjs https://exemple.org/            → tableau Markdown
//   node scripts/measure.mjs https://exemple.org/ --json     → JSON
//   node scripts/measure.mjs http://localhost:3000/ --pid 1234   → ajoute la mémoire (RSS) du processus du serveur (Linux)
// Méthode : la page est chargée comme le ferait un premier visiteur (sans cookie), puis chaque fichier qu'elle référence (scripts, styles, images, polices,
// vidéos) est téléchargé. Limites assumées : les ressources demandées PAR le JavaScript après le chargement ne sont pas vues (la page de ce projet n'en fait
// que vers son propre serveur), et le poids « gzip » est une estimation (compression gzip du contenu), pas la mesure d'un réseau réel.
import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const KINDS = { script: "JavaScript", style: "CSS", image: "Images", font: "Polices", media: "Vidéo/son", other: "Autres" };

/** Les adresses de fichiers référencées par un document HTML : [{ url, kind }]. */
export function referencedResources(html, base) {
  const found = [];
  const add = (raw, kind) => {
    if (!raw || /^(data:|javascript:|mailto:|tel:|#)/i.test(raw.trim())) return;
    try { found.push({ url: new URL(raw.trim().replace(/&amp;/g, "&"), base).href, kind }); } catch { /* adresse illisible : ignorée */ }
  };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], "script");
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    const rel = (/\brel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "").toLowerCase();
    const as = (/\bas=["']([^"']+)["']/i.exec(tag)?.[1] ?? "").toLowerCase();
    if (rel.includes("stylesheet")) add(href, "style");
    else if (rel.includes("preload") || rel.includes("modulepreload")) add(href, as === "font" ? "font" : as === "style" ? "style" : as === "image" ? "image" : "script");
    else if (rel.includes("icon")) add(href, "image");
  }
  for (const m of html.matchAll(/<(?:img|source|video|audio)\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], /<(?:video|audio)/i.test(m[0]) ? "media" : "image");
  for (const m of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) for (const part of m[1].split(",")) add(part.trim().split(/\s+/)[0], "image");
  const seen = new Set();
  return found.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

const cookieNames = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split("=")[0].trim());

export async function measure(url, { pid } = {}) {
  const origin = new URL(url).origin;
  const cookies = new Set();
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (curiosa-measure)", "accept-encoding": "gzip, br" } });
  for (const c of cookieNames(res)) cookies.add(c);
  const html = await res.text();
  const items = [{ url: res.url, kind: "html", bytes: Buffer.byteLength(html), gzip: zlib.gzipSync(html).length, status: res.status }];
  const refs = referencedResources(html, res.url);
  for (const r of refs) {
    if (new URL(r.url).origin !== origin) { items.push({ ...r, bytes: 0, gzip: 0, status: 0, external: true }); continue; }
    try {
      const f = await fetch(r.url, { headers: { "user-agent": "Mozilla/5.0 (curiosa-measure)", "accept-encoding": "gzip, br" } });
      for (const c of cookieNames(f)) cookies.add(c);
      const buf = Buffer.from(await f.arrayBuffer());
      const compressible = /^(script|style|other)$/.test(r.kind);
      items.push({ ...r, bytes: buf.length, gzip: compressible ? zlib.gzipSync(buf).length : buf.length, status: f.status });
    } catch { items.push({ ...r, bytes: 0, gzip: 0, status: 0 }); }
  }
  const byKind = {};
  for (const i of items.filter((x) => !x.external)) { const k = i.kind === "html" ? "HTML" : KINDS[i.kind] ?? KINDS.other; byKind[k] = (byKind[k] ?? { requests: 0, bytes: 0, gzip: 0 }); byKind[k].requests++; byKind[k].bytes += i.bytes; byKind[k].gzip += i.gzip; }
  const code = items.filter((i) => !i.external && ["html", "script", "style"].includes(i.kind));
  let rssMB = null;
  if (pid) { try { rssMB = Math.round(Number(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]) / 1024); } catch { rssMB = null; } }
  return {
    url: res.url, status: res.status,
    requests: items.filter((i) => !i.external).length,
    externalHosts: [...new Set(items.filter((i) => i.external).map((i) => new URL(i.url).host))],
    cookies: [...cookies],
    codeBytes: code.reduce((n, i) => n + i.bytes, 0), codeGzipBytes: code.reduce((n, i) => n + i.gzip, 0),
    byKind, rssMB,
  };
}

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;
export function toMarkdown(m) {
  const rows = Object.entries(m.byKind).map(([k, v]) => `| ${k} | ${v.requests} | ${kb(v.bytes)} | ${kb(v.gzip)} |`).join("\n");
  return [
    `Page : ${m.url} (HTTP ${m.status})`, "",
    "| Type | Requêtes | Poids | ≈ gzip |", "|---|---|---|---|", rows, "",
    `- **Requêtes vers le site lui-même** : ${m.requests}`,
    `- **Services tiers appelés par la page** : ${m.externalHosts.length === 0 ? "aucun" : m.externalHosts.join(", ")}`,
    `- **Cookies déposés à la première visite** : ${m.cookies.length === 0 ? "aucun" : m.cookies.join(", ")}`,
    `- **Code envoyé (HTML + JavaScript + CSS)** : ${kb(m.codeBytes)} (≈ ${kb(m.codeGzipBytes)} compressé)`,
    ...(m.rssMB !== null ? [`- **Mémoire du serveur (RSS)** : ${m.rssMB} Mo`] : []),
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) { console.error("usage : node scripts/measure.mjs <url> [--json] [--pid <pid>]"); process.exit(2); }
  const pidAt = args.indexOf("--pid");
  const m = await measure(url, { pid: pidAt >= 0 ? Number(args[pidAt + 1]) : undefined });
  console.log(args.includes("--json") ? JSON.stringify(m, null, 2) : toMarkdown(m));
}
