// Outils des tests du contrôle du contenu : un faux réseau branché sur le VRAI client réseau du cœur (limitation de débit, délais, disjoncteur), des résolutions de noms
// scénarisées et une horloge simulée. Aucun test ne sort sur le réseau.
import { createNetClient } from "@/core/services/net";

export const publicDns = async () => ({ ok: true, addresses: ["93.184.216.34"] });

/** Horloge simulée : `sleep` avance le temps sans attendre. `waits` garde chaque attente demandée. */
export function clock(start = 1_700_000_000_000) {
  let t = start;
  const waits = [];
  return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, advance: (ms) => { t += ms; }, at: () => t, waits };
}

/**
 * Faux site distant. `routes` : { "<adresse exacte>" | "*": { status, headers?, text? } | (url, init) => réponse | "silence" | "down" }.
 * `pins` : la table des adresses vérifiées (comme en production) ; chaque appel note ce qu'elle contenait AU MOMENT de la connexion.
 */
export function makeNet(routes, { limits } = {}) {
  const calls = [];
  const pins = new Map();
  const fetch = async (url, init) => {
    const host = new URL(url).hostname;
    calls.push({ url, method: init.method, headers: init.headers, pinned: pins.get(host) ?? null });
    const route = routes[url] ?? routes["*"];
    const r = typeof route === "function" ? route(url, init) : route;
    if (r === "silence") return new Promise(() => {});
    if (r === "down" || !r) throw new Error("ECONNREFUSED");
    const nullBody = init.method === "HEAD" || [204, 205, 304].includes(r.status);
    return new Response(nullBody ? null : (r.text ?? ""), { status: r.status, headers: r.headers });
  };
  const client = createNetClient({ fetch, log: () => {}, limits });
  return { client, pins, calls };
}

/** Une page de `n` liens vers `host` (ou vers `n` sites différents si host vaut "*"). */
export const linksText = (n, host = "example.org") => Array.from({ length: n }, (_, i) => `[lien ${i}](https://${host === "*" ? `site${i}.example.net` : host}/p${i})`).join(" ");
