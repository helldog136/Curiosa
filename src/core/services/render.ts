import { ImageResponse } from "next/og";

/**
 * SERVICE « image PNG » — offert aux modules par le cœur (`ctx.api.png`). Un module décrit une image avec une arborescence de boîtes
 * (`div`, `span`, `p`, `img`, styles en ligne ; flexbox, comme dans un navigateur) et reçoit une `Response` PNG. Générique : ne connaît
 * ni le site ni aucun module. Le rendu est celui de `next/og` (Satori + resvg), sans navigateur ni dépendance de plus.
 *
 * Sécurité : l'image décrite par un module ne doit pas pouvoir faire visiter n'importe quoi au serveur. Une `img` ne charge que
 * un chemin du site (`/uploads/…`) ou une adresse https vers un nom d'hôte public ; tout le reste est remplacé par une boîte vide.
 * Dimensions, profondeur et nombre de nœuds sont bornés.
 */
export type PngNode = string | number | { type: "div" | "span" | "p" | "b" | "img"; props?: Record<string, unknown> & { children?: PngNode | PngNode[] } };
export type PngSpec = { width: number; height: number; tree: PngNode };

const MAX_SIDE = 2000, MIN_SIDE = 16, MAX_NODES = 600, MAX_DEPTH = 24;
const TAGS = new Set(["div", "span", "p", "b", "img"]);

/** Nom d'hôte public ? (pas d'adresse IP littérale, pas de localhost / .local / .internal) */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return !(h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa"));
}

export function safeImageSrc(src: unknown, siteUrl: string): string | null {
  if (typeof src !== "string") return null;
  const s = src.trim();
  if (/^\/(?!\/)/.test(s)) return `${siteUrl.replace(/\/$/, "")}${s}`;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password && isPublicHost(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

/** Valide et copie l'arborescence en éléments que Satori sait lire. Lève une `Error` si la description est abusive. */
export function buildTree(node: PngNode, siteUrl: string, budget = { n: 0 }, depth = 0): unknown {
  if (typeof node === "string") return node.slice(0, 500);
  if (typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !TAGS.has(node.type)) throw new Error("png: invalid node");
  if (++budget.n > MAX_NODES || depth > MAX_DEPTH) throw new Error("png: tree too large");
  const { children, style, ...rest } = (node.props ?? {}) as Record<string, unknown> & { children?: PngNode | PngNode[] };
  const props: Record<string, unknown> = {};
  if (style && typeof style === "object") props.style = Object.fromEntries(Object.entries(style).filter(([, v]) => typeof v === "string" || typeof v === "number"));
  if (node.type === "img") {
    const src = safeImageSrc(rest.src, siteUrl);
    if (!src) return { type: "div", props: { style: { display: "flex", ...(props.style as object), backgroundColor: "transparent" } } };
    Object.assign(props, { src, width: Number(rest.width) || undefined, height: Number(rest.height) || undefined, alt: "" });
  } else {
    const kids = (Array.isArray(children) ? children : children === undefined ? [] : [children]).map((c) => buildTree(c, siteUrl, budget, depth + 1));
    props.children = kids.length === 1 ? kids[0] : kids;
  }
  return { type: node.type, props };
}

/** Rend l'image en PNG. L'appelant ajoute ses propres en-têtes (cache, type MIME déjà posé). */
export async function renderPng(spec: PngSpec, siteUrl: string): Promise<Response> {
  const width = Math.trunc(Number(spec?.width)), height = Math.trunc(Number(spec?.height));
  if (!(width >= MIN_SIDE && width <= MAX_SIDE && height >= MIN_SIDE && height <= MAX_SIDE)) throw new Error("png: invalid size");
  const tree = buildTree(spec.tree, siteUrl);
  return new ImageResponse(tree as never, { width, height });
}
