/* Script du BANC D'ESSAI (docs/SKINS.md §14) : imite en quelques lignes ce que fait le JavaScript du cœur sur le menu et le bandeau de cookies, sur les MÊMES attributs
   (`data-open`, `aria-expanded`, `data-panel-button`, `data-trigger`, `data-sub`). Le banc n'a ni Next ni React côté navigateur ; un skin, lui, ne contient aucun script. */
(function () {
  var d = document;
  function nav() { return d.querySelector("[data-site-nav]"); }
  function list() { return d.querySelector("[data-site-nav] [data-skin-part=nav-list]"); }
  function setPanel(open) {
    var l = list(), b = d.querySelector("[data-panel-button]");
    if (!l || !b) return;
    l.setAttribute("data-open", open ? "true" : "false");
    b.setAttribute("aria-expanded", open ? "true" : "false");
    var icon = b.querySelector("span[aria-hidden]"); if (icon) icon.textContent = open ? "✕" : "☰";
    if (!open) closeSubs();
  }
  function closeSubs() {
    var subs = d.querySelectorAll("[data-site-nav] [data-sub]"), i;
    for (i = 0; i < subs.length; i++) subs[i].setAttribute("data-open", "false");
    var tr = d.querySelectorAll("[data-site-nav] [data-trigger]");
    for (i = 0; i < tr.length; i++) tr[i].setAttribute("aria-expanded", "false");
  }
  function toggleSub(t) {
    var n = t.getAttribute("data-trigger"), sub = d.querySelector("[data-site-nav] [data-sub='" + n + "']");
    if (!sub) return;
    var open = sub.getAttribute("data-open") !== "true";
    closeSubs();
    sub.setAttribute("data-open", open ? "true" : "false");
    t.setAttribute("aria-expanded", open ? "true" : "false");
  }
  // menu sobre (MenuToggle) : le cœur n'a le panneau dans le DOM que quand il est ouvert ; le banc le tire d'un <template>
  function minimalToggle(btn) {
    var open = btn.getAttribute("aria-expanded") === "true";
    var existing = d.getElementById("site-menu");
    if (open && existing) { existing.parentNode.removeChild(existing); btn.setAttribute("aria-expanded", "false"); btn.querySelector("span[aria-hidden]").textContent = "☰"; return; }
    var tpl = d.getElementById("bench-minimal-panel");
    if (!tpl) return;
    btn.parentNode.appendChild(tpl.content.firstElementChild.cloneNode(true));
    btn.setAttribute("aria-expanded", "true"); btn.querySelector("span[aria-hidden]").textContent = "✕";
  }
  d.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var pb = t.closest("[data-panel-button]"); if (pb) { setPanel(pb.getAttribute("aria-expanded") !== "true"); return; }
    var tr = t.closest("[data-trigger]"); if (tr) { toggleSub(tr); return; }
    var mt = t.closest("[data-skin-part=menu-toggle]"); if (mt && !mt.hasAttribute("data-panel-button")) { minimalToggle(mt); return; }
    var c = t.closest("[data-testid^=cookie-]"); if (c) { var tray = d.querySelector("[data-skin-part=cookie-tray]"); if (tray && tray.parentNode) tray.parentNode.removeChild(tray); return; }
  });
  d.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var subs = d.querySelectorAll("[data-site-nav] [data-sub][data-open=true]");
    if (subs.length) { var n = subs[0].getAttribute("data-sub"), t = d.querySelector("[data-trigger='" + n + "']"); closeSubs(); if (t) t.focus(); return; }
    var l = list(); if (l && l.getAttribute("data-open") === "true" && getComputedStyle(d.querySelector("[data-panel-button]")).display !== "none") { setPanel(false); d.querySelector("[data-panel-button]").focus(); return; }
    var site = d.getElementById("site-menu"); if (site) { var b = d.querySelector("[data-skin-part=menu-toggle]"); site.parentNode.removeChild(site); if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); } }
  });
  d.addEventListener("pointerdown", function (e) {
    var n = nav(); if (n && !n.contains(e.target)) { var l = list(); if (l && l.getAttribute("data-open") === "true") setPanel(false); closeSubs(); }
  });
})();
