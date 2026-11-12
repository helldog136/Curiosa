import type { Translator } from "../i18n/dictionary";
import { esc, pageHeaders } from "./render";
import type { SkinPayload } from "./skinSheet";
import { tokensCss } from "./tokens";
import { DEFAULT_STYLE } from "./model";

/**
 * SAMPLE SCENE OF AN OVERLAY SKIN (core 0.8.0, richer and animated in 0.9.0): a fixed 640 x 360 scene with five kinds of element drawn the way module elements draw
 * them (tokens with fallbacks, `data-ov-part` attributes): an ALERT (panel), a COUNTER and a FEATURED CARD (cards), a LIST (panel with rows) and a BANNER (bubble),
 * over a busy background that stands for the stream. Used by the skin gallery, the rule dialog and the preview images; it carries no real data.
 *
 * A short scripted scenario of sample events loops (alert in and out, counter tick, new row, featured card changes, banner changes), which shows the skin's entrance and
 * idle motion. It only runs when the parent page says so (message `{ ov: "play" | "pause" }`, sent while the card is on screen) and never when the person prefers
 * reduced motion: the scene then stays on its still frame. The script is the core's own, nonce-protected, and the page is shown in a sandbox without same-origin.
 * `payload = null` shows the common style. Pure.
 */
const SCENE_CSS = `html,body{margin:0;width:640px;height:360px;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif;color-scheme:normal}
body{position:relative;background:linear-gradient(135deg,#1d2b53 0%,#7e2553 38%,#ab5236 62%,#2b3a2e 100%)}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 78% 24%,rgba(255,236,39,.5),transparent 22%),repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0 14px,transparent 14px 38px)}
.s{position:absolute;box-sizing:border-box;padding:.55em .8em;color:var(--ov-fg,#fff);background:var(--ov-surface,transparent);border:1px solid var(--ov-border,transparent);border-radius:var(--ov-radius,12px);font-size:13px;line-height:1.3}
.s p{margin:0}.s ul{list-style:none;margin:0;padding:0}
.a{left:22px;top:16px;width:292px}.c{right:22px;top:16px;width:150px;text-align:center}.f{right:22px;top:112px;width:268px}.l{left:22px;top:116px;width:292px}.b{left:22px;right:22px;bottom:16px;height:62px}
.row{display:flex;gap:10px;align-items:center}.av{width:34px;height:34px;border-radius:50%;background:var(--ov-accent,#e8a23b);flex:none}
.t{font-weight:700;font-size:1.08em}.m{opacity:.85;font-size:.88em}.tk{margin-top:.45em;height:9px;border-radius:5px;background:rgba(255,255,255,.22);overflow:hidden}.bf{height:100%;width:64%;background:var(--ov-accent,#e8a23b)}
.bd{display:inline-block;margin-top:.4em;padding:.1em .6em;border-radius:99px;background:var(--ov-accent,#e8a23b);color:var(--ov-accent-fg,#111);font-size:.78em;font-weight:700}
.v{font-size:2em;font-weight:800;line-height:1.05}.li{display:flex;justify-content:space-between;gap:8px;padding:.18em 0}
.pop{animation:ovs-pop .5s ease-out}@keyframes ovs-pop{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}
[hidden]{display:none!important}`;

