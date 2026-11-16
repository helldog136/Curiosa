import type { Translator } from "../i18n/dictionary";
import type { ResolvedElement } from "./resolve";
import type { OverlayPageData } from "./model";
import { OV_PARTS, ownerSurfaceCss, tokensCss } from "./tokens";
import type { LoadedPayload } from "./skinLoad";
import { appliedLook, lookCss } from "./appearance";

/**
 * PAGE PUBLIQUE d'une page d'overlay (`/overlays/page/<secret>`), fabriquée ici en texte : une page nue, transparente, sans le moindre habillage du site, sans cookie,
 * sans suivi, sans chargement tiers. Chaque élément est un iframe isolé (sandbox) ; le cadre de test est dessiné PAR LE CŒUR autour de chaque élément et montré
 * seulement en mode test. Aucun skin de site n'est chargé : l'apparence passe par les jetons `--ov-*` et les attributs `data-ov-part` / `data-ov-region` (tokens.ts).
 * Pur : testé sans serveur.
 */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sandbox des iframes : scripts et même origine (les éléments appellent les routes de leur module), rien d'autre (ni formulaire, ni fenêtre, ni navigation du haut, ni téléchargement). */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin";

/** Sources autorisées pour les iframes : les adresses exactes (chemin) des éléments de la page, sur l'hôte demandé ; à défaut d'hôte sûr, le site lui-même. */
export function frameSources(host: string | null, paths: readonly string[]): string {
  const safe = host && /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(host) ? host : null;
  const unique = [...new Set(paths)];
  if (unique.length === 0) return "'none'";
  return safe ? unique.map((p) => `${safe}${p}`).join(" ") : "'self'";
}

