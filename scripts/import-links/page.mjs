// Une « page » à analyser : son adresse, son HTML (ou le JSON enregistré), et ce qu'on en tire une seule fois (arbre, métadonnées, blocs JSON).
import { jsonBlocks, jsonLd, metaOf, parseHtml } from "./html.mjs";
import { hostOf } from "./urls.mjs";

const SERVICES = "Linktree|Linktr\\.ee|Beacons|Bio\\.link|Linkin\\.bio|Later|Lnk\\.Bio|Taplink|Solo\\.to|Campsite\\.bio|Campsite|AllMyLinks|Carrd|Milkshake";
/** « Nom | Linktree » → « Nom » : le nom du service n'est pas le nom de la personne. */
export const stripServiceName = (t) => String(t ?? "").replace(new RegExp(`\\s*(?:[|•·–—-]|on|sur)\\s*(?:${SERVICES})(?:\\s.*)?$`, "i"), "").replace(new RegExp(`^(?:${SERVICES})\\s*[|•·–—:-]\\s*`, "i"), "").trim();

export function makePage({ url = "", html = "", json } = {}) {
  let doc, meta, blocks, ld;
  const page = {
    url, host: hostOf(url), html, json,
    get doc() { return (doc ??= parseHtml(html)); },
    get meta() { return (meta ??= metaOf(page.doc)); },
    get blocks() { return (blocks ??= jsonBlocks(html)); },
    get ld() { return (ld ??= jsonLd(page.blocks)); },
    /** Données JSON utilisables : le fichier JSON enregistré, sinon les blocs de la page (le plus gros d'abord). */
    get data() { return json !== undefined ? [json] : page.blocks.filter((b) => !/ld\+json/.test(b.type)).map((b) => b.data); },
    nextData() { return json?.props?.pageProps ? json : page.blocks.find((b) => b.id === "__NEXT_DATA__")?.data ?? null; },
  };
  return page;
}
