import type { Translator } from "../i18n/dictionary";
import type { ResolvedElement } from "./resolve";
import type { OverlayPageData } from "./model";
import { OV_PARTS, tokensCss } from "./tokens";

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
function frames(on){var f=document.querySelectorAll('iframe[data-demo]');for(var i=0;i<f.length;i++){var u=on?f[i].getAttribute('data-demo'):f[i].getAttribute('data-live');if(f[i].getAttribute('src')!==u)f[i].setAttribute('src',u)}}
function test(on,left){if(on)d.setAttribute('data-test','1');else d.removeAttribute('data-test');frames(on);clearTimeout(timer);if(on&&left>0)timer=setTimeout(function(){test(false,0)},left+50)}
function next(changed){n=changed?0:n+1;gap=n<6?5000:n<12?10000:15000}
function tick(){fetch(C.state,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'}).then(function(r){return r.ok?r.json():null}).then(function(s){
if(!s){gap=Math.min(gap*2,15000);return}
if(s.rev!==rev||s.active!==act){location.reload();return}
var was=d.getAttribute('data-test')==='1';if(s.test!==was)next(true);else next(false);
test(s.test,s.test?s.until-s.now:0)}).catch(function(){gap=Math.min(gap*2,15000)}).then(function(){setTimeout(tick,gap)})}
if(C.fit){var f=function(){var s=Math.min(innerWidth/C.w,innerHeight/C.h),st=document.querySelector('.stage');if(st)st.style.transform='scale('+s+')'};f();addEventListener('resize',f)}
if(C.test&&C.left>0)timer=setTimeout(function(){test(false,0)},C.left+50);
if(C.state)setTimeout(tick,gap)})();`;

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
};

const hue = (i: number) => (i * 47 + 10) % 360;

export function renderPage(i: RenderInput): string {
  const { page, t } = i;
  const left = i.test && page.testUntil ? Math.max(0, page.testUntil - i.now) : 0;
  const cfg = { rev: page.rev, active: page.active, state: i.stateUrl, fit: !!i.fit, w: page.width, h: page.height, test: i.test, left };
  const head = (title: string) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>`;
  const script = `<script nonce="${i.nonce}">window.__ov=${jsonForScript(cfg)};${POLL_SCRIPT}</script>`;
  if (!page.active) {
    return `<!doctype html><html lang="${esc(i.lang)}" data-ov-region="page"><head>${head(t("overlay.page.disabled"))}<style nonce="${i.nonce}">${BASE_CSS}${tokensCss(page.style)}</style></head><body data-ov-part="page"><div class="off" data-ov-part="empty">${esc(t("overlay.page.disabled"))}</div>${script}</body></html>`;
  }
  const frames = i.elements.map((r, idx) => {
    const { el } = r;
    const label = `${r.title} · ${el.w}×${el.h} px`;
    const note = r.status === "ok" ? "" : ` <em>— ${esc(t(r.status === "missing" ? "overlay.page.gone" : `overlay.page.failed.${r.reason ?? "error"}`))}</em>`;
    // En direct, un élément manquant ou en échec reste un cadre VIDE et silencieux ; le détail n'est que dans le cadre de test.
    const iframe = r.status === "ok" && r.layout
      ? `<iframe title="${esc(r.title)}" src="${esc(i.test && r.demoSrc ? r.demoSrc : r.src)}" data-live="${esc(r.src)}"${r.demoSrc ? ` data-demo="${esc(r.demoSrc)}"` : ""} sandbox="${FRAME_SANDBOX}" allow="autoplay" referrerpolicy="no-referrer" loading="eager" tabindex="-1" style="left:${r.layout.offsetX}px;top:${r.layout.offsetY}px;width:${r.layout.iframeW}px;height:${r.layout.iframeH}px;transform:scale(${r.layout.scale})"></iframe>`
      : "";
    return `<div class="el" data-ov-region="element" data-ov-part="${r.status === "ok" ? "frame" : "empty"}" data-uid="${esc(el.uid)}" style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;z-index:${idx + 1}">${iframe}<div class="tf" data-ov-part="test-frame" style="--tc:hsl(${hue(idx)} 85% 62%)"><span class="lb" data-ov-part="label">${esc(label)}${note}</span></div></div>`;
  }).join("");
  void OV_PARTS;
  return `<!doctype html><html lang="${esc(i.lang)}" data-ov-region="page"${i.test ? ' data-test="1"' : ""}><head>${head(page.name)}<style nonce="${i.nonce}">${BASE_CSS}${tokensCss(page.style)}</style></head><body data-ov-part="page"><div class="stage" style="width:${page.width}px;height:${page.height}px">${frames}</div>${script}</body></html>`;
}

/** Ensemble des chemins d'iframes à autoriser (pour la politique de sécurité). */
export const framePaths = (elements: readonly ResolvedElement[]): string[] => elements.flatMap((r) => (r.status === "ok" && r.src ? [r.src.split("?")[0]!] : []));
