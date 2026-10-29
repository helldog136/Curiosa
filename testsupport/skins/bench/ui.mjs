// L'interface du banc d'essai (`/__bench/`) : une barre (page, mode clair/sombre/appareil, largeur d'écran, mise en page de l'en-tête, langue, menu ouvert, bandeau de cookies)
// et le site de démonstration dans un cadre à la largeur choisie (les `@media` du skin voient donc la vraie largeur). Réservé au banc : le site réel n'a rien de tel.
import { DEMO_PAGES, BOARD_PATH } from "./site.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function benchUi(site, query = {}) {
  const L = query.lang === "en" ? "en" : "fr";
  const T = (fr, en) => (L === "fr" ? fr : en);
  const widths = [...new Set([390, 768, 1280, 1920, ...(site.manifest?.breakpoints ?? [])])].sort((a, b) => a - b);
  const pages = [...DEMO_PAGES.map((p) => [p.path, p.title[L]]), [BOARD_PATH, T("Planche de toutes les pièces", "Board of all parts")]];
  const dual = site.look.switchAvailable;
  const issues = site.issues.filter((i) => i.severity === "error").length;
  const warns = site.issues.filter((i) => i.severity === "warning").length;
  const name = site.manifest ? `${site.manifest.name[L]} ${site.manifest.version}` : T("skin de base (basic)", "basic skin");
  return `<!doctype html><html lang="${L}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${T("Banc d'essai", "Bench")} — ${esc(name)}</title>
<style>
:root{color-scheme:light dark;font:14px/1.4 system-ui,sans-serif}body{margin:0;background:#f4f4f5;color:#18181b}@media(prefers-color-scheme:dark){body{background:#18181b;color:#f4f4f5}}
#bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.5rem 1rem;background:#27272a;color:#fafafa}
#bar label{display:flex;gap:.35rem;align-items:center}#bar select,#bar button{font:inherit;min-height:32px}#bar b{font-weight:600}
#state{margin-left:auto}#state[data-bad]{color:#fca5a5}
#wrap{display:flex;justify-content:center;padding:1rem}iframe{border:1px solid #71717a;background:#fff;max-width:100%;height:calc(100vh - 100px)}
</style></head><body>
<div id="bar"><b>${T("Banc d'essai", "Bench")}</b><span>${esc(name)}</span>
<label>${T("Page", "Page")} <select id="page">${pages.map(([p, t]) => `<option value="${p}">${esc(t)}</option>`).join("")}</select></label>
<label>${T("Langue", "Language")} <select id="lang"><option value="fr">FR</option><option value="en">EN</option></select></label>
<label>${T("Largeur", "Width")} <select id="width">${widths.map((w) => `<option value="${w}"${w === 1280 ? " selected" : ""}>${w} px</option>`).join("")}</select></label>
<label>${T("En-tête", "Header")} <select id="layout"><option value="">${T("celui du skin", "the skin's")}</option>${["classic", "twoRows", "centered", "minimal"].map((l) => `<option>${l}</option>`).join("")}</select></label>
${dual ? `<label>${T("Mode", "Mode")} <select id="mode"><option value="">${T("Appareil", "Device")}</option><option value="light">${T("Clair", "Light")}</option><option value="dark">${T("Sombre", "Dark")}</option></select></label>` : `<span>${T("un seul mode", "single mode")}</span>`}
<label><input type="checkbox" id="menu"/> ${T("menu ouvert", "menu open")}</label><label><input type="checkbox" id="tray"/> ${T("cookies", "cookies")}</label><label><input type="checkbox" id="banner"/> ${T("bandeaux", "banners")}</label>
<span id="state"${issues ? " data-bad" : ""}>${T(`${issues} erreur(s), ${warns} avertissement(s) : relancez 'skin:check'`, `${issues} error(s), ${warns} warning(s): run 'skin:check'`)}</span></div>
<div id="wrap"><iframe id="f" title="${T("Site de démonstration", "Demo site")}"></iframe></div>
<script>
var $=function(i){return document.getElementById(i)};
function go(){var p=$("page").value,l=$("lang").value,q=new URLSearchParams();
if($("layout").value)q.set("layout",$("layout").value);if($("mode")&&$("mode").value)q.set("mode",$("mode").value);
if($("menu").checked)q.set("menu","open");if($("tray").checked)q.set("tray","1");if($("banner").checked)q.set("banner","1");
$("f").style.width=$("width").value+"px";$("f").src=(l==="en"?"/en":"")+(p==="/"&&l==="en"?"":p)+(q.toString()?"?"+q:"");}
["page","lang","width","layout","mode","menu","tray","banner"].forEach(function(i){var e=$(i);if(e)e.addEventListener("change",go)});go();
</script></body></html>`;
}