const SCRIPT = `(function(){var rm=matchMedia("(prefers-reduced-motion: reduce)").matches;if(rm)return;
var q=function(s){return document.querySelector(s)},on=false,timers=[],loop=0;
var alertEl=q('[data-s="alert"]'),val=q('[data-s="value"]'),row4=q('[data-s="row4"]'),feat=q('[data-s="feat"]'),fn=q('[data-s="fname"]'),bt=q('[data-s="btext"]'),ban=q('[data-s="banner"]');
var T=JSON.parse(document.getElementById("ovs-t").textContent);
function restart(el){el.hidden=true;void el.offsetWidth;el.hidden=false}
function step(i){var n=i%2;
 timers.push(setTimeout(function(){restart(alertEl);bt.textContent=T.b[0];val.textContent=T.n[0]},0));
 timers.push(setTimeout(function(){val.textContent=T.n[1];val.classList.remove("pop");void val.offsetWidth;val.classList.add("pop")},2400));
 timers.push(setTimeout(function(){restart(row4)},3400));
 timers.push(setTimeout(function(){fn.textContent=T.f[n];restart(feat)},4800));
 timers.push(setTimeout(function(){bt.textContent=T.b[1];restart(ban)},6200));
 timers.push(setTimeout(function(){alertEl.hidden=true;row4.hidden=true},8000));
 timers.push(setTimeout(function(){if(on)step(i+1)},9000));}
function play(){if(on)return;on=true;step(loop++)}
function pause(){on=false;timers.forEach(clearTimeout);timers=[];alertEl.hidden=false;row4.hidden=true;val.textContent=T.n[0];bt.textContent=T.b[0]}
addEventListener("message",function(e){var d=e.data;if(!d||typeof d!=="object")return;if(d.ov==="play")play();else if(d.ov==="pause")pause()});
if(location.search.indexOf("autoplay=1")>=0)play();
})();`;

export function renderSample(payload: SkinPayload | null, t: Translator, lang: string, nonce: string): string {
  const attrs = payload ? ` data-ov-skin="${esc(payload.id)}"` : "";
  const css = `${SCENE_CSS}${payload ? "" : tokensCss({ ...DEFAULT_STYLE, background: "soft" })}\n${payload?.css ?? ""}`;
  const texts = { b: [t("ovp.sample.message"), t("ovp.sample.message2")], n: ["1 284", "1 285"], f: [t("ovp.sample.featured"), t("ovp.sample.featured2")] };
  const body = `<div class="s a" data-s="alert" data-ov-part="panel"><div class="row"><span class="av" data-ov-part="avatar"></span><div><p class="t" data-ov-part="title">${esc(t("ovp.sample.title"))}</p><p class="m" data-ov-part="subtitle">${esc(t("ovp.sample.subtitle"))}</p></div></div><div class="tk" data-ov-part="track"><div class="bf" data-ov-part="bar-fill"></div></div><span class="bd" data-ov-part="badge">${esc(t("ovp.sample.badge"))}</span></div>`
    + `<div class="s c" data-ov-part="card"><p class="m" data-ov-part="label">${esc(t("ovp.sample.label"))}</p><p class="v" data-s="value" data-ov-part="value">1 284</p></div>`
    + `<div class="s l" data-ov-part="panel"><p class="t" data-ov-part="title">${esc(t("ovp.sample.listTitle"))}</p><ul data-ov-part="list"><li class="li"><span data-ov-part="name">${esc(t("ovp.sample.row1"))}</span><span data-ov-part="value">42</span></li><li class="li"><span data-ov-part="name">${esc(t("ovp.sample.row2"))}</span><span data-ov-part="value">31</span></li><li class="li"><span data-ov-part="name">${esc(t("ovp.sample.row3"))}</span><span data-ov-part="value">17</span></li><li class="li" data-s="row4" hidden><span data-ov-part="name">${esc(t("ovp.sample.row4"))}</span><span data-ov-part="value">9</span></li></ul></div>`
    + `<div class="s f" data-s="feat" data-ov-part="card"><div class="row"><span class="av" data-ov-part="avatar"></span><div><p class="t" data-s="fname" data-ov-part="name">${esc(texts.f[0])}</p><p class="m" data-ov-part="label">${esc(t("ovp.sample.featuredLabel"))}</p></div></div><span class="bd" data-ov-part="badge">${esc(t("ovp.sample.live"))}</span></div>`
    + `<div class="s b" data-s="banner" data-ov-part="bubble"><p class="t" data-ov-part="title">${esc(t("ovp.sample.bannerTitle"))}</p><p data-s="btext" data-ov-part="body">${esc(texts.b[0])}</p></div>`;
  const data = JSON.stringify(texts).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="${esc(lang)}" data-ov-region="element"${attrs}><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(t("ovp.sample.title"))}</title><style nonce="${nonce}">${css}</style></head><body>${body}<script type="application/json" id="ovs-t">${data}</script><script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

export function sampleHeaders(nonce: string): Record<string, string> {
  return pageHeaders(`default-src 'none'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'`);
}
