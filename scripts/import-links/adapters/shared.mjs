// Briques communes des adaptateurs : lire le JSON embarqué, lire le HTML visible, ou l'un puis l'autre. Chaque adaptateur n'y ajoute que ce qui lui est propre.
import { deepFind, scanJson } from "../jsonScan.mjs";
import { extractFromDom, extractIdentity } from "../domEngine.mjs";

const textOrUrl = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? (v.url ?? v.src ?? v.href ?? v.original ?? "") : "");
const str = (v) => (typeof v === "string" ? v : "");

/** Réseaux d'une liste JSON [{ type, url }] ou d'une liste d'adresses. */
export function readSocials(list) {
  return (Array.isArray(list) ? list : []).flatMap((s) => {
    const url = typeof s === "string" ? s : s?.url ?? s?.href ?? s?.link;
    return typeof url === "string" ? [{ url, type: str(s?.type ?? s?.platform ?? s?.network), label: str(s?.name ?? s?.label) }] : [];
  });
}

/** Identité + liens depuis un JSON. keys : listes de noms de clés à chercher pour le nom, la présentation et l'avatar. */
export function readJson(data, keys, cfg = {}) {
  const scan = scanJson(data, cfg);
  const pickAvatar = deepFind(data, keys.avatar, (v) => !!textOrUrl(v));
  return {
    name: str(deepFind(data, keys.name)), description: str(deepFind(data, keys.bio)), avatar: textOrUrl(pickAvatar),
    links: scan.links, socials: scan.socials, skipped: scan.skipped,
  };
}

/** Lit le HTML visible. */
export function readDom(page, cfg = {}) {
  const r = extractFromDom(page, cfg);
  return { ...extractIdentity(page, cfg), links: r.links, socials: r.socials, skipped: r.skipped };
}

/** JSON embarqué d'abord ; s'il ne donne aucun lien, le HTML visible (et une note pour le rapport). */
export function jsonThenDom(page, { json, dom = {}, scope }) {
  for (const data of page.data) {
    const r = readJson(scope ? scope(data) ?? data : data, json);
    if (r.links.length) {
      const d = page.html ? extractIdentity(page, dom) : {};
      return { ...r, name: r.name || d.name || "", description: r.description || d.description || "", avatar: r.avatar || d.avatar || "", notes: [] };
    }
  }
  if (!page.html) return null;
  const d = readDom(page, dom);
  return d.links.length ? { ...d, notes: ["données lues dans le HTML de la page (pas de JSON embarqué)"] } : null;
}
