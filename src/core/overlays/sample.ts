import type { Translator } from "../i18n/dictionary";
import { esc, pageHeaders } from "./render";
import type { SkinPayload } from "./skinSheet";
import { tokensCss } from "./tokens";
import { DEFAULT_STYLE } from "./model";

/**
 * SAMPLE PAGE OF AN OVERLAY SKIN (core 0.8.0): a fixed 640 x 360 scene with the reserved parts every element can use (panel, title, name, badge, bar…), drawn the way a
 * module element draws them (tokens with fallbacks, `data-ov-part` attributes), over a busy background that stands for the stream. Used by the skin gallery, the rule dialog
 * and the screenshots; it carries no real data. `payload = null` shows the common style. Pure.
 */
const SCENE_CSS = `html,body{margin:0;width:640px;height:360px;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif;color-scheme:normal}
body{position:relative;background:linear-gradient(135deg,#1d2b53 0%,#7e2553 38%,#ab5236 62%,#2b3a2e 100%)}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 78% 24%,rgba(255,236,39,.55),transparent 22%),repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0 14px,transparent 14px 38px)}
.s{position:absolute;box-sizing:border-box;padding:.7em .95em;color:var(--ov-fg,#fff);background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px);font-size:15px;line-height:1.35}
.s p{margin:0}
.a{left:24px;top:22px;width:300px}.b{left:24px;top:176px;width:300px}.c{right:24px;bottom:24px;width:250px;text-align:center}
.row{display:flex;gap:10px;align-items:center}.av{width:38px;height:38px;border-radius:50%;background:var(--ov-accent,#e8a23b);flex:none}
.t{font-weight:700;font-size:1.1em}.m{opacity:.85;font-size:.88em}.tk{margin-top:.55em;height:10px;border-radius:6px;background:rgba(255,255,255,.22);overflow:hidden}.bf{height:100%;width:64%;background:var(--ov-accent,#e8a23b)}
.bd{display:inline-block;margin-top:.5em;padding:.1em .6em;border-radius:99px;background:var(--ov-accent,#e8a23b);color:var(--ov-accent-fg,#111);font-size:.8em;font-weight:700}
.v{font-size:2em;font-weight:800;line-height:1.1}`;

export function renderSample(payload: SkinPayload | null, t: Translator, lang: string, nonce: string): string {
  const attrs = payload ? ` data-ov-skin="${esc(payload.id)}"` : "";
  const css = `${SCENE_CSS}${payload ? "" : tokensCss({ ...DEFAULT_STYLE, background: "soft" })}\n${payload?.css ?? ""}`;
  const body = `<div class="s a" data-ov-part="panel"><div class="row"><span class="av" data-ov-part="avatar"></span><div><p class="t" data-ov-part="title">${esc(t("ovp.sample.title"))}</p><p class="m" data-ov-part="subtitle">${esc(t("ovp.sample.subtitle"))}</p></div></div><div class="tk" data-ov-part="track"><div class="bf" data-ov-part="bar-fill"></div></div><span class="bd" data-ov-part="badge">${esc(t("ovp.sample.badge"))}</span></div>`
    + `<div class="s b" data-ov-part="bubble"><p data-ov-part="body">${esc(t("ovp.sample.message"))}</p><p class="m" data-ov-part="name">${esc(t("ovp.sample.name"))}</p></div>`
    + `<div class="s c" data-ov-part="card"><p class="m" data-ov-part="label">${esc(t("ovp.sample.label"))}</p><p class="v" data-ov-part="value">1 284</p></div>`;
  return `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"${attrs}><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(t("ovp.sample.title"))}</title><style nonce="${nonce}">${css}</style></head><body>${body}</body></html>`;
}

export function sampleHeaders(nonce: string): Record<string, string> {
  return pageHeaders(`default-src 'none'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'`);
}
