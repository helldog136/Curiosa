/**
 * Le PETIT SCRIPT du cœur qui garde le choix clair / sombre du visiteur (docs/SKINS.md §3.8). Servi par `/skins/mode.js` (même origine, jamais par un skin).
 *
 *  - il lit `localStorage["curiosa-mode"]` (« light » ou « dark » ; absent = Automatique) et pose `data-mode` sur `<html>` AVANT le premier rendu : pas de flash ;
 *  - il rend visible la bascule (`hidden` levé) et dit l'état aux lecteurs d'écran (`aria-pressed`), puis écoute les clics par délégation ;
 *  - AUCUN cookie, rien n'est envoyé au serveur ; si le stockage est bloqué (navigation privée…), le choix vaut pour la page en cours seulement.
 * Écrit en ES5 volontairement, sans dépendance, ~1 Ko : chargé en bloquant dans `<head>`, sans `defer` ni `async`.
 */
import { createHash } from "node:crypto";

export const MODE_STORAGE_KEY = "curiosa-mode";
export const MODE_SCRIPT_PATH = "/skins/mode.js";

export const MODE_SCRIPT = `(function(){
var K="${MODE_STORAGE_KEY}",d=document,r=d.documentElement;
function get(){try{var v=localStorage.getItem(K);return v==="light"||v==="dark"?v:""}catch(e){return""}}
function apply(m){if(m)r.setAttribute("data-mode",m);else r.removeAttribute("data-mode")}
function mark(){var m=get()||"auto",g=d.querySelectorAll("[data-skin-part=mode-switch]"),i,j,b;
for(i=0;i<g.length;i++){g[i].hidden=false;b=g[i].querySelectorAll("[data-mode-value]");
for(j=0;j<b.length;j++)b[j].setAttribute("aria-pressed",b[j].getAttribute("data-mode-value")===m?"true":"false")}}
apply(get());
d.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("[data-mode-value]"):null;
if(!t)return;var v=t.getAttribute("data-mode-value"),m=v==="light"||v==="dark"?v:"";
try{if(m)localStorage.setItem(K,m);else localStorage.removeItem(K)}catch(x){}
apply(m);var g=d.querySelectorAll("[data-skin-part=mode-switch]"),i;for(i=0;i<g.length;i++)g[i].hidden=false;
var b=d.querySelectorAll("[data-mode-value]"),j;for(j=0;j<b.length;j++)b[j].setAttribute("aria-pressed",b[j].getAttribute("data-mode-value")===(m||"auto")?"true":"false")});
addEventListener("storage",function(e){if(e.key===K){apply(get());mark()}});
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",mark);else mark()
})();
`;

/** Empreinte du script : change quand le script change, pour que `?v=…` casse le cache immuable. */
export const MODE_SCRIPT_VERSION = createHash("sha256").update(MODE_SCRIPT).digest("hex").slice(0, 10);
export const MODE_SCRIPT_URL = `${MODE_SCRIPT_PATH}?v=${MODE_SCRIPT_VERSION}`;
