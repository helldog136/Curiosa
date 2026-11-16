/* eslint-disable no-var, @typescript-eslint/no-explicit-any */
/**
 * THE COMPOSITION ENGINE (core 0.19.0): ONE implementation that draws a composition, used by the editor (admin), by the overlay pages of the modules (through
 * `ctx.overlay.composeScript()`, a text the module puts in its page script) and, later, by the page the assistant opens. A preview and a real alert cannot
 * drift apart.
 *
 * `composeEngine` is SELF-CONTAINED on purpose: it is sent to OBS as its own source text (`composeScript()`), so it uses nothing from this file or any other
 * (a test runs that text alone). Written in plain old JavaScript (no spread, no classes, no async) so no compiler adds helpers to it.
 *
 * Safety: texts go in with `textContent`, never as HTML; colours are `#rrggbb` checked again here; fonts, animations, fits come from closed lists; numbers
 * are bounded again. The data was already checked by `checkComposition` on the server: this is the second lock.
 */

/** The sheet of the engine (fixed: no value of a composition goes in it). Modules add it to their page `css` (`ctx.overlay.composeCss()`). */
export const COMPOSE_CSS = [
  '[data-ov-region="composition"]{position:absolute;overflow:hidden;contain:layout paint;pointer-events:none}',
  ".cmp-bg{position:absolute;inset:0;width:100%;height:100%;display:block}",
  ".cmp-box{position:absolute;display:flex;box-sizing:border-box;overflow:hidden;padding:0.4%}",
  ".cmp-txt{display:-webkit-inline-box;-webkit-box-orient:vertical;overflow:hidden;max-width:100%;box-sizing:border-box;line-height:1.15;overflow-wrap:anywhere;word-break:normal;white-space:pre-wrap}",
  ".cmp-cut .cmp-txt{display:inline-block;white-space:nowrap;text-overflow:ellipsis}",
  "@keyframes cmp-fade-in{from{opacity:0}to{opacity:1}}@keyframes cmp-fade-out{from{opacity:1}to{opacity:0}}",
  "@keyframes cmp-pop-in{0%{opacity:0;transform:scale(.6)}70%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}@keyframes cmp-pop-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.6)}}",
  "@keyframes cmp-rise-in{from{opacity:0;transform:translateY(40%)}to{opacity:1;transform:none}}@keyframes cmp-rise-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-40%)}}",
  "@keyframes cmp-drop-in{from{opacity:0;transform:translateY(-40%)}to{opacity:1;transform:none}}@keyframes cmp-drop-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(40%)}}",
  "@keyframes cmp-slideLeft-in{from{opacity:0;transform:translateX(30%)}to{opacity:1;transform:none}}@keyframes cmp-slideLeft-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-30%)}}",
  "@keyframes cmp-slideRight-in{from{opacity:0;transform:translateX(-30%)}to{opacity:1;transform:none}}@keyframes cmp-slideRight-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(30%)}}",
].join("\n");

