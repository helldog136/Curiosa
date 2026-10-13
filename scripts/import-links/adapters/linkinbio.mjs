// Linkin.bio (Later) : une grille d'images — chaque vignette est un lien, et la légende du post est le texte alternatif de l'image. On en tire des liens
// intitulés d'après la légende (tronquée). Le compte Instagram d'origine (lien « instagram.com/<nom> ») devient un réseau. Les vignettes sans adresse de destination
// externe (qui renvoient vers Instagram) sont reprises comme liens vers le post.
import { anchorTitle, avatarByClass, extractFromDom, extractIdentity } from "../domEngine.mjs";

const caption = (t) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > 90 ? `${s.slice(0, 87).trimEnd()}…` : s; };

const adapter = {
  id: "linkinbio", name: "Linkin.bio (Later)", hosts: ["linkin.bio", "later.com", "lt.ly"],
  detect: (page) => /linkin\.bio|later\.com\/(linkin|link)/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""} ${page.meta["og:site_name"] ?? ""}`),
  extract(page) {
    const r = extractFromDom(page, { titleOf: (a) => caption(anchorTitle(a)) });
    const id = extractIdentity(page, { avatar: avatarByClass(/avatar|profile/i) });
    return { ...id, links: r.links, socials: r.socials, skipped: r.skipped, notes: [] };
  },
};

export default adapter;
