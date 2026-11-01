/**
 * CONTRÔLE DU CONTENU — lire les liens et les images d'un texte, sans toucher au réseau ni à la base (fonctions pures, testées seules).
 * La visite des liens est dans probe.ts ; les règles d'adresses refusées sont dans core/url.ts (`hostProblem`, `addressIsPrivate`).
 */

/** Texte court, sur une ligne, sans caractère de contrôle (pour les listes et pour les journaux). */
export const clip = (v: unknown, max = 100): string => {
  const t = String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const MD_LINK = /(?<!!)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const HTML_IMG = /<img\b[^>]*>/gi;
const HTML_A = /<a\b[^>]*>/gi;
const AUTOLINK = /<((?:https?:)?\/\/[^\s<>]+)>/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};
const unwrap = (s: string) => String(s ?? "").trim().replace(/^<|>$/g, "");
const blank = (text: string, re: RegExp) => text.replace(re, (m) => " ".repeat(m.length));

/** Texte plus long que cela : on ne cherche des liens que dans ses premiers caractères (jamais d'analyse non bornée). */
export const MAX_TEXT_SCANNED = 200_000;
/** Une même entrée n'apporte pas plus de liens que cela. */
export const MAX_REFS_PER_TEXT = 400;

export type ImageRef = { src: string; alt: string | null };
export type LinkRef = { href: string; text: string };

/**
 * Les images et les liens d'un texte Markdown.
 *   images : [{ src, alt }] — `alt` : "" = pas de description (à signaler) ; `null` = description volontairement vide
 *            (`<img alt="">` écrit exprès : image décorative, on la respecte).
 *   links  : [{ href, text }]
 * Les blocs de code ne contiennent pas de vrais liens : ils sont ignorés.
 */
export function extractRefs(markdown: unknown): { images: ImageRef[]; links: LinkRef[] } {
  let text = String(markdown ?? "").slice(0, MAX_TEXT_SCANNED);
  if (!text) return { images: [], links: [] };
  text = blank(text, /```[\s\S]*?```|~~~[\s\S]*?~~~/g);
  text = blank(text, /`[^`\n]*`/g);
  const images: ImageRef[] = [];
  const links: LinkRef[] = [];
  for (const m of text.matchAll(MD_IMAGE)) images.push({ src: unwrap(m[2]!), alt: m[1]!.trim() });
  text = blank(text, MD_IMAGE);
  for (const m of text.matchAll(HTML_IMG)) {
    const alt = attr(m[0], "alt");
    // pas d'attribut alt du tout : à signaler ; alt="" : voulu, rien à dire
    images.push({ src: attr(m[0], "src") ?? "", alt: alt === null ? "" : alt.trim() === "" ? null : alt.trim() });
  }
  text = blank(text, HTML_IMG);
  for (const m of text.matchAll(HTML_A)) { const href = attr(m[0], "href"); if (href) links.push({ href: href.trim(), text: "" }); }
  text = blank(text, HTML_A);
  for (const m of text.matchAll(MD_LINK)) links.push({ href: unwrap(m[2]!), text: m[1]!.trim() });
  text = blank(text, MD_LINK);
  for (const m of text.matchAll(AUTOLINK)) links.push({ href: m[1]!, text: "" });
  text = blank(text, AUTOLINK);
  for (const m of text.matchAll(BARE_URL)) links.push({ href: m[0].replace(/[.,;:!?]+$/, ""), text: "" });
  return { images: images.slice(0, MAX_REFS_PER_TEXT), links: links.slice(0, MAX_REFS_PER_TEXT) };
}

export type Classified = { kind: "external"; url: string } | { kind: "internal"; path: string } | null;

/**
 * Où mène une adresse trouvée dans un texte ?
 *   external : une autre adresse du web (http ou https ; le fragment #… est retiré)
 *   internal : une page de CE site (chemin sans paramètres, sans « / » final, en minuscules)
 *   null     : rien à vérifier (mailto:, tel:, ancre #, javascript:, chemin relatif sans « / »…)
 * `ownHost` : le nom de domaine du site (les liens vers soi-même sont des liens internes).
 */
export function classifyHref(href: unknown, ownHost = ""): Classified {
  const raw = String(href ?? "").trim();
  if (!raw || raw.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  if (raw.startsWith("#")) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return { kind: "internal", path: normalizePath(raw) };
  let u: URL;
  try { u = new URL(raw.startsWith("//") ? `https:${raw}` : raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (ownHost && u.host.toLowerCase() === ownHost.toLowerCase()) return { kind: "internal", path: normalizePath(u.pathname) };
  u.hash = "";
  return { kind: "external", url: u.href };
}

export function normalizePath(p: unknown): string {
  let path = String(p ?? "").split(/[?#]/)[0]!;
  try { path = decodeURIComponent(path); } catch { /* chemin mal codé : tel quel */ }
  path = path.toLowerCase().replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

/** Le chemin sans l'éventuel préfixe de langue (« /en/blog/x » devient « /blog/x »). */
export function stripLocale(path: string, locales: readonly string[] = []): string {
  const m = /^\/([a-z]{2,3}(?:-[a-z0-9]+)?)(\/.*)?$/.exec(path);
  return m && locales.some((l) => l.toLowerCase() === m[1]) ? (m[2] || "/") : path;
}

/** Nom de domaine d'une adresse, en minuscules et sans « www. » (clé de « un même site »). */
export const hostKey = (url: string): string => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** Une adresse sans identifiants ni paramètres ni fragment : ce qu'on montre et ce qu'on garde dans le rapport (un lien privé peut porter un jeton dans ses paramètres). */
export function displayUrl(url: string, max = 200): string {
  try {
    const u = new URL(url);
    return clip(`${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`, max);
  } catch { return ""; }
}

/** Les sites que la personne ne veut jamais voir visiter (réglage avancé) : une liste de noms ou d'adresses, séparés par des espaces, virgules ou retours à la ligne. */
export function parseSkipHosts(text: unknown): Set<string> {
  return new Set(
    String(text ?? "").slice(0, 10_000).split(/[\s,;]+/).map((h) => {
      try { return new URL(/^[a-z]+:\/\//i.test(h) ? h : `https://${h}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
    }).filter(Boolean).slice(0, 200),
  );
}