/** Installs `CuriosaCompose` on a window (the browser's, or a test's). Never throws on bad data: what is wrong is left out. */
export function composeEngine(win: any): void {
  var VERSION = 1;
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var SRC = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$/;
  var VIDEO = /\.(mp4|webm)$/;
  var RATIOS: any = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "21:9": 21 / 9 };
  var ANIMS = ["fade", "pop", "rise", "drop", "slideLeft", "slideRight"];
  var FONTS: any = {
    skin: "inherit",
    system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"',
    "system-serif": 'Georgia,"Times New Roman","Noto Serif",serif,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"',
    "system-rounded": 'ui-rounded,"Arial Rounded MT Bold","Nunito","Varela Round",system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"',
  };
  /** The presets of the appearance kit (appearance.ts PRESET_VALUES): background opacity, outline; the text colour is decided by contrast. A test keeps both equal. */
  var PRESETS: any = { readable: { bg: "solid", opacity: 85, outline: "thin" }, discreet: { bg: "soft", opacity: 55, outline: "thin" }, bare: { bg: "none", opacity: 0, outline: "thick" } };
  var DARK_PANEL = "#14171c", LIGHT_PANEL = "#f7f7f5", FG: any = { light: "#ffffff", dark: "#111111" };
  var OUTLINE_BELOW = 65;

  function num(v: any, lo: number, hi: number, def: number): number { return typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; }
  function hexRgb(h: string): number[] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function lin(v: number): number { var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c: number[]): number { return 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!); }
  function ratio(a: number[], b: number[]): number { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function over(c: number[], a: number, base: number[]): number[] { return [Math.round(c[0]! * a + base[0]! * (1 - a)), Math.round(c[1]! * a + base[1]! * (1 - a)), Math.round(c[2]! * a + base[2]! * (1 - a))]; }
  /** Worst contrast of a text colour over a panel at `alpha`, whatever is behind (white or black). */
  function worst(fg: string, panel: string, alpha: number): number { var f = hexRgb(fg), s = hexRgb(panel); return Math.min(ratio(f, over(s, alpha, [255, 255, 255])), ratio(f, over(s, alpha, [0, 0, 0]))); }
  function rgba(hex: string, alpha: number): string { var c = hexRgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + Math.round(alpha * 100) / 100 + ")"; }
  /** The outline of the kit (appearance.ts outlineShadow), in px of the frame unit `u` (1/1080 of its height, at least 1 px). */
  function outline(kind: string, text: string, u: number): string {
    if (kind !== "thin" && kind !== "thick") return "none";
    var c = text === "light" ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.95)";
    var d = Math.max(1, Math.round((kind === "thick" ? 3 : 2) * u * 10) / 10), blur = Math.max(2, Math.round((kind === "thick" ? 8 : 5) * u * 10) / 10);
    return -d + "px " + -d + "px 0 " + c + "," + d + "px " + -d + "px 0 " + c + "," + -d + "px " + d + "px 0 " + c + "," + d + "px " + d + "px 0 " + c + ",0 0 " + blur + "px " + c;
  }
  /** Which text colour reads best: over a panel by contrast, over nothing light (with its outline). */
  function autoText(panel: string, alpha: number): string { return alpha <= 0 ? "light" : worst(FG.light, panel, alpha) >= worst(FG.dark, panel, alpha) ? "light" : "dark"; }

  /**
   * The look of a box: colour, panel, outline, as CSS values. "element" reads the tokens of the overlay element (`--ov-fg`, `--ov-surface`, `--ov-text-shadow`)
   * with a readable fallback; the others are fixed by the box.
   */
  function lookOf(b: any, u: number): any {
    var explicit = typeof b.color === "string" && HEX.test(b.color) ? b.color : b.resolved === "#ffffff" || b.resolved === "#111111" ? b.resolved : null;
    if (b.look === "element" || !b.look) {
      return { color: explicit || "var(--ov-fg,#ffffff)", background: "var(--ov-surface,transparent)", shadow: b.outline === "none" ? "none" : "var(--ov-text-shadow," + outline(b.outline === "thick" ? "thick" : "thin", explicit && lum(hexRgb(explicit)) < 0.4 ? "dark" : "light", u) + ")", radius: "var(--ov-radius,0.3em)" };
    }
    var panel = DARK_PANEL, alpha = 0, line = b.outline || "thin";
    if (b.look === "custom" && b.pill) { panel = HEX.test(b.pill.color) ? b.pill.color : DARK_PANEL; alpha = num(b.pill.opacity, 0, 100, 85) / 100; }
    else if (PRESETS[b.look]) { alpha = PRESETS[b.look].opacity / 100; line = PRESETS[b.look].outline; }
    var text = explicit ? (lum(hexRgb(explicit)) > 0.4 ? "light" : "dark") : autoText(panel, alpha);
    if (!explicit && alpha > 0 && text === "dark") panel = panel === DARK_PANEL ? LIGHT_PANEL : panel;
    if (line === "none" && alpha * 100 < OUTLINE_BELOW) line = "thin";
    var radius = b.look === "custom" && b.pill ? num(b.pill.radius, 0, 48, 12) * u + "px" : "0.3em";
    return { color: explicit || FG[text], background: alpha > 0 ? rgba(panel, alpha) : "transparent", shadow: outline(line, text, u), radius: radius };
  }

  /**
   * Auto-shrink: the largest size between `min` and `size` (px of a 1080 frame, integers) for which `fits(size)` says yes, found by halving (6 tries at most
   * after the two ends). `overflow`: even `min` does not fit (the text is then cut with "…" at its last line).
   */
  function fitFont(size: number, min: number, fits: (s: number) => boolean): { size: number; overflow: boolean; tries: number } {
    var tries = 1;
    if (fits(size)) return { size: size, overflow: false, tries: tries };
    tries++;
    if (min >= size || !fits(min)) return { size: Math.min(min, size), overflow: true, tries: tries };
    var lo = min, hi = size;
    while (hi - lo > 1 && tries < 8) { var mid = Math.floor((lo + hi) / 2); tries++; if (fits(mid)) lo = mid; else hi = mid; }
    return { size: lo, overflow: false, tries: tries };
  }

  function anim(phase: string, a: any, start: number): string | null {
    if (!a || ANIMS.indexOf(a.anim) < 0) return null;
    return "cmp-" + a.anim + "-" + phase + " " + num(a.dur, 0.1, 2, 0.4) + "s " + (phase === "in" ? "cubic-bezier(.2,.8,.2,1)" : "ease-in") + " " + Math.max(0, start) + "s both";
  }

  /** The frame ratio of a composition (the file's own shape for "media", 16:9 until it is known). */
  function ratioOf(c: any, media: any): number {
    if (RATIOS[c.format]) return RATIOS[c.format];
    return media && media.w > 0 && media.h > 0 ? media.w / media.h : 16 / 9;
  }

  /**
   * Builds the DOM of a resolved composition (texts already filled). `opts.doc`: the document; `opts.motion` false: no entrance or exit; `opts.seconds`: the
   * length of the alert (an exit "at the end" starts then); `opts.still`: no video play (editor). Returns the root, not yet in the page (see `mount`).
   */
  function build(c: any, opts?: any): any {
    opts = opts || {};
    var doc = opts.doc || win.document;
    var root = doc.createElement("div");
    root.setAttribute("data-ov-region", "composition");
    root.setAttribute("role", "img");
    root.className = "cmp";
    if (!c || c.v !== VERSION || !c.backdrop || !SRC.test(String(c.backdrop.src || ""))) return root;
    var bd = c.backdrop, src = String(bd.src), video = VIDEO.test(src);
    var fx = num(bd.focus && bd.focus[0], 0, 100, 50), fy = num(bd.focus && bd.focus[1], 0, 100, 50);
    var bg = doc.createElement(video ? "video" : "img");
    bg.className = "cmp-bg";
    bg.setAttribute("aria-hidden", "true");
    bg.style.objectFit = bd.fit === "contain" ? "contain" : "cover";
    bg.style.objectPosition = fx + "% " + fy + "%";
    if (video) {
      bg.muted = !bd.sound; bg.playsInline = true; bg.loop = bd.play !== "once" && bd.play !== "hold"; bg.preload = "auto";
      if (bd.poster && SRC.test(bd.poster)) bg.poster = bd.poster;
      if (!opts.still) { bg.autoplay = true; }
    } else bg.alt = "";
    bg.src = src;
    root.appendChild(bg);
    root._media = null;
    root._comp = c;
    root._opts = opts;
    var texts: string[] = [];
    var boxes = Array.isArray(c.boxes) ? c.boxes.slice(0, 4) : [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var text = typeof b.text === "string" ? b.text.slice(0, 200) : "";
      if (!text) continue;
      texts.push(text);
      var box = doc.createElement("div");
      box.className = "cmp-box" + (b.fit === "cut" ? " cmp-cut" : "");
      box.setAttribute("data-ov-part", "compose-text");
      box.setAttribute("data-box", String(b.id || i).slice(0, 8));
      var x = num(b.x, 0, 96, 10), y = num(b.y, 0, 96, 70), w = num(b.w, 4, 100 - x, 80), h = num(b.h, 4, 100 - y, 20);
      box.style.left = x + "%"; box.style.top = y + "%"; box.style.width = w + "%"; box.style.height = h + "%";
      var anchor = String(b.anchor || "bc"), v = anchor === "c" ? "m" : anchor.charAt(0), hz = anchor === "c" ? "c" : anchor.charAt(1);
      box.style.alignItems = v === "t" ? "flex-start" : v === "b" ? "flex-end" : "center";
      box.style.justifyContent = hz === "l" ? "flex-start" : hz === "r" ? "flex-end" : "center";
      var span = doc.createElement("span");
      span.className = "cmp-txt";
      span.setAttribute("dir", "auto");
      span.textContent = text;
      span.style.textAlign = b.align === "start" ? "start" : b.align === "end" ? "end" : "center";
      span.style.fontFamily = FONTS[b.font] || FONTS.skin;
      span.style.fontWeight = b.weight === 400 ? "400" : "700";
      if (b.case === "upper") span.style.textTransform = "uppercase";
      box.appendChild(span);
      box._b = b;
      if (opts.motion !== false) {
        var list: string[] = [], a1 = anim("in", b.in, num(b.in && b.in.at, 0, 60, 0));
        if (a1) list.push(a1);
        var outAt = b.out && typeof b.out.at === "number" ? b.out.at : typeof opts.seconds === "number" ? opts.seconds - num(b.out && b.out.dur, 0.1, 2, 0.4) : null;
        var a2 = outAt !== null ? anim("out", b.out, outAt) : null;
        if (a2) list.push(a2);
        if (list.length) box.style.animation = list.join(",");
      }
      root.appendChild(box);
    }
    root.setAttribute("aria-label", texts.join(" · "));
    if (video) {
      bg.addEventListener("loadedmetadata", function () { root._media = { w: bg.videoWidth, h: bg.videoHeight }; layout(root); });
      if (!opts.still && bg.play) { try { var p = bg.play(); if (p && p.catch) p.catch(function () { bg.muted = true; try { bg.play(); } catch { /* not allowed */ } }); } catch { /* not allowed */ } }
    } else bg.addEventListener("load", function () { root._media = { w: bg.naturalWidth, h: bg.naturalHeight }; layout(root); });
    return root;
  }

  /** Sizes the frame inside its container (whole, centred, transparent bands), then fits every text. */
  function layout(root: any): void {
    var host = root.parentNode;
    if (!host || !root._comp) return;
    var W = host.clientWidth, H = host.clientHeight;
    if (!(W > 0 && H > 0)) return;
    var r = ratioOf(root._comp, root._media), w = W, h = W / r;
    if (h > H) { h = H; w = H * r; }
    root.style.width = Math.round(w) + "px"; root.style.height = Math.round(h) + "px";
    root.style.left = Math.round((W - w) / 2) + "px"; root.style.top = Math.round((H - h) / 2) + "px";
    root.setAttribute("data-ratio", String(Math.round(r * 1000) / 1000));
    fitAll(root, h / 1080);
  }

  function fitAll(root: any, u: number): void {
    var boxes = root.querySelectorAll(".cmp-box");
    for (var i = 0; i < boxes.length; i++) fitBox(boxes[i], u);
  }

  function fitBox(box: any, u: number): void {
    var b = box._b, span = box.firstChild;
    if (!b || !span) return;
    var look = lookOf(b, u);
    span.style.color = look.color; span.style.backgroundColor = look.background; span.style.textShadow = look.shadow; span.style.borderRadius = look.radius;
    span.style.padding = look.background === "transparent" ? "0.05em 0.1em" : "0.12em 0.45em";
    var size = Math.round(num(b.size, 24, 220, 56)), min = Math.round(num(b.minSize, 24, size, Math.min(32, size))), lines = Math.round(num(b.maxLines, 1, 4, 2));
    var mode = b.fit === "wrap" || b.fit === "cut" ? b.fit : "shrink";
    var cs = win.getComputedStyle ? win.getComputedStyle(box) : null;
    var padX = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0, padY = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
    var innerW = box.clientWidth - padX, innerH = box.clientHeight - padY;
    function apply(s: number, clamp: boolean) {
      var px = Math.max(1, s * u);
      span.style.fontSize = px + "px";
      span.style.webkitLineClamp = clamp && mode !== "cut" ? String(lines) : "unset";
      return px;
    }
    function fits(s: number): boolean {
      var px = apply(s, false);
      var hgt = span.scrollHeight, wid = span.scrollWidth;
      var pad = span.offsetHeight - span.clientHeight + (look.background === "transparent" ? 0.1 : 0.24) * px;
      var count = Math.round((hgt - pad + 0.0001) / (px * 1.15));
      return hgt <= innerH + 0.5 && wid <= innerW + 0.5 && count <= (mode === "cut" ? 1 : lines);
    }
    var res = mode === "shrink" ? fitFont(size, min, fits) : { size: size, overflow: !fits(size), tries: 1 };
    apply(res.size, true);
    box.setAttribute("data-size", String(res.size));
    if (res.overflow) box.setAttribute("data-overflow", "1"); else box.removeAttribute("data-overflow");
  }

  /** Puts a composition in a container and keeps it sized (the container's size can change: OBS, the editor's zoom). Returns the root. */
  function mount(container: any, c: any, opts?: any): any {
    var root = build(c, opts);
    root.style.position = "absolute";
    container.appendChild(root);
    layout(root);
    var fonts = win.document && win.document.fonts;
    if (fonts && fonts.ready && fonts.ready.then) fonts.ready.then(function () { layout(root); });
    if (typeof win.ResizeObserver === "function") {
      var ro = new win.ResizeObserver(function () { layout(root); });
      ro.observe(container);
      root._ro = ro;
    }
    return root;
  }
  /** Stops a mounted composition: the video is emptied (the decoder is freed) and the observer stops. */
  function unmount(root: any): void {
    if (!root) return;
    if (root._ro) { try { root._ro.disconnect(); } catch { /* gone */ } }
    var v = root.querySelector && root.querySelector("video");
    if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* gone */ } }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  win.CuriosaCompose = { version: VERSION, build: build, mount: mount, unmount: unmount, layout: layout, fitFont: fitFont, lookOf: lookOf, worst: worst, ratioOf: ratioOf, presets: PRESETS, outline: outline };
}

/** The engine as page script text (what a module adds to its overlay page script). Idempotent: a page that has it already keeps the first one. */
export function composeScript(): string {
  return `if(!window.CuriosaCompose){(${composeEngine.toString()})(window);}`;
}
