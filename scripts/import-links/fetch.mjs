// Téléchargement prudent d'UNE page publique (ou d'une image). Aucun cookie, aucun identifiant envoyé ; adresses publiques seulement (vérifiées à chaque
// redirection ET au moment de la connexion, pour qu'un nom de domaine ne puisse pas pointer vers le réseau local) ; taille et durée bornées ; jamais exécuté.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { assertPublicUrl, importError, isPrivateAddress } from "./urls.mjs";

export const LIMITS = { maxBytes: 2 * 1024 * 1024, maxImageBytes: 5 * 1024 * 1024, timeoutMs: 10_000, maxRedirects: 4 };
const USER_AGENT = "Mozilla/5.0 (compatible; CuriosaImport/1.0; +page-personnelle)";
// Réservé aux tests (serveur local) : lève la vérification d'adresse publique. Même principe que CURIOSA_ALLOW_LOCAL_MODULES.
const allowLocal = () => process.env.CURIOSA_ALLOW_LOCAL_IMPORT === "1";

/** `lookup` qui refuse toute adresse non publique AU MOMENT de la connexion (anti « DNS rebinding »). */
function safeLookup(hostname, options, cb) {
  const opts = typeof options === "function" ? {} : options ?? {};
  const done = typeof options === "function" ? options : cb;
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return done(err);
    if (!allowLocal() && (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))) return done(Object.assign(new Error(`adresse non publique refusée : ${hostname}`), { code: "PRIVATE_ADDRESS" }));
    if (opts.all) return done(null, addrs);
    done(null, addrs[0].address, addrs[0].family);
  });
}

function once(url, { accept, maxBytes, timeoutMs, method = "GET" }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const req = lib.request(u, {
      method, lookup: safeLookup, agent: false,
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "fr,en;q=0.8", "accept-encoding": "gzip, deflate, br" }, // jamais de cookie ni d'autorisation
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return finish(resolve, { status: res.statusCode, location: res.headers.location, headers: res.headers, body: Buffer.alloc(0) }); }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const decoder = enc === "gzip" || enc === "x-gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : enc === "br" ? zlib.createBrotliDecompress() : null;
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks = []; let size = 0;
      stream.on("data", (c) => { size += c.length; if (size > maxBytes) { req.destroy(); finish(reject, importError("too-large", `réponse trop volumineuse (plus de ${Math.round(maxBytes / 1024)} Ko)`)); } else chunks.push(c); });
      stream.on("end", () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", (e) => finish(reject, importError("network", e.message)));
      res.on("error", (e) => finish(reject, importError("network", e.message)));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, importError("timeout", `pas de réponse après ${timeoutMs / 1000} s`)); }, timeoutMs);
    req.on("error", (e) => finish(reject, e.code === "PRIVATE_ADDRESS" ? importError("private-address", e.message) : importError("network", e.message)));
    req.end();
  });
}

/** Suit les redirections une par une, en revérifiant chaque adresse. `onlyLocation` : s'arrête à la première redirection et renvoie sa destination. */
async function get(url, { accept, maxBytes, kind }) {
  let current = url;
  const chain = [];
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    assertPublicUrl(current, { allowLocal: allowLocal() });
    const r = await once(current, { accept, maxBytes, timeoutMs: LIMITS.timeoutMs });
    if (r.location) {
      let next;
      try { next = new URL(r.location, current).href; } catch { throw importError("bad-url", "redirection illisible"); }
      chain.push(next); current = next; continue;
    }
    if (r.status < 200 || r.status >= 300) throw importError("http-status", r.status === 404 ? "page introuvable (404) : l'adresse est-elle exacte ?" : `le service a répondu ${r.status}`);
    const type = String(r.headers["content-type"] ?? "").toLowerCase();
    if (kind === "page" && type && !/(html|xml|json|text\/plain)/.test(type)) throw importError("bad-type", `contenu inattendu (${type.split(";")[0]})`);
    return { url: current, redirects: chain, contentType: type.split(";")[0], body: r.body };
  }
  throw importError("too-many-redirects", `plus de ${LIMITS.maxRedirects} redirections`);
}

export async function fetchPage(url) {
  const r = await get(url, { accept: "text/html,application/xhtml+xml,application/json;q=0.8", maxBytes: LIMITS.maxBytes, kind: "page" });
  return { url: r.url, redirects: r.redirects, contentType: r.contentType, text: r.body.toString("utf8") };
}
export async function fetchImage(url) {
  const r = await get(url, { accept: "image/png,image/jpeg,image/webp,image/gif", maxBytes: LIMITS.maxImageBytes, kind: "image" });
  return { url: r.url, buffer: r.body };
}
/** Destination finale d'un lien de redirection (au plus quatre sauts, sans télécharger la page d'arrivée) ; null si introuvable. */
export async function resolveRedirect(url) {
  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    assertPublicUrl(current, { allowLocal: allowLocal() });
    const r = await once(current, { accept: "text/html", maxBytes: 64 * 1024, timeoutMs: LIMITS.timeoutMs }).catch((e) => { if (e.code === "too-large") return { status: 200, body: Buffer.alloc(0) }; throw e; });
    if (!r.location) return hop === 0 ? null : current;
    const next = new URL(r.location, current).href;
    const nextHost = new URL(next).hostname;
    if (nextHost !== new URL(current).hostname) return next;
    current = next;
  }
  return null;
}
