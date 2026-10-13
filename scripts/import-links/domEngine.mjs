// Extraction depuis le HTML visible : le repli quand un service n'embarque pas de JSON lisible, et la base des adaptateurs à page « classique ».
// Principe : on parcourt la page dans l'ordre, on retient les liens qui ne sont ni de la navigation ni un pied de page, et chaque intertitre ouvre une section.
import { classesOf, find, findAll, hasClass, isInside, textOf, walk } from "./html.mjs";
import { stripServiceName } from "./page.mjs";
import { classify } from "./socials.mjs";

const NAV_TAG = /^(nav|footer|aside|form|dialog|noscript|template)$/;
const NAV_CLASS = /(^|[-_])(footer|navbar|nav|cookie|cookies|consent|gdpr|modal|popup|sidebar|menu)([-_]|$)/i;
const isNavigation = (n) => NAV_TAG.test(n.tag) || n.attrs.role === "navigation" || n.attrs.role === "contentinfo" || classesOf(n).some((c) => NAV_CLASS.test(c)) || n.attrs["aria-hidden"] === "true" || n.attrs.hidden !== undefined;
const SOCIAL_CLASS = /social|icons?$|^icons$|network/i;

const firstText = (...c) => c.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).find(Boolean) ?? "";

/** Titre d'un lien : son texte visible, sinon son étiquette accessible, son attribut title ou le texte alternatif de son image. */
export function anchorTitle(a) {
  const img = find(a, (n) => n.tag === "img");
  const svgTitle = find(a, (n) => n.tag === "title");
  return firstText(textOf(a), a.attrs["aria-label"], a.attrs.title, img?.attrs.alt, svgTitle ? textOf(svgTitle) : "");
}

/**
 * Extraction à partir de l'arbre. cfg (tout est facultatif) :
 *  root(node) : limite l'analyse à un conteneur · isLink(a) / isSocial(a) : filtres · titleOf(a) / hrefOf(a) · isSection(node) → intertitre
 *  name(page) · bio(page) · avatar(page) : valeurs propres au service · exclude(node) : zones à ignorer en plus.
 */
export function extractFromDom(page, cfg = {}) {
  const body = find(page.doc, (n) => n.tag === "body") ?? page.doc;
  const root = (cfg.root && find(body, cfg.root)) || body;
  const links = [], socials = [], skipped = [];
  let section = "";
  const sectionOf = cfg.isSection ?? ((n) => /^h[2-4]$/.test(n.tag) && !find(n, (c) => c.tag === "a"));
  const hrefOf = cfg.hrefOf ?? ((a) => a.attrs["data-href"] ?? a.attrs["data-url"] ?? a.attrs.href);
  const titleOf = cfg.titleOf ?? anchorTitle;
  walk(root, (n) => {
    if (isNavigation(n) || cfg.exclude?.(n)) return false;
    if (sectionOf(n)) { const t = textOf(n); if (t && t.length <= 80) section = t; return false; }
    if (n.tag !== "a") return;
    const href = hrefOf(n);
    if (!href || href.startsWith("#")) return false;
    const social = cfg.isSocial ? cfg.isSocial(n) : isInside(n, (p) => classesOf(p).some((c) => SOCIAL_CLASS.test(c)) && (p.tag === "ul" || p.tag === "div" || p.tag === "nav"));
    if (cfg.isLink && !social && !cfg.isLink(n)) { skipped.push({ title: titleOf(n), url: href, reason: "ne ressemble pas à un lien de la page" }); return false; }
    (social ? socials : links).push(social ? { url: href, type: n.attrs["data-type"] ?? n.attrs["data-network"] ?? "", label: titleOf(n) } : { title: titleOf(n), url: href, section });
    return false;
  });
  return { links: links.map((l) => ({ title: l.title, url: l.url, section: l.section })), socials, skipped, root };
}

/** Nom, description et avatar d'une page (valeurs propres au service d'abord, puis Open Graph, puis la balise <title>). */
export function extractIdentity(page, cfg = {}) {
  const body = find(page.doc, (n) => n.tag === "body") ?? page.doc;
  const m = page.meta;
  const h1 = find(body, (n) => n.tag === "h1");
  const name = firstText(cfg.name?.(page), h1 && textOf(h1), stripServiceName(m["og:title"]), stripServiceName(m["twitter:title"]), stripServiceName(m.title));
  const description = firstText(cfg.bio?.(page), m["og:description"], m.description, m["twitter:description"]);
  const avatarNode = cfg.avatar ? cfg.avatar(page) : null;
  const avatar = firstText(avatarNode, m["og:image"], m["twitter:image"], m["twitter:image:src"]);
  return { name, description, avatar };
}

/** Image d'avatar d'après son nom de classe ou son texte alternatif. */
export const avatarByClass = (re) => (page) => { const img = find(page.doc, (n) => n.tag === "img" && (classesOf(n).some((c) => re.test(c)) || re.test(n.attrs.alt ?? "") || isInside(n, (p) => classesOf(p).some((c) => re.test(c))))); return img?.attrs.src ?? img?.attrs["data-src"] ?? ""; };
export const textByClass = (re, tag) => (page) => { const n = find(page.doc, (x) => (!tag || x.tag === tag) && hasClass(x, re)); return n ? textOf(n) : ""; };
export { classify, findAll };
