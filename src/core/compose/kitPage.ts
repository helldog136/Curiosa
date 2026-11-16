/**
 * THE RENDER KIT (core 0.25.0): a self-contained HTML page that draws one composition with the SAME engine as OBS (render.ts), for the assistant to open in
 * its OWN browser (nothing runs on the site). Exact at the engine level: the texts are fitted by the browser that shows them, the video plays.
 *
 *  - The files are read from the site itself (`<base href>` = the site's address; the page's own files are public already).
 *  - `#t=2.5` in the address freezes the alert at 2.5 s (video and entrances), for a screenshot of a given moment; without it the alert plays.
 *  - When it is ready, `<html data-ready="1">` (and `data-ready="error"` when the backdrop cannot load), so a headless browser knows when to look.
 *  - No secret, no token, no script from elsewhere; the data is embedded as JSON with `<` escaped.
 *  - "The element's font" is the system sans-serif, as on the alerts page without a skin font.
 */
import { COMPOSE_CSS, composeScript } from "./render";
import type { ResolvedComposition } from "./model";
import { FORMAT_RATIO } from "./model";

export type KitOptions = { siteUrl: string; width?: number; height?: number; background?: "checker" | "dark" | "light" | "transparent"; seconds?: number; title?: string; media?: { width: number; height: number } | null };

const BACKGROUNDS = {
  checker: "background-color:#fff;background-image:linear-gradient(45deg,#d6d6d6 25%,transparent 25%),linear-gradient(-45deg,#d6d6d6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d6d6d6 75%),linear-gradient(-45deg,transparent 75%,#d6d6d6 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0",
  dark: "background:#16181d", light: "background:#f4f4f2", transparent: "background:transparent",
} as const;
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderKitPage(c: ResolvedComposition, opts: KitOptions): string {
  let base: string;
  try { const u = new URL(opts.siteUrl); if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("x"); base = `${u.origin}/`; } catch { throw new Error("renderKitPage: siteUrl must be an http(s) address"); }
  const ratio = c.format !== "media" ? FORMAT_RATIO[c.format] : opts.media && opts.media.width > 0 && opts.media.height > 0 ? opts.media.width / opts.media.height : 16 / 9;
  const width = Math.min(3840, Math.max(160, Math.round(opts.width ?? 1280)));
  const height = Math.min(2160, Math.max(90, Math.round(opts.height ?? width / ratio)));
  const seconds = Math.min(60, Math.max(2, Math.round(opts.seconds ?? c.duration?.seconds ?? 6)));
  const data = JSON.stringify(c).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");
  const bg = BACKGROUNDS[opts.background ?? "checker"] ?? BACKGROUNDS.checker;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><base href="${escHtml(base)}"><title>${escHtml(opts.title ?? "Composition")}</title>
<meta name="viewport" content="width=${width}">
<style>html,body{margin:0;background:transparent;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;${bg}}
${COMPOSE_CSS}</style></head>
<body><div id="stage"></div>
<script>${composeScript()}
(function(){var c=${data},stage=document.getElementById("stage"),html=document.documentElement;
var root=window.CuriosaCompose.mount(stage,c,{seconds:${seconds}});
var m=/[#&]t=([0-9]+(?:\\.[0-9]+)?)/.exec(location.hash),t=m?Math.min(60,parseFloat(m[1])):null;
var v=root.querySelector("video"),done=false;
function anims(){(document.getAnimations?document.getAnimations():[]).forEach(function(a){try{a.pause();a.currentTime=t*1000}catch(e){}})}
function ready(){if(done)return;done=true;setTimeout(function(){html.setAttribute("data-ready","1")},50)}
function freeze(){if(t===null)return ready();anims();if(!v)return ready();
  v.autoplay=false;v.addEventListener("play",function(){v.pause()});try{v.pause()}catch(e){}
  v.addEventListener("seeked",function(){anims();ready()},{once:true});try{v.currentTime=Math.min(t,(v.duration||t))}catch(e){ready()}}
function fail(){html.setAttribute("data-ready","error")}
if(v){if(v.readyState>=2)freeze();else{v.addEventListener("loadeddata",freeze,{once:true});v.addEventListener("error",fail,{once:true})}}
else{var img=root.querySelector("img");if(!img||img.complete)freeze();else{img.addEventListener("load",freeze,{once:true});img.addEventListener("error",fail,{once:true})}}})();
</script></body></html>
`;
}
