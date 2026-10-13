// AllMyLinks (allmylinks.com/<nom>) : page rendue côté serveur ; les boutons passent par une adresse de redirection du service (/link/out?id=…).
// Quand l'adresse finale figure dans la page (attribut data-url ou paramètre de l'adresse) on la prend ; sinon le lien est marqué « à résoudre »
// (l'option --resolve-redirects suit alors la redirection, une fois par lien) et, à défaut, il est signalé dans le rapport.
import { avatarByClass, textByClass } from "../domEngine.mjs";
import { readDom } from "./shared.mjs";

const REDIRECT = /^(?:https?:\/\/(?:www\.)?allmylinks\.com)?\/link\/(?:out|go)\b/i;
const BASE = "https://allmylinks.com";

/** Adresse finale d'un lien de redirection, si la page la donne ; sinon l'adresse de redirection, marquée « à résoudre ». */
export function finalUrl(href, attrs = {}) {
  for (const k of ["data-url", "data-href", "data-link", "data-target"]) if (/^https?:\/\//i.test(attrs[k] ?? "")) return { url: attrs[k] };
  if (!REDIRECT.test(href)) return { url: href };
  try {
    const u = new URL(href, BASE);
    for (const k of ["url", "u", "to", "link", "target"]) { const v = u.searchParams.get(k); if (/^https?:\/\//i.test(v ?? "")) return { url: v }; }
    return { url: u.href, needsResolve: true };
  } catch { return { url: href }; }
}

const adapter = {
  id: "allmylinks", name: "AllMyLinks", hosts: ["allmylinks.com"],
  detect: (page) => /allmylinks\.com/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""}`) || /\/link\/out\?id=/.test(page.html),
  extract(page) {
    const attrsByHref = new Map();
    const collect = (n) => { for (const c of n.children ?? []) { if (c.tag === "a" && c.attrs.href && !attrsByHref.has(c.attrs.href)) attrsByHref.set(c.attrs.href, c.attrs); if (c.children) collect(c); } };
    collect(page.doc);
    const r = readDom(page, { bio: textByClass(/profile-?(description|bio|about)|description|bio/i), avatar: avatarByClass(/avatar|profile/i), hrefOf: (a) => finalUrl(a.attrs.href, a.attrs).url });
    const links = r.links.map((l) => ({ ...l, ...(REDIRECT.test(l.url) ? { needsResolve: true } : {}) }));
    return { ...r, links, notes: links.some((l) => l.needsResolve) ? ["certains liens passent par une redirection d'AllMyLinks : adresse finale à résoudre"] : [] };
  },
};

export default adapter;
