// De la source lue (page, fichier ou fiche) à la fiche normalisée : le chemin commun au script et aux tests.
import { resolveRedirect } from "./fetch.mjs";
import { readPage, SERVICE_HOSTS } from "./index.mjs";
import { normalise, revalidateProfile } from "./model.mjs";
import { makePage } from "./page.mjs";

/** opts : { adapter, keepSocialsInLinks, resolveRedirects, resolve (fonction de résolution, pour les tests) } */
export async function profileFromSource(src, opts = {}) {
  if (src.kind === "profile") return revalidateProfile(src.profile);
  const read = readPage(makePage({ url: src.url, html: src.html, json: src.json }), { adapter: opts.adapter });
  if (opts.resolveRedirects) {
    const resolve = opts.resolve ?? resolveRedirect;
    let budget = 60; // une page de liens en a rarement plus de quelques dizaines : jamais de rafale
    for (const l of read.raw.links) if (l.needsResolve && budget-- > 0) { try { const to = await resolve(l.url); if (to) { l.url = to; delete l.needsResolve; } } catch { /* reste « non résolu » : signalé dans le rapport */ } }
  }
  return normalise(read.raw, { input: src.input, url: src.url, aggregator: read.aggregator, adapter: read.adapter, fallback: read.fallback, fallbackReason: read.fallbackReason, serviceHosts: SERVICE_HOSTS, keepSocialsInLinks: !!opts.keepSocialsInLinks });
}
