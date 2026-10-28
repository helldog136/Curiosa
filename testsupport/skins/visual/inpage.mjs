// Fonctions exécutées DANS la page (page.evaluate) : chacune est autonome (aucune variable extérieure). Elles ne modifient rien durablement, sauf `inject()` et `unhide()`.

/** Photographie de la page : textes, liens, images, titres, éléments focalisables (position, visibilité), textes visibles, contenus de pseudo-éléments, tailles. */
export function collectPage() {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const skip = (e) => !!e.closest("[data-bench-chrome],template,script,style,noscript");
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" || parseFloat(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const part = (e) => e.getAttribute("data-skin-part") || "";
  const label = (e) => norm(e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.getAttribute("href") || e.getAttribute("name") || "").slice(0, 50);
  const key = (e) => `${e.tagName.toLowerCase()}${part(e) ? `[${part(e)}]` : ""}:${label(e)}`;
  const SEL = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, [tabindex]:not([tabindex="-1"])';
  const sx = window.scrollX, sy = window.scrollY;
  const regionOf = (e) => {
    if (part(e) === "skip-link") return "skip";
    const r = e.closest("[data-skin-region]");
    const n = r?.getAttribute("data-skin-region");
    return n === "nav" || n === "tools" ? "header" : n === "content" ? "main" : n || "other";
  };
  const ids = new Map();
  const idOf = (e) => { let i = ids.get(e); if (i === undefined) { i = ids.size; ids.set(e, i); } return i; };
  const boxes = {};
  const columns = [];
  const pathOf = (e) => {
    const out = [];
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      if (n !== e && getComputedStyle(n).display === "contents") continue;
      const id = idOf(n); out.unshift(id);
      if (!(id in boxes)) { const r = n.getBoundingClientRect(); boxes[id] = { top: r.top + sy, left: r.left + sx, bottom: r.bottom + sy, right: r.right + sx }; const cs = getComputedStyle(n); if (cs.columnCount !== "auto" && cs.columnCount !== "1") columns.push(id); }
    }
    return out;
  };
  const focusables = [...document.querySelectorAll(SEL)].filter((e) => !skip(e) && !e.disabled && e.getAttribute("tabindex") !== "-1")
    .map((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      const regionName = regionOf(e);
      return {
        key: key(e), part: part(e), visible: vis(e), inline: s.display === "inline" && !!e.closest("p,li,dd,[data-skin-part=prose]") && !e.closest("nav"),
        region: regionName, top: r.top + sy, left: r.left + sx, bottom: r.bottom + sy, right: r.right + sx, w: r.width, h: r.height,
        fixed: s.position === "fixed", path: vis(e) && s.position !== "fixed" ? pathOf(e) : null,
      };
    });
  // texte visible, par élément (une entrée par texte)
  const texts = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = norm(n.nodeValue);
    const p = n.parentElement;
    if (!t || !p || skip(p)) continue;
    if (vis(p)) texts.push(t.slice(0, 60));
  }
  // contenus ajoutés par `content` (lettres ou chiffres)
  const injected = [];
  for (const e of document.body.querySelectorAll("*")) {
    if (skip(e)) continue;
    for (const pseudo of ["::before", "::after"]) {
      const c = getComputedStyle(e, pseudo).content;
      if (!c || c === "none" || c === "normal") continue;
      const inner = c.replace(/^["']|["']$/g, "");
      if (/[\p{L}\p{N}]/u.test(inner)) injected.push(inner.slice(0, 40));
    }
    if (injected.length > 5) break;
  }
  // tailles de texte et interlignes (éléments qui portent du texte à eux)
  const sizes = [];
  for (const e of document.body.querySelectorAll("*")) {
    if (skip(e) || ![...e.childNodes].some((c) => c.nodeType === 3 && norm(c.nodeValue))) continue;
    if (!vis(e)) continue;
    const s = getComputedStyle(e);
    const fs = parseFloat(s.fontSize);
    const lh = s.lineHeight === "normal" ? fs * 1.2 : parseFloat(s.lineHeight);
    const r = e.getBoundingClientRect();
    sizes.push({ key: key(e), fs, lh, lines: Math.round(r.height / lh), body: !!e.closest("[data-skin-part=prose],[data-skin-part=lead],[data-skin-part=list-item],article,main p") && /^(P|LI|DD|BLOCKQUOTE)$/.test(e.tagName) || ["prose", "lead"].includes(part(e)) });
    if (sizes.length >= 400) break;
  }
  const clipped = [];
  for (const e of document.body.querySelectorAll("[data-skin-part]")) {
    if (skip(e) || !vis(e)) continue;
    if (part(e) !== "skip-link" && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === "hidden" && e.clientWidth > 0) clipped.push(key(e));
    if (clipped.length >= 5) break;
  }
  const doc = document.documentElement;
  return {
    text: norm([...document.body.querySelectorAll("*")].filter((e) => !skip(e)).flatMap((e) => [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue)).join(" ")),
    links: [...document.querySelectorAll("a[href]")].filter((e) => !skip(e)).map((a) => a.getAttribute("href")),
    images: [...document.images].filter((i) => !i.closest("[data-skin-part=brand]") && !skip(i)).map((i) => i.getAttribute("src")),
    headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((e) => !skip(e)).map((h) => `${h.tagName}:${norm(h.textContent)}`),
    controls: focusables.map((f) => f.key),
    focusables, orderBoxes: boxes, orderColumns: columns, texts, injected, sizes, clipped,
    scroll: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, innerWidth: window.innerWidth },
    docHeight: doc.scrollHeight,
  };
}

