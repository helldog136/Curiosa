// Préchargé (NODE_OPTIONS=--require) dans le serveur du site ET dans l'amorçage : rend le processus déterministe et sans réseau.
//  1. Horloge figée (VISUAL_NOW) : Date.now(), new Date(), Date().
//  2. Hasard déterministe PAR REQUÊTE : Math.random, crypto.randomBytes/randomUUID/getRandomValues/randomInt dérivent d'une graine (VISUAL_SEED + adresse demandée),
//     donc le résultat d'une page ne dépend ni de l'ordre des requêtes ni du nombre de pages vues avant.
//  3. Aucun réseau réel : fetch, http(s).request, net.connect vers autre chose que la boucle locale sont refusés (et journalisés dans VISUAL_NET_LOG).
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const { AsyncLocalStorage } = require("node:async_hooks");

const NOW = Date.parse(process.env.VISUAL_NOW || "2026-06-15T10:00:00.000Z");
const SEED = process.env.VISUAL_SEED || "seed";
const NET_LOG = process.env.VISUAL_NET_LOG || "";

// ─── 1. horloge ───
const RealDate = Date;
globalThis.Date = new Proxy(RealDate, {
  construct(target, args, newTarget) { return args.length === 0 ? new target(NOW) : Reflect.construct(target, args, newTarget === FakeDate ? target : newTarget); },
  apply() { return new RealDate(NOW).toString(); },
  get(target, prop, receiver) { return prop === "now" ? () => NOW : Reflect.get(target, prop, receiver); },
});
const FakeDate = globalThis.Date;

// ─── 2. hasard ───
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const als = new AsyncLocalStorage();
const globalRng = mulberry(hash32(SEED + "|global"));
const rng = () => (als.getStore() ?? { next: globalRng }).next();
Math.random = rng;
const bytes = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rng() * 256); return b; };
const realRandomBytes = crypto.randomBytes;
crypto.randomBytes = function (n, cb) { const b = bytes(n); if (cb) { process.nextTick(cb, null, b); return; } return b; };
crypto.randomUUID = () => { const b = bytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = b.toString("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
crypto.randomInt = function (a, b, cb) { if (typeof b !== "number") { cb = b; b = a; a = 0; } const v = a + Math.floor(rng() * (b - a)); if (cb) { process.nextTick(cb, null, v); return; } return v; };
crypto.getRandomValues = function (arr) { const b = bytes(arr.byteLength); new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(b); return arr; };
crypto.randomFillSync = function (arr) { crypto.getRandomValues(arr); return arr; };
try { Object.defineProperty(globalThis.crypto, "randomUUID", { value: crypto.randomUUID, configurable: true }); } catch {}
try { Object.defineProperty(globalThis.crypto, "getRandomValues", { value: (a) => crypto.getRandomValues(a), configurable: true }); } catch {}
void realRandomBytes;

// Une requête HTTP entrante ouvre son propre contexte de hasard : graine = SEED + méthode + adresse.
const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === "request" && req && req.url) {
    const next = mulberry(hash32(`${SEED}|${req.method}|${req.url}`));
    return als.run({ next }, () => origEmit.call(this, event, req, ...rest));
  }
  return origEmit.call(this, event, req, ...rest);
};

// ─── 3. réseau ───
const LOOP = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/;
function logNet(kind, target) { if (NET_LOG) { try { fs.appendFileSync(NET_LOG, `${kind} ${target}\n`); } catch {} } }
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  let url;
  try { url = new URL(typeof input === "string" ? input : input.url ?? String(input)); } catch { return realFetch(input, init); }
  if (LOOP.test(url.hostname)) return realFetch(input, init);
  logNet("fetch", `${url.protocol}//${url.host}${url.pathname}`);
  return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("réseau coupé par le harnais d'images"), { code: "ECONNREFUSED" }) }));
};
for (const mod of [http, require("node:https")]) {
  const orig = mod.request;
  const wrap = function (...args) {
    const a0 = args[0];
    let host = "";
    if (typeof a0 === "string") { try { host = new URL(a0).hostname; } catch {} } else if (a0 instanceof URL) host = a0.hostname; else if (a0) host = a0.hostname || (a0.host || "").split(":")[0];
    if (host && !LOOP.test(host)) { logNet("http", host); const e = Object.assign(new Error("réseau coupé par le harnais d'images"), { code: "ECONNREFUSED" }); const r = new (require("node:events"))(); r.end = r.write = r.destroy = r.setTimeout = r.on = () => r; process.nextTick(() => r.emit("error", e)); return r; }
    return orig.apply(this, args);
  };
  mod.request = wrap;
  mod.get = function (...args) { const r = wrap.apply(this, args); r.end?.(); return r; };
}
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = args[0];
  const host = o && typeof o === "object" ? o.host : typeof args[1] === "string" ? args[1] : "";
  if (host && !LOOP.test(host)) { logNet("net", host); process.nextTick(() => this.destroy(Object.assign(new Error("réseau coupé par le harnais d'images"), { code: "ECONNREFUSED" }))); return this; }
  return origConnect.apply(this, args);
};