export function contentSecurityPolicy(nonce: string, frames: string): string {
  return [
    "default-src 'none'", `frame-src ${frames}`, `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "style-src-attr 'unsafe-inline'", "connect-src 'self'",
    "base-uri 'none'", "form-action 'none'", "object-src 'none'", "img-src 'none'", "font-src 'none'", "frame-ancestors 'self'",
  ].join("; ");
}

/** En-têtes de la page de rendu : jamais de cookie ni de cache, l'adresse secrète ne fuit pas par « Referer », rien n'est indexé. */
export function pageHeaders(csp: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff", "Cross-Origin-Opener-Policy": "same-origin",
  };
}

const BASE_CSS = `html,body{margin:0;padding:0;background:transparent;overflow:hidden;color-scheme:normal}
.stage{position:relative;overflow:hidden;transform-origin:0 0}
.el{position:absolute;overflow:hidden;background:transparent}
.el iframe{position:absolute;border:0;background:transparent;transform-origin:0 0}
.tf{display:none;position:absolute;inset:0;box-sizing:border-box;pointer-events:none;border:3px solid var(--tc);background:color-mix(in srgb,var(--tc) 10%,transparent);z-index:2}
html[data-test="1"] .tf{display:block}
.tf .lb{position:absolute;left:0;top:0;max-width:100%;box-sizing:border-box;padding:3px 8px;font:600 16px/1.3 system-ui,sans-serif;background:var(--tc);color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tf .lb em{font-style:normal;font-weight:500}
.off{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;font:600 28px/1.3 system-ui,sans-serif;color:var(--ov-fg);text-shadow:0 1px 6px rgba(0,0,0,.6)}`;

const POLL_SCRIPT = `(function(){var C=window.__ov,d=document.documentElement,rev=C.rev,act=C.active,n=0,gap=5000,timer=0;
var S=C.skin||{key:"",id:"",css:""},pend="",pn=0,SH=new WeakMap(),rm=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
function applyFrame(f){if(f.getAttribute("data-follows")!=="1")return;try{var doc=f.contentDocument,w=f.contentWindow;if(!doc||!w||!doc.documentElement)return;var old=SH.get(f),el=doc.documentElement;
if(S.css&&w.CSSStyleSheet&&doc.adoptedStyleSheets!==undefined){var ns=new w.CSSStyleSheet();ns.replaceSync(S.css);doc.adoptedStyleSheets=doc.adoptedStyleSheets.filter(function(x){return x!==old}).concat([ns]);SH.set(f,ns);el.setAttribute("data-ov-skin",S.id)}
else{if(old)doc.adoptedStyleSheets=doc.adoptedStyleSheets.filter(function(x){return x!==old});SH.delete(f);el.removeAttribute("data-ov-skin")}}catch(e){}
f.style.opacity="1"}
function applyAll(){var f=document.querySelectorAll("iframe[data-follows]");for(var i=0;i<f.length;i++)applyFrame(f[i])}
function swap(next){var st=document.querySelector(".stage");function go(){S=next;applyAll();if(st&&!rm)st.style.opacity="1"}
if(st&&!rm){st.style.transition="opacity .25s";st.style.opacity="0";setTimeout(go,270)}else go()}
(function(){var f=document.querySelectorAll("iframe[data-follows]");for(var i=0;i<f.length;i++){(function(fr){fr.addEventListener("load",function(){applyFrame(fr)});try{if(fr.contentDocument&&fr.contentDocument.readyState==="complete"&&fr.contentDocument.location.href!=="about:blank")applyFrame(fr)}catch(e){}})(f[i])}})();
function frames(on){var f=document.querySelectorAll('iframe[data-demo]');for(var i=0;i<f.length;i++){var u=on?f[i].getAttribute('data-demo'):f[i].getAttribute('data-live');if(f[i].getAttribute('src')!==u)f[i].setAttribute('src',u)}}
function test(on,left){if(on)d.setAttribute('data-test','1');else d.removeAttribute('data-test');frames(on);clearTimeout(timer);if(on&&left>0)timer=setTimeout(function(){test(false,0)},left+50)}
function next(changed){n=changed?0:n+1;gap=C.ctx?5000:n<6?5000:n<12?10000:15000}
function tick(){var u=C.state+(C.state.indexOf("?")<0?"?":"&")+"skin="+encodeURIComponent(S.key);fetch(u,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'}).then(function(r){return r.ok?r.json():null}).then(function(s){
if(!s){gap=Math.min(gap*2,15000);return}
if(s.rev!==rev||s.active!==act){location.reload();return}
var k=s.skin&&s.skin.key||"";if(k===S.key){pend="";pn=0}else{if(pend===k)pn++;else{pend=k;pn=1}if(pn>=2&&(!k||s.skin.css)){swap({key:k,id:s.skin.id||"",css:s.skin.css||""});pend="";pn=0}}
var was=d.getAttribute('data-test')==='1';if(s.test!==was)next(true);else next(false);
test(s.test,s.test?s.until-s.now:0)}).catch(function(){gap=Math.min(gap*2,15000)}).then(function(){setTimeout(tick,gap)})}
if(C.fit){var f=function(){var s=Math.min(innerWidth/C.w,innerHeight/C.h),st=document.querySelector('.stage');if(st)st.style.transform='scale('+s+')'};f();addEventListener('resize',f)}
if(C.test&&C.left>0)timer=setTimeout(function(){test(false,0)},C.left+50);
if(C.state)setTimeout(tick,gap)})();`;

/**
 * (0.21.0) Skin per element: the frames that wear their own skin (or none) carry `data-eskin="<n>"`; `applyFrame` gives them `C.es[n]` instead of the page's
 * skin, so a skin change of the page (per context) leaves them as they are. Emitted only when an element has its own skin: other pages are unchanged byte for byte.
 */
export const pollScript = (elementSkins: boolean): string => elementSkins
  ? POLL_SCRIPT.replace('if(S.css&&w.CSSStyleSheet', 'var X=f.getAttribute("data-eskin"),Q=X===null?S:(C.es[+X]||{id:"",css:""});if(Q.css&&w.CSSStyleSheet').replace("ns.replaceSync(S.css)", "ns.replaceSync(Q.css)").replace('el.setAttribute("data-ov-skin",S.id)', 'el.setAttribute("data-ov-skin",Q.id)')
  : POLL_SCRIPT;

/** (0.11.0) Opaque background: adopts the solid panel colour into each element that follows the style (only on an opaque page, so other pages are unchanged byte for byte). A skin brings its own solid colour instead. */
const OWNER_SCRIPT = (css: string): string => `(function(){var css=${JSON.stringify(css).replace(/</g, "\\u003c")},SH=new WeakMap();function ap(f){try{var d=f.contentDocument,w=f.contentWindow;if(!d||!w||!d.documentElement||!w.CSSStyleSheet||d.adoptedStyleSheets===undefined)return;var old=SH.get(f),ns=new w.CSSStyleSheet();ns.replaceSync(css);d.adoptedStyleSheets=d.adoptedStyleSheets.filter(function(x){return x!==old}).concat([ns]);SH.set(f,ns);d.documentElement.setAttribute("data-ov-owner","1")}catch(e){}}
var f=document.querySelectorAll("iframe[data-follows]");for(var i=0;i<f.length;i++){(function(fr){fr.addEventListener("load",function(){ap(fr)});try{if(fr.contentDocument&&fr.contentDocument.readyState==="complete"&&fr.contentDocument.location.href!=="about:blank")ap(fr)}catch(e){}})(f[i])}})();`;

/**
 * (0.17.0) Appearance kit: adopts the sheet of each element that has one (appearance.ts) into its frame, marks the frame's root `data-ov-look`, then shows
 * the frame (it waits hidden, so OBS never shows the element without its background for a moment). A frame that cannot be reached is shown anyway after 3 s.
 * Emitted only when at least one element has a look: other pages are unchanged byte for byte.
 */
const LOOK_SCRIPT = (sheets: readonly string[]): string => `(function(){var L=${jsonForScript(sheets)},SH=new WeakMap();function ap(f){try{var css=L[+f.getAttribute("data-look")],d=f.contentDocument,w=f.contentWindow;if(css&&d&&w&&d.documentElement&&w.CSSStyleSheet&&d.adoptedStyleSheets!==undefined&&d.location.href!=="about:blank"){var old=SH.get(f),ns=new w.CSSStyleSheet();ns.replaceSync(css);d.adoptedStyleSheets=d.adoptedStyleSheets.filter(function(x){return x!==old}).concat([ns]);SH.set(f,ns);d.documentElement.setAttribute("data-ov-look","1")}}catch(e){}f.style.opacity="1"}
var f=document.querySelectorAll("iframe[data-look]");for(var i=0;i<f.length;i++){(function(fr){fr.addEventListener("load",function(){ap(fr)});setTimeout(function(){fr.style.opacity="1"},3000);try{if(fr.contentDocument&&fr.contentDocument.readyState==="complete"&&fr.contentDocument.location.href!=="about:blank")ap(fr)}catch(e){}})(f[i])}})();`;

const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, "");

export type RenderInput = {
  page: OverlayPageData;
  elements: readonly ResolvedElement[];
  t: Translator;
  lang: string;
  /** Mode test constaté à la lecture. */
  test: boolean;
  now: number;
  nonce: string;
  /** Adresse de l'interrogation légère (état). */
  stateUrl: string;
  /** Mise à l'échelle de la scène pour une fenêtre plus petite que la page (aperçu dans l'administration) : jamais dans OBS. */
  fit?: boolean;
  /** (0.8.0) The overlay skin the page wears now (null: the common style), and whether the page should keep polling quickly because a context drives the skin. */
  skin?: LoadedPayload | null;
  /** (0.21.0) The skins elements wear instead of the page's, by skin id (null: that skin does not work any more; the element then wears no skin). */
  elementSkins?: ReadonlyMap<string, LoadedPayload | null>;
  contextual?: boolean;
};

const hue = (i: number) => (i * 47 + 10) % 360;

export function renderPage(i: RenderInput): string {
  const { page, t } = i;
  const left = i.test && page.testUntil ? Math.max(0, page.testUntil - i.now) : 0;
  // (0.21.0) Skins of single elements: one entry per distinct choice ("" = no skin), only for elements that follow the style.
  const es: { id: string; css: string }[] = [];
  const esIndex = new Map<string, number>();
  /** undefined: the page's skin (also for a skin that was not loaded); null: no skin; else the loaded skin (null payload: it does not work, so no skin). */
  const chosen = (e: ResolvedElement["el"]): LoadedPayload | null | undefined => e.skin === undefined ? undefined : e.skin === null ? null : i.elementSkins?.has(e.skin) ? i.elementSkins.get(e.skin) ?? null : undefined;
  const ownSkin = (r: ResolvedElement): number => {
    if (r.status !== "ok" || !r.follows || chosen(r.el) === undefined) return -1;
    const k = r.el.skin ?? "";
    let n = esIndex.get(k);
    if (n === undefined) { const p = k ? i.elementSkins?.get(k) ?? null : null; n = es.push({ id: p?.id ?? "", css: p?.css ?? "" }) - 1; esIndex.set(k, n); }
    return n;
  };
  const ownSkins = page.active ? i.elements.map(ownSkin) : [];
  const cfg = { rev: page.rev, active: page.active, state: i.stateUrl, fit: !!i.fit, w: page.width, h: page.height, test: i.test, left, ctx: !!i.contextual, skin: i.skin ? { key: i.skin.key, id: i.skin.id, css: i.skin.css } : null, ...(es.length ? { es } : {}) };
  const head = (title: string) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>`;
  const script = `<script nonce="${i.nonce}">window.__ov=${jsonForScript(cfg)};${pollScript(es.length > 0)}</script>`;
  if (!page.active) {
    return `<!doctype html><html lang="${esc(i.lang)}" data-ov-region="page"><head>${head(page.name)}<style nonce="${i.nonce}">${BASE_CSS}${tokensCss(page.style)}</style></head><body data-ov-part="page">${i.test ? `<div class="off" data-ov-part="empty">${esc(t("overlay.page.disabled"))}</div>` : ""}${script}</body></html>`;
  }
  const pageSide = { style: page.style, skin: !!(i.skin || page.look?.skin || page.look?.byContext?.enabled) };
  const sheets: string[] = [];
  const frames = i.elements.map((r, idx) => {
    const { el } = r;
    const mine = ownSkins[idx] ?? -1;
    const elSkin = r.follows ? chosen(el) : undefined;
    const side = elSkin === undefined ? pageSide : { ...pageSide, skin: !!elSkin };
    const applied = r.status === "ok" ? appliedLook(el.style, side, !!r.follows, elSkin === undefined ? i.skin?.colors : elSkin?.colors) : null;
    const look = applied ? sheets.push(lookCss(applied)) - 1 : -1;
    const label = `${r.title} · ${el.w}×${el.h} px`;
    const note = r.status === "ok" ? "" : ` <em>— ${esc(t(r.status === "missing" ? "overlay.page.gone" : `overlay.page.failed.${r.reason ?? "error"}`))}</em>`;
    // En direct, un élément manquant ou en échec reste un cadre VIDE et silencieux ; le détail n'est que dans le cadre de test.
    const iframe = r.status === "ok" && r.layout
      ? `<iframe title="${esc(r.title)}" src="${esc(i.test && r.demoSrc ? r.demoSrc : r.src)}" data-live="${esc(r.src)}"${r.demoSrc ? ` data-demo="${esc(r.demoSrc)}"` : ""} sandbox="${FRAME_SANDBOX}" allow="autoplay" referrerpolicy="no-referrer" loading="eager" tabindex="-1"${r.follows ? ' data-follows="1"' : ""}${mine >= 0 ? ` data-eskin="${mine}"` : ""}${look >= 0 ? ` data-look="${look}"` : ""} style="${(i.skin && r.follows) || look >= 0 || (mine >= 0 && es[mine]!.css) ? "opacity:0;transition:opacity .2s;" : ""}left:${r.layout.offsetX}px;top:${r.layout.offsetY}px;width:${r.layout.iframeW}px;height:${r.layout.iframeH}px;transform:scale(${r.layout.scale})"></iframe>`
      : "";
    return `<div class="el" data-ov-region="element" data-ov-part="${r.status === "ok" ? "frame" : "empty"}" data-uid="${esc(el.uid)}" style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;z-index:${idx + 1}">${iframe}<div class="tf" data-ov-part="test-frame" style="--tc:hsl(${hue(idx)} 85% 62%)"><span class="lb" data-ov-part="label">${esc(label)}${note}</span></div></div>`;
  }).join("");
  void OV_PARTS;
  const looks = sheets.length ? `<script nonce="${i.nonce}">${LOOK_SCRIPT(sheets)}</script>` : "";
  const own = page.style.background === "opaque" && i.elements.some((r) => r.status === "ok" && r.follows) ? `<script nonce="${i.nonce}">${OWNER_SCRIPT(ownerSurfaceCss(page.style))}</script>` : "";
  return `<!doctype html><html lang="${esc(i.lang)}" data-ov-region="page"${i.test ? ' data-test="1"' : ""}><head>${head(page.name)}<style nonce="${i.nonce}">${BASE_CSS}${tokensCss(page.style)}</style></head><body data-ov-part="page"><div class="stage" style="width:${page.width}px;height:${page.height}px">${frames}</div>${script}${own}${looks}</body></html>`;
}

/** Ensemble des chemins d'iframes à autoriser (pour la politique de sécurité). */
export const framePaths = (elements: readonly ResolvedElement[]): string[] => elements.flatMap((r) => (r.status === "ok" && r.src ? [r.src.split("?")[0]!] : []));
