// Requirements on the OVERLAY PAGE ELEMENTS of a module (`overlayElements` of module.json, docs/OVERLAY-ELEMENTS.md). Without elements, everything is "not applicable".
// (core 0.24.0) Two advice rules join the mandatory one: "invisible at rest" (it lived only in the modules repository) and "readable" (the tokens of the look
// reach every part). Advice only: a module is never refused for them, the report says what to change.
import { makeCtx } from "../probes.mjs";
import { HOSTILE } from "../probes.mjs";
import { loadCore } from "../core.mjs";
import { fakeCtx } from "../fakeCtx.mjs";

/** An option value from its declaration (default, or a hostile / extreme value). */
function optionValues(options, mode) {
  return Object.fromEntries((options ?? []).map((o) => {
    if (mode === "defaults") {
      if (o.type === "boolean") return [o.id, o.default ?? false];
      if (o.type === "number") return [o.id, o.default ?? o.min ?? 0];
      if (o.type === "choice") return [o.id, o.default ?? o.choices[0].value];
      return [o.id, o.default ?? ""];
    }
    if (o.type === "text") return [o.id, HOSTILE.slice(0, o.maxLength ?? 200)];
    if (o.type === "number") return [o.id, o.max ?? 1e9];
    if (o.type === "boolean") return [o.id, true];
    return [o.id, o.choices[o.choices.length - 1].value];
  }));
}

const sizeOf = (d) => (d.fit === "scale" ? d.size : { width: Math.round((d.referenceHeight ?? 1080) * (d.ratios ? (d.ratios.min + d.ratios.max) / 2 : 1.78)), height: d.referenceHeight ?? 720 });

