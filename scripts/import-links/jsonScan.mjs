// Lecture d'un JSON embarqué par un service (Next.js, état initial…) : on ne connaît pas toujours sa forme exacte, et elle change. Plutôt que des chemins figés,
// on cherche ce qu'on sait reconnaître : des listes d'objets « titre + adresse » (les liens), des objets sans adresse qui jouent le rôle d'intertitre (les sections),
// et des listes de réseaux sociaux. Les données restent des DONNÉES : on ne lit que des textes.

const URL_KEYS = ["url", "href", "link", "destination", "target", "targetUrl", "linkUrl", "externalUrl"];
const TITLE_KEYS = ["title", "name", "label", "text", "displayTitle", "headline", "buttonText", "caption"];
const CHILD_KEYS = ["children", "links", "items", "blocks", "buttons", "cards", "elements", "content"];
const SKIP = /^(seo|meta|footer|nav|navigation|menu|analytics|tracking|theme|themes|style|styles|fonts|colors|buildId|assetPrefix|runtimeConfig|query|locale|locales|defaultLocale|i18n|translations|_nextI18Next|scriptLoader|cookies|consent|ads|advertising)$/i;
const HEADER_TYPE = /head|divider|section|title|group|folder|categor|collection|separator|label/i;
const isStr = (v) => typeof v === "string" && v.trim() !== "";
// Une « adresse » : http(s), mailto, relative, ou tout autre schéma (javascript:, data:… : repris tels quels pour être REFUSÉS et signalés plus loin, pas ignorés en silence).
const isUrlish = (v) => isStr(v) && /^([a-z][a-z0-9+.-]*:|\/\/|\/[^/])/i.test(v.trim());
const MAX_NODES = 60_000;

const pick = (o, keys, test = isStr) => { for (const k of keys) if (test(o?.[k])) return o[k]; return undefined; };

/** Première valeur texte trouvée pour l'une de ces clés, en largeur d'abord (les clés du haut de l'arbre l'emportent). */
export function deepFind(data, keys, test = isStr) {
  let level = [data], depth = 0, seen = 0;
  while (level.length && depth < 8) {
    for (const k of keys) for (const n of level) if (n && typeof n === "object" && !Array.isArray(n) && test(n[k])) return n[k];
    const next = [];
    for (const n of level) if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) if (v && typeof v === "object" && !SKIP.test(k) && ++seen < MAX_NODES) next.push(v);
    level = next; depth++;
  }
  return undefined;
}

/** Liens, sections et réseaux d'un JSON. `cfg.skipKeys` : clés supplémentaires à ne pas explorer. */
export function scanJson(data, cfg = {}) {
  const urlKeys = cfg.urlKeys ?? URL_KEYS, titleKeys = cfg.titleKeys ?? TITLE_KEYS;
  const links = [], socials = [], skipped = [];
  let seen = 0;
  const skip = (k) => SKIP.test(k) || (cfg.skipKeys ?? []).includes(k);
  const children = (o) => CHILD_KEYS.flatMap((k) => (Array.isArray(o[k]) ? [o[k]] : []));
  const urlOf = (o) => pick(o, urlKeys, isUrlish);
  const titleOf = (o) => pick(o, titleKeys);
  const visitArray = (arr, section) => {
    let current = section;
    for (const el of arr) {
      if (!el || typeof el !== "object" || ++seen > MAX_NODES) continue;
      if (Array.isArray(el)) { visitArray(el, current); continue; }
      const url = urlOf(el), title = titleOf(el), kids = children(el);
      if (url) {
        if (el.hidden === true || el.isHidden === true || el.archived === true || el.isArchived === true || el.deleted === true) { skipped.push({ title: title ?? url, url, reason: "lien masqué par son auteur" }); continue; }
        links.push({ title: title ?? "", url, section: current ?? "", type: isStr(el.type) ? el.type : "", locked: el.locked === true || el.isLocked === true || el.sensitive === true, order: Number.isFinite(el.position) ? el.position : Number.isFinite(el.order) ? el.order : null });
        for (const k of kids) visitArray(k, current);
      } else if (title && (HEADER_TYPE.test(String(el.type ?? "")) || kids.length) && !socialsOf(el)) {
        if (kids.length) for (const k of kids) visitArray(k, title); else current = title;
      } else if (title && isStr(el.type) && !kids.length && !objectKeys(el).some((k) => Array.isArray(el[k]))) {
        skipped.push({ title, url: "", reason: `bloc sans adresse (type ${el.type})` });
      } else visitObject(el, current);
    }
  };
  const socialsOf = (o) => Object.keys(o).find((k) => /social/i.test(k) && Array.isArray(o[k]));
  const objectKeys = (o) => Object.keys(o);
  const visitObject = (o, section) => {
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== "object" || skip(k) || ++seen > MAX_NODES) continue;
      if (/social|sameAs/i.test(k) && Array.isArray(v)) { for (const s of v) { const url = typeof s === "string" ? s : urlOf(s ?? {}); if (isUrlish(url)) socials.push({ url, type: isStr(s?.type) ? s.type : isStr(s?.platform) ? s.platform : isStr(s?.network) ? s.network : "", label: isStr(s?.name) ? s.name : "" }); } continue; }
      if (Array.isArray(v)) visitArray(v, section); else visitObject(v, section);
    }
  };
  if (Array.isArray(data)) visitArray(data, ""); else if (data && typeof data === "object") visitObject(data, "");
  return { links, socials, skipped };
}
