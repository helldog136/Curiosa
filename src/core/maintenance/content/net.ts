import dns from "node:dns/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { createNetClient, type NetClient, type NetDeps } from "@/core/services/net";
import { addressIsPrivate } from "@/core/url";

/**
 * CONTRÔLE DU CONTENU — le côté réseau des visites de liens : résoudre un nom, puis se connecter À L'ADRESSE QU'ON A VÉRIFIÉE.
 *
 * Pourquoi : vérifier l'adresse numérique d'un nom puis laisser `fetch` le résoudre une seconde fois ouvre la porte au « rebinding » (un serveur DNS qui répond
 * une adresse publique à la première question et une adresse interne à la seconde). Ici il n'y a QU'UNE résolution par visite : la liste d'adresses vérifiées est
 * posée dans une table (`pins`), et la connexion est ouverte avec une fonction `lookup` qui ne rend que ces adresses. Un nom absent de la table n'est jamais résolu :
 * la visite échoue (« fail closed »). Le nom reste celui de l'adresse pour le certificat (SNI et vérification du certificat comme d'habitude).
 *
 * La limitation de débit (429), le disjoncteur, le délai dur et le journal viennent du client réseau du cœur (`createNetClient`), avec son propre état.
 */

export const DNS_TIMEOUT_MS = 3000;

export type Resolved = { ok: true; addresses: string[] } | { ok: false; reason: "notfound" | "timeout" | "error" };
export type Resolver = (host: string) => Promise<Resolved>;

/** Résout un nom (3 s au plus, une seule fois). Les adresses sont rendues telles quelles : c'est à l'appelant de refuser les adresses privées. */
export const resolveHost: Resolver = async (host) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const found = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), DNS_TIMEOUT_MS); }),
    ]);
    const addresses = [...new Set(found.map((a) => a.address))];
    return addresses.length ? { ok: true, addresses } : { ok: false, reason: "notfound" };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") return { ok: false, reason: "notfound" };
    return { ok: false, reason: (error as Error)?.message === "timeout" ? "timeout" : "error" };
  } finally { clearTimeout(timer); }
};

/** Table nom → adresses vérifiées, la SEULE source d'adresses de la connexion. */
export type PinTable = Map<string, string[]>;

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;
const familyOf = (a: string) => (a.includes(":") ? 6 : 4);

/** Fonction `lookup` d'une connexion : ne rend QUE les adresses vérifiées, quel que soit le nom demandé. */
export function pinnedLookup(addresses: readonly string[], allowPrivate = false) {
  return (_host: string, options: unknown, callback?: LookupCb): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCb;
    const opts = (typeof options === "object" && options ? options : {}) as { all?: boolean; family?: number | string };
    const wanted = Number(opts.family) === 4 || opts.family === "IPv4" ? 4 : Number(opts.family) === 6 || opts.family === "IPv6" ? 6 : 0;
    const usable = addresses.filter((a) => (allowPrivate || !addressIsPrivate(a)) && (!wanted || familyOf(a) === wanted));
    if (!usable.length) { const e: NodeJS.ErrnoException = new Error("no verified address"); e.code = "ENOTFOUND"; cb(e); return; }
    if (opts.all) cb(null, usable.map((address) => ({ address, family: familyOf(address) })));
    else cb(null, usable[0]!, familyOf(usable[0]!));
  };
}

type PinnedOptions = {
  /** Tests seulement : un autre transport (par exemple `http` vers un serveur local) et un autre port. En production : https, port 443. */
  transport?: { request: typeof https.request };
  port?: number;
  /** TESTS SEULEMENT (serveur local sur 127.0.0.1) : accepte des adresses privées. Jamais posé en production. */
  allowPrivate?: boolean;
};

/** Un `fetch` (sans redirection automatique) dont la connexion ne va qu'aux adresses de `pins`. */
export function createPinnedFetch(pins: PinTable, options: PinnedOptions = {}): NonNullable<NetDeps["fetch"]> {
  const transport = options.transport ?? https;
  return (url, init) => new Promise<Response>((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error("invalid url")); return; }
    const host = u.hostname.toLowerCase();
    const addresses = pins.get(host);
    if (!addresses?.length || (!options.allowPrivate && addresses.some(addressIsPrivate))) { reject(new Error("no verified address")); return; }
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined), connection: "close" };
    let settled = false;
    const req = transport.request({
      host, port: options.port ?? 443, path: `${u.pathname}${u.search}`, method, headers,
      agent: false, servername: host, lookup: pinnedLookup(addresses, options.allowPrivate) as never,
    }, (res: IncomingMessage) => {
      settled = true;
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        try { if (Array.isArray(v)) v.forEach((x) => out.append(k, x)); else if (v !== undefined) out.set(k, v); } catch { /* en-tête illisible : ignoré */ }
      }
      const status = res.statusCode ?? 0;
      const bodyless = method === "HEAD" || status === 204 || status === 205 || status === 304;
      if (bodyless) res.destroy();
      try {
        resolve(new Response(bodyless ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), { status, statusText: res.statusMessage, headers: out }));
      } catch (error) { res.destroy(); reject(error); }
    });
    const abort = () => { req.destroy(new Error("aborted")); if (!settled) reject(new Error("aborted")); };
    if (init.signal?.aborted) { abort(); return; }
    init.signal?.addEventListener("abort", abort, { once: true });
    req.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    req.end();
  });
}

export type ContentNet = { client: NetClient; pins: PinTable };

/** Un client réseau dédié au contrôle du contenu : connexions aux seules adresses vérifiées, avec limitation de débit, disjoncteur, délais durs et journal du cœur. */
export function createContentNet(netDeps: Omit<NetDeps, "fetch"> = {}, pinned: PinnedOptions = {}): ContentNet {
  const pins: PinTable = new Map();
  return { pins, client: createNetClient({ ...netDeps, fetch: createPinnedFetch(pins, pinned) }) };
}

const holder = globalThis as unknown as { curiosaContentNet?: ContentNet };
/** Le client du processus (une pause « trop de demandes » ou un disjoncteur ouvert vaut pour toutes les vérifications). */
export function sharedContentNet(): ContentNet { return (holder.curiosaContentNet ??= createContentNet()); }
export function resetSharedContentNet(): void { delete holder.curiosaContentNet; }