/** Pour chaque élément focalisable visible : le centre est-il recouvert par autre chose ? (fait défiler la page, puis revient en haut.) */
export function findCovered() {
  const SEL = 'a[href], button, input:not([type="hidden"]), textarea, select, summary';
  const out = [];
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  for (const e of [...document.querySelectorAll(SEL)].slice(0, 120)) {
    if (e.closest("[data-bench-chrome],template") || e.disabled) continue;
    const r0 = e.getBoundingClientRect();
    if (r0.width <= 0 || r0.height <= 0 || getComputedStyle(e).visibility === "hidden") continue;
    let hidden = false;
    for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).display === "none") hidden = true;
    if (hidden) continue;
    e.scrollIntoView({ block: "center", inline: "center" });
    const r = e.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) continue;
    // décor posé PAR-DESSUS son propre élément (::before / ::after absolu, opaque, qui couvre l'essentiel de la boîte)
    let overlay = false;
    for (const ps of ["::before", "::after"]) {
      const c = getComputedStyle(e, ps);
      if (c.content === "none" || c.content === "normal" || (c.position !== "absolute" && c.position !== "fixed")) continue;
      const z = c.zIndex === "auto" ? 0 : Number(c.zIndex);
      const w = parseFloat(c.width), h = parseFloat(c.height);
      const m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor); const alpha = m ? (m[1].split(/[\s,\/]+/).filter(Boolean).length > 3 ? Number(m[1].split(/[\s,\/]+/).filter(Boolean)[3]) : 1) : 0;
      const painted = alpha >= 0.5 || c.backgroundImage !== "none";
      if (z >= 0 && painted && w >= 0.8 * r.width && h >= 0.8 * r.height) overlay = true;
    }
    if (hit === e || e.contains(hit)) { if (overlay) out.push(`${e.tagName.toLowerCase()}:${norm(e.getAttribute("aria-label") || e.textContent).slice(0, 40)}`); continue; }
    let covered = !hit.contains(e);
    if (!covered) for (const ps of ["::before", "::after"]) { const s = getComputedStyle(hit, ps); if (s.content !== "none" && s.content !== "normal" && (s.position === "absolute" || s.position === "fixed")) covered = true; }
    if (covered) out.push(`${e.tagName.toLowerCase()}:${norm(e.getAttribute("aria-label") || e.textContent).slice(0, 40)}`);
  }
  window.scrollTo(0, 0);
  return out;
}

/** Rend le texte transparent (pour échantillonner ce qu'il y a DERRIÈRE) ; `noFilter` retire aussi les effets de flou. Rend les boîtes de texte à mesurer. */
export function prepareContrast(noFilter) {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const runs = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parseColor = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  for (let n = tw.nextNode(); n && runs.length < 220; n = tw.nextNode()) {
    const t = norm(n.nodeValue), p = n.parentElement;
    if (!t || !p || p.closest("[data-bench-chrome],template,script,style,noscript")) continue;
    let ok = true;
    for (let e = p; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) { ok = false; break; }
      // texte réservé aux lecteurs d'écran (boîte de 1 px qui rogne) : rien à voir
      const b = e.getBoundingClientRect();
      if ((b.width <= 2 || b.height <= 2) && (s.overflow !== "visible" || s.clip !== "auto" || s.clipPath !== "none")) { ok = false; break; }
    }
    if (!ok) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 3 && r.height > 3);
    if (!rects.length) continue;
    const s = getComputedStyle(p);
    // opacité des ancêtres : le texte est plus pâle d'autant
    let op = 1; for (let e = p; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    // un élément atténué par le cœur lui-même (entrée expirée, bouton désactivé) n'est pas jugé : un skin ne peut pas descendre l'opacité sous 0,6
    if (op < 0.99) continue;
    const c = parseColor(s.color); if (!c) continue;
    const fs = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
    runs.push({ text: t.slice(0, 40), key: `${p.tagName.toLowerCase()}${p.getAttribute("data-skin-part") ? `[${p.getAttribute("data-skin-part")}]` : ""}:${t.slice(0, 30)}`, color: { ...c, a: c.a * op }, large: fs >= 24 || (bold && fs >= 18.66), rects: rects.slice(0, 3).map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height })) });
  }
  const st = document.createElement("style");
  st.setAttribute("data-bench-contrast", "");
  st.textContent = `*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important}svg{visibility:hidden!important}${noFilter ? "*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" : ""}`;
  document.head.appendChild(st);
  return runs;
}
export function unhide() { document.querySelectorAll("style[data-bench-contrast]").forEach((s) => s.remove()); }

/** Ce qui bouge malgré « réduire les animations ». */
export function runningMotion() {
  return document.getAnimations().filter((a) => a.playState === "running" && (a.animationName || (a.transitionProperty && a.effect?.getTiming().duration > 0))).map((a) => a.animationName || a.transitionProperty).slice(0, 5);
}

/** Boîtes d'un élément (sélecteur) : visible ? taille. */
export function boxes(selector) {
  return [...document.querySelectorAll(selector)].map((e) => {
    const r = e.getBoundingClientRect(); let ok = r.width > 0 && r.height > 0;
    for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) ok = false; }
    const inView = r.right > 0 && r.left < innerWidth;
    return { text: (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), visible: ok && inView, w: r.width, h: r.height, open: e.getAttribute("data-open"), expanded: e.getAttribute("aria-expanded") };
  });
}