/** The page of an element when nothing happens: a context with no data at all (no topic, no entry, no row), the address the module answers, then its route or its overlay. */
export async function idlePage(m, d) {
  const manifest = m.parsed.manifest;
  const ctx = fakeCtx({ moduleId: manifest.id, key: "probe", basePath: "probe", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: m.locales.fr ?? m.locales.en ?? {}, permissions: manifest.permissions ?? [], settings: {} });
  const size = sizeOf(d);
  const style = d.followsStyle === false ? null : { text: "light", surface: "transparent", corners: "round" };
  const answer = await m.definition.overlayElements[d.id](ctx, { element: d.id, fit: d.fit, width: size.width, height: size.height, style, options: optionValues(d.options, "defaults"), lang: "fr" });
  if (!answer?.url) return null;
  // The address exactly as the core builds it for a page (ov-w, ov-h, ov-fit, ov-lang, the style, ov-tv, the options).
  const { parseAddress, finalAddress } = await import("@/core/overlays/address");
  const base = parseAddress(answer);
  if (!base) return null;
  const decl = { ...d, followsStyle: d.followsStyle !== false };
  const full = finalAddress(base, { decl, layout: { iframeW: size.width, iframeH: size.height }, style: { text: "light", background: "transparent", corners: "round" }, options: optionValues(d.options, "defaults"), lang: "fr", tv: 1 });
  const url = new URL(full, "https://site.test");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "m" && parts[1] === "probe") {
    const { matchModuleRoute } = await import("@/core/modules/pageMeta");
    const hit = matchModuleRoute(m.definition.routes, parts.slice(2));
    if (!hit) return null;
    const res = await hit.handler(new Request(url), Object.assign(ctx, { params: hit.params }));
    return res instanceof Response ? res.text() : null;
  }
  if (parts[0] === "overlays" && typeof m.definition.overlay === "function") {
    const o = await m.definition.overlay(ctx, { query: url.searchParams });
    return o ? `<style>${o.css ?? ""}</style>${o.html ?? ""}<script>${o.script ?? ""}</script>` : null;
  }
  return null;
}
/** What a person could read in a page: no style, no script, no tag. */
const visibleText = (html) => String(html).replace(/<head[\s\S]*?<\/head>/g, "").replace(/<title[\s\S]*?<\/title>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<template[\s\S]*?<\/template>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*\bhidden\b[^>]*>[\s\S]*?<\/[a-z]+>/g, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
let chromium;
async function browser() {
  if (chromium !== undefined) return chromium;
  try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); const pw = lib.loadPlaywright(); chromium = await pw.chromium.launch({ executablePath: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }); } catch { chromium = null; }
  return chromium;
}
/** Every node that paints something after the page script ran (background, border, shadow or text), in a real Chromium; null without one. */
export async function paintedAtRest(html, size = { width: 900, height: 300 }) {
  const b = await browser();
  if (!b) return null;
  const page = await b.newPage({ viewport: { width: Math.min(1920, size.width), height: Math.min(1080, size.height) } });
  try {
    await page.route("**/*", (r) => r.fulfill({ status: 404, body: "" }));
    await page.setContent(html, { waitUntil: "load", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    return await page.evaluate(() => [...document.querySelectorAll("body, body *")].filter((n) => {
      const s = getComputedStyle(n), r = n.getBoundingClientRect();
      if (s.display === "none" || s.visibility === "hidden" || r.width === 0 || r.height === 0) return false;
      for (let x = n; x && x.nodeType === 1; x = x.parentElement) if (getComputedStyle(x).opacity === "0") return false;
      const bg = s.backgroundColor;
      return (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && n !== document.body) || (parseFloat(s.borderTopWidth) > 0 && s.borderTopColor !== "rgba(0, 0, 0, 0)") || s.boxShadow !== "none" || [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    }).map((n) => n.id ? `#${n.id}` : n.getAttribute("data-ov-part") ? `[data-ov-part="${n.getAttribute("data-ov-part")}"]` : n.tagName.toLowerCase()).slice(0, 6));
  } finally { await page.close(); }
}
export async function closeBrowser() { if (chromium) await chromium.close(); chromium = undefined; }

const requirements = [
  {
    id: "overlay.elements", level: "mandatory", group: "overlay",
    title: "Declared overlay elements are served, with valid addresses",
    what: "Every element of `overlayElements` (module.json) has its function in `overlayElements` of the code, and the reverse; every function answers a site address (a path starting with `/`, never an external address) or null, even with extreme or hostile options.",
    why: "The core asks your module, on the server, for the address of each element. An external or malformed address is refused (an empty frame in OBS); a function that throws on an unexpected option makes the element disappear from the stream.",
    fix: "Declare each element on both sides with the same id. Answer { url: `/m/${ctx.instance.key}/…` }; validate the options you receive (ignore unknown ones); answer null when the element is not available.",
    async run(m) {
      const decls = m.parsed?.ok ? m.parsed.manifest.overlayElements : m.manifest?.overlayElements;
      const fns = m.definition?.overlayElements;
      if (!decls?.length && !fns) return { na: "the module offers no overlay page element" };
      if (!m.parsed?.ok) return { skip: "invalid module.json" };
      const out = [];
      const ids = new Set((decls ?? []).map((d) => d.id));
      for (const d of decls ?? []) if (typeof fns?.[d.id] !== "function") out.push(`element "${d.id}" is declared in module.json but the code has no function overlayElements.${d.id}`);
      for (const k of Object.keys(fns ?? {})) if (!ids.has(k)) out.push(`the code serves element "${k}", which is not declared in "overlayElements" of module.json`);
      await loadCore();
      const { parseAddress } = await import("@/core/overlays/address");
      for (const d of decls ?? []) {
        const fn = fns?.[d.id];
        if (typeof fn !== "function") continue;
        for (const mode of ["defaults", "hostile"]) {
          const ctx = makeCtx(m, { mode: "filled", locale: "fr" });
          const size = sizeOf(d);
          const request = { element: d.id, fit: d.fit, width: size.width, height: size.height, style: d.followsStyle === false ? null : { text: "light", surface: "transparent", corners: "round" }, options: optionValues(d.options, mode), lang: "fr" };
          try {
            const answer = await Promise.race([fn(ctx, request), new Promise((_, rej) => setTimeout(() => rej(new Error("too slow (more than 8 s)")), 8000).unref())]);
            if (answer === null) continue;
            if (!answer || typeof answer.url !== "string") { out.push(`element "${d.id}" answers neither null nor { url }`); continue; }
            if (parseAddress && !parseAddress(answer)) out.push(`element "${d.id}" answers an address the core refuses ("${String(answer.url).slice(0, 60)}"): a site path, without spaces or "..", is expected`);
          } catch (e) { out.push(`element "${d.id}" throws with ${mode === "hostile" ? "extreme or hostile" : "default"} options: ${String(e?.message ?? e).slice(0, 100)}`); }
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "overlay.idle", level: "advice", group: "overlay",
    title: "An element with nothing to say is invisible on stream",
    what: "Rendered with no data at all (no draw, no poll, no event, nothing planned), each element's page shows nothing: no title, no \"no data\" text, no empty box with a background, a border or a shadow. Checked in a real Chromium when one is installed, else on the page text.",
    why: "An overlay element sits on top of a game all stream long. A box or a \"Nothing yet\" text at rest hides the game and looks broken; the core never paints the frame around your element, so only your page decides.",
    fix: "Start the panel `hidden` (or `display:none`) and show it when there is something to show; write no placeholder text. A scene that always plays (a generative animation) can ignore this advice.",
    async run(m) {
      const decls = m.parsed?.ok ? m.parsed.manifest.overlayElements : null;
      if (!decls?.length) return { na: "the module offers no overlay page element" };
      await loadCore();
      const out = [];
      for (const d of decls) {
        if (typeof m.definition?.overlayElements?.[d.id] !== "function") continue;
        let html;
        try { html = await Promise.race([idlePage(m, d), new Promise((_, rej) => setTimeout(() => rej(new Error("too slow")), 8000).unref())]); } catch { continue; }
        if (typeof html !== "string") continue;
        const painted = await paintedAtRest(html, sizeOf(d)).catch(() => null);
        if (painted && painted.length) out.push(`element "${d.id}" paints something at rest: ${painted.join(", ")}`);
        else if (painted === null) { const text = visibleText(html); if (text) out.push(`element "${d.id}" shows text at rest: "${text.slice(0, 60)}"`); }
      }
      await closeBrowser();
      return out;
    },
  },
  {
    id: "overlay.readable", level: "advice", group: "overlay",
    title: "The look of the page reaches every part of the element",
    what: "An element that follows the common style reads `--ov-fg` and `--ov-surface` (with a fallback), marks its parts with `data-ov-part`, and declares its own `--ov-*` tokens only on `:root` or on the `data-ov-region=\"element\"` node, never inline on another node.",
    why: "A skin, the \"Opaque\" background and the readability default of a page reach `:root` and the element node. A token written inline on an inner node (the 0.16.0 alerts bug) hides them from everything inside: white text with no background over a bright game.",
    fix: "Use `ctx.overlay.tokens(query)` (core 0.24.0) for the `:root` rule, or put your tokens on `[data-ov-region=\"element\"]`; draw backgrounds with `var(--ov-surface, …)` and text with `var(--ov-fg, …)` on parts named `panel`, `card`, `title`, `text`…",
    async run(m) {
      const decls = (m.parsed?.ok ? m.parsed.manifest.overlayElements : null)?.filter((d) => d.followsStyle !== false);
      if (!decls?.length) return { na: "no overlay element follows the common style" };
      await loadCore();
      const out = [];
      for (const d of decls) {
        if (typeof m.definition?.overlayElements?.[d.id] !== "function") continue;
        let html;
        try { html = await Promise.race([idlePage(m, d), new Promise((_, rej) => setTimeout(() => rej(new Error("too slow")), 8000).unref())]); } catch { continue; }
        if (typeof html !== "string") continue;
        out.push(...readabilityProblems(html).map((p) => `element "${d.id}": ${p}`));
      }
      return out;
    },
  },
];

/** Static checks of an element page against the look of the core (exported for tests). */
export function readabilityProblems(html) {
  const out = [];
  const code = String(html);
  if (!/var\(\s*--ov-fg\b/.test(code)) out.push("its text never reads var(--ov-fg): a skin or the readability default cannot set the text colour");
  if (!/var\(\s*--ov-surface\b/.test(code)) out.push("its panels never read var(--ov-surface): a skin or the readability default cannot give them a background");
  if (!/data-ov-part=/.test(code)) out.push("no part is marked with data-ov-part: the core cannot reach the panel and the texts");
  for (const tag of code.match(/<(?!html\b)[a-z][a-z0-9-]*\b[^>]*\bstyle="[^"]*--ov-[^"]*"[^>]*>/gi) ?? []) {
    if (/data-ov-region="element"/.test(tag)) continue;
    out.push(`a --ov-* token is written inline on <${tag.slice(1, 40).split(/\s/)[0]}>: everything inside misses the skin and the page look`);
    break;
  }
  return out;
}

export default requirements;
