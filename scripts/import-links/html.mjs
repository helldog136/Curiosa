// Lecture tolérante d'une page HTML, sans dépendance : un petit arbre (balises, attributs, texte), les métadonnées et les blocs JSON embarqués.
// Le contenu lu est une DONNÉE non fiable : rien n'est exécuté, rien n'est interprété comme du HTML par la suite (on ne garde que du texte).

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", euro: "€", middot: "·", copy: "©" };
export const MAX_NODES = 80_000;

export function decodeEntities(s) {
  return String(s ?? "").replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (m, d, h, n) => {
    if (d || h) { const cp = d ? Number(d) : parseInt(h, 16); try { return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; } catch { return ""; } }
    return NAMED[n] ?? m;
  });
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in attrs)) attrs[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** HTML → arbre { tag, attrs, children, parent }. Les nœuds texte ont tag "#text". Borné : au-delà de MAX_NODES, le reste est ignoré. */
export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let count = 0;
  const src = String(html ?? "");
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![a-zA-Z][^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  const text = (t) => { if (t && cur) { cur.children.push({ tag: "#text", text: decodeEntities(t), parent: cur }); count++; } };
  let m;
  while ((m = re.exec(src)) && count < MAX_NODES) {
    text(src.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue; // commentaire, doctype
    const tag = m[2].toLowerCase();
    if (m[1]) { // balise fermante : on remonte jusqu'à la balise ouverte correspondante, s'il y en a une
      for (let n = cur; n && n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; break; }
      continue;
    }
    const attrs = parseAttrs(m[3].replace(/\/\s*$/, ""));
    if (tag === "a") for (let n = cur; n && n !== root; n = n.parent) if (n.tag === "a") { cur = n.parent; break; } // un lien dans un lien n'existe pas en HTML
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node); count++;
    if (RAW.has(tag)) { const end = src.toLowerCase().indexOf(`</${tag}`, last); const stop = end < 0 ? src.length : end; node.children.push({ tag: "#text", text: src.slice(last, stop), parent: node, raw: true }); re.lastIndex = last = end < 0 ? src.length : src.indexOf(">", end) + 1 || src.length; continue; }
    if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) cur = node;
  }
  text(src.slice(last));
  return root;
}

/** Parcours en profondeur, dans l'ordre du document. `visit` renvoie false pour ne pas descendre dans ce nœud. */
export function walk(node, visit) {
  for (const c of node.children ?? []) {
    if (c.tag === "#text") continue;
    if (visit(c) === false) continue;
    walk(c, visit);
  }
}
export const findAll = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
export const find = (node, pred) => { let hit = null; walk(node, (n) => { if (hit) return false; if (pred(n)) { hit = n; return false; } }); return hit; };
export const classesOf = (n) => String(n.attrs?.class ?? "").split(/\s+/).filter(Boolean);
export const hasClass = (n, re) => classesOf(n).some((c) => (re instanceof RegExp ? re.test(c) : c === re));
export const isInside = (n, pred) => { for (let p = n.parent; p; p = p.parent) if (p.tag !== "#root" && pred(p)) return true; return false; };

/** Texte visible d'un nœud (sans script ni style), espaces réduits. */
export function textOf(node) {
  let out = "";
  const rec = (n) => { for (const c of n.children ?? []) { if (c.tag === "#text") { if (!c.raw) out += c.text; } else if (!RAW.has(c.tag)) { if (/^(br|p|div|li|h[1-6])$/.test(c.tag)) out += " "; rec(c); if (/^(p|div|li|h[1-6])$/.test(c.tag)) out += " "; } } };
  rec(node);
  return out.replace(/\s+/g, " ").trim();
}

/** Métadonnées de la page : titre, description, Open Graph, image, adresse canonique. */
export function metaOf(root) {
  const meta = {};
  walk(root, (n) => {
    if (n.tag === "meta") {
      const key = (n.attrs.property ?? n.attrs.name ?? "").toLowerCase();
      if (key && n.attrs.content !== undefined && !(key in meta)) meta[key] = n.attrs.content;
    } else if (n.tag === "title" && !("title" in meta)) meta.title = textOf(n);
    else if (n.tag === "link" && /\bcanonical\b/i.test(n.attrs.rel ?? "") && n.attrs.href) meta.canonical ??= n.attrs.href;
    else if (n.tag === "html" && n.attrs.lang) meta.lang = n.attrs.lang;
  });
  return meta;
}

/** Parcours d'un JSON écrit « à la main » dans une page : cherche la fin de l'objet en respectant les chaînes. */
function balanced(src, start) {
  const open = src[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false;
  for (let i = start; i < src.length && i - start < 3_000_000; i++) {
    const ch = src[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
const tryJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

/** Blocs JSON embarqués : <script type="application/json">, __NEXT_DATA__, JSON-LD, et affectations « window.X = {…} ». */
export function jsonBlocks(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = parseAttrs(m[1]);
    const body = m[2].trim();
    if (!body) continue;
    const type = (attrs.type ?? "").toLowerCase();
    if (/json/.test(type) || attrs.id === "__NEXT_DATA__") {
      const data = tryJson(body);
      if (data !== undefined) out.push({ id: attrs.id ?? null, type: type || "json", data });
      continue;
    }
    if (attrs.src) continue;
    for (const a of body.matchAll(/(?:window\s*\.\s*)?([A-Za-z_$][\w$.]{2,40})\s*=\s*(?=[{[])/g)) {
      if (!/state|data|props|config|store|page|profile|initial/i.test(a[1])) continue;
      const raw = balanced(body, a.index + a[0].length);
      const data = raw ? tryJson(raw) : undefined;
      if (data !== undefined) out.push({ id: a[1], type: "assignment", data });
    }
  }
  return out;
}
export const jsonLd = (blocks) => blocks.filter((b) => /ld\+json/.test(b.type)).flatMap((b) => (Array.isArray(b.data) ? b.data : b.data?.["@graph"] ? [b.data, ...b.data["@graph"]] : [b.data]));
