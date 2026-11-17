// Module d'EXEMPLE des éléments de page d'overlay (docs/OVERLAY-ELEMENTS.md). Il montre les trois comportements (scale, fluid, ratio), les options, le style commun
// (--ov-*) et, surtout, un flux d'événements lisible par PLUSIEURS lecteurs en même temps : chaque lecteur garde son propre repère (son « curseur »), il n'y a jamais
// de file partagée que le premier lecteur viderait. Règles du jeu : aucun import du cœur (tout passe par `ctx`), tout texte venu d'ailleurs est échappé.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };

/** Les options reçues dans l'adresse (`opt-<id>`) : chacune est VALIDÉE ici (le cœur a déjà contrôlé, mais le module reste propriétaire du sens) ; une inconnue est ignorée. */
export function readOptions(params) {
  const o = (id) => params.get(`opt-${id}`);
  return {
    format: o("format") === "12h" ? "12h" : "24h",
    seconds: o("seconds") !== "0",
    label: String(o("label") ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 30),
    size: num(o("size"), 20, 200, 96),
    rows: num(o("rows"), 1, 10, 5),
    lines: num(o("lines"), 1, 10, 5),
  };
}

// ── Le flux d'événements ────────────────────────────────────────────────────────────────────────────────────────────────
const FEED = "events";
const PAGE = 50;
const cursorOf = (r) => `${r.createdAt.getTime()}.${r.id}`;
const parseCursor = (c) => { const m = /^(\d{1,15})\.([A-Za-z0-9_-]{0,60})$/.exec(c ?? ""); return m ? { at: Number(m[1]), id: m[2] } : null; };
const after = (r, c) => r.createdAt.getTime() > c.at || (r.createdAt.getTime() === c.at && r.id > c.id);

/** Ajoute un événement au flux (appelé par une action d'administration, une tâche, une route protégée…). */
export async function publish(ctx, text) {
  await ctx.api.store.add(FEED, { text: String(text ?? "").slice(0, 200) });
}

/**
 * Lit le flux POUR UN LECTEUR : `cursor` est SON repère (chaque lecteur a le sien, le module ne retient rien de lui). `"now"` ouvre un nouveau lecteur à la fin du flux.
 * Lecture bornée (50 événements). Rien n'est consommé : deux lecteurs qui demandent la même chose reçoivent la même chose.
 */
export async function readFeed(ctx, cursor) {
  const recent = (await ctx.api.store.page(FEED, { order: "desc", limit: PAGE })).items.slice().reverse();
  const last = recent.at(-1);
  if (cursor === "now" || cursor === undefined || cursor === null) return { events: [], cursor: last ? cursorOf(last) : "0.0" };
  const c = parseCursor(cursor) ?? { at: 0, id: "" };
  const fresh = recent.filter((r) => after(r, c));
  return { events: fresh.map((r) => ({ id: r.id, text: r.data.text })), cursor: fresh.length ? cursorOf(fresh.at(-1)) : cursor };
}

// ── Les pages d'éléments ────────────────────────────────────────────────────────────────────────────────────────────────
/** Style commun : les paramètres `ov-text`, `ov-surface`, `ov-corners` deviennent les jetons --ov-* (valeurs de docs/OVERLAY-ELEMENTS.md). Absents : l'élément ne suit pas le style. */
function tokens(params) {
  if (!params.has("ov-text")) return "";
  const light = params.get("ov-text") !== "dark";
  const soft = params.get("ov-surface") === "soft";
  return `--ov-fg:${light ? "#ffffff" : "#111111"};--ov-surface:${soft ? (light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.7)") : "transparent"};--ov-radius:${params.get("ov-corners") === "square" ? "0px" : "12px"};`;
}

const shell = (params, body, script = "") => `<!doctype html><html data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{${tokens(params)}}
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 24px/1.3 system-ui,sans-serif;color:var(--ov-fg,#fff);text-shadow:0 1px 4px rgba(0,0,0,.35)}
.box{box-sizing:border-box;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;padding:12px;background:var(--ov-surface,transparent);border-radius:var(--ov-radius,0)}
.row{width:100%;display:flex;justify-content:space-between;gap:12px}
</style></head><body><div class="box" data-ov-part="panel">${body}</div>${script ? `<script>${script}</script>` : ""}</body></html>`;

const PAGES = {
  clock(params) {
    const o = readOptions(params);
    const demo = params.get("ov-demo") === "1";
    const script = `(function(){var f=${JSON.stringify(o.format)},s=${o.seconds},el=document.getElementById('t');function p(n){return n<10?'0'+n:''+n}
function tick(){var d=new Date(),h=d.getHours(),ap='';if(f==='12h'){ap=h<12?' AM':' PM';h=h%12||12}el.textContent=p(h)+':'+p(d.getMinutes())+(s?':'+p(d.getSeconds()):'')+ap}tick();setInterval(tick,1000)})();`;
    return shell(params, `${o.label ? `<div data-ov-part="caption">${esc(o.label)}</div>` : ""}<div id="t" data-ov-part="time" style="font-size:${o.size}px">${demo ? "12:34:56" : ""}</div>`, script);
  },
  board(params) {
    const o = readOptions(params);
    const rows = Array.from({ length: o.rows }, (_, i) => `<div class="row" data-ov-part="row"><span>${esc(`Ligne ${i + 1}`)}</span><span>${(i + 1) * 7}</span></div>`).join("");
    return shell(params, rows);
  },
  scene(params) {
    const w = num(params.get("ov-w"), 1, 20000, 1920), h = num(params.get("ov-h"), 1, 20000, 1080);
    return `<!doctype html><html data-ov-region="element"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:linear-gradient(135deg,#12324f,#7a2a6b);color:#fff;font:600 48px system-ui,sans-serif;display:flex;align-items:center;justify-content:center}</style></head><body>${w} × ${h}</body></html>`;
  },
  feed(params) {
    const o = readOptions(params);
    const script = `(function(){var el=document.getElementById('l'),cursor='now',lines=[];function go(){fetch('../feed?after='+encodeURIComponent(cursor),{credentials:'omit'}).then(function(r){return r.json()}).then(function(d){cursor=d.cursor;d.events.forEach(function(e){lines.push(e.text)});lines=lines.slice(-${o.lines});el.textContent='';lines.forEach(function(t){var p=document.createElement('div');p.textContent=t;el.appendChild(p)})}).catch(function(){}).then(function(){setTimeout(go,2000)})}go()})();`;
    return shell(params, `<div id="l" data-ov-part="lines"></div>`, script);
  },
};

// ── The animated element (core 0.30.0, docs/OVERLAY-ANIMATIONS.md) ──────────────────────────────────────────────────────
// The module is the PRINCIPLE: it only builds a state (values, times, highlights). The core's engine (`ctx.overlay.animateScript()`) draws it in the style
// of the page's skin, which the overlay page hands over by itself. In test mode (`ov-demo=1`) a scripted scenario loops: a burst of five steps (one merged
// highlight), a milestone, a goal reached, time added to a countdown. Live, each event of the feed is one step (+1): the real path of an event.
const ANIMATED_SCRIPT = `(function(){var A=window.CuriosaAnimate;if(!A)return;var q=location.search,o=A.optionsFromQuery(q),P=new URLSearchParams(q),g=P.get("opt-genre")||"gauge",demo=P.get("ov-demo")==="1";
var genre=g==="time"?"gauge":g,h=A.mount(document.getElementById("st"),{quality:o.quality,calm:o.calm,lang:o.lang,minText:o.minText,state:{genre:genre}});window.__anim=h;
function scenario(now){var c=Math.floor(now/12000)*12000,k=now-c,steps=[],i;for(i=0;i<5;i++)steps.push({id:"s"+c+"-"+i,at:c+1000+i*180,kind:"step",amount:1});
var base={genre:genre,label:g==="levels"?"Level":g==="counter"?"Session":g==="time"?"Countdown":"Goal"};
if(g==="time")return Object.assign(base,{format:"time",value:0,target:3600,timer:{endsAt:c+1800e3+(k>4000?600e3:0),total:3600e3},highlights:[{id:"x"+c,at:c+4000,kind:"extend",amount:600}]});
if(g==="levels")return Object.assign(base,{value:k<1000?300:k<4000?600:150,target:1000,level:k<4000?2:3,timer:{endsAt:c+300e3-k,total:300e3},highlights:steps.concat([{id:"l"+c,at:c+4000,kind:"milestone"}])});
if(g==="counter")return Object.assign(base,{format:"count",value:k<1000?120:125,highlights:steps});
return Object.assign(base,{value:k<1000?60:k<4000?65:k<8000?75:100,target:100,milestones:[25,50,75],highlights:steps.concat([{id:"m"+c,at:c+4000,kind:"milestone",amount:10},{id:"c"+c,at:c+8000,kind:"complete",amount:25}])})}
if(demo){var tickD=function(){h.setState(scenario(Date.now()))};tickD();setInterval(tickD,250);return}
var value=0,hl=[],cursor="now";function show(){h.setState(g==="time"?{genre:"gauge",format:"time",value:0,target:3600,timer:{endsAt:Date.now()+1800e3},label:"Countdown"}:{genre:genre,value:genre==="levels"?value%10*100:value,target:genre==="levels"?1000:100,level:Math.floor(value/10),label:genre==="counter"?"Session":"Goal",highlights:hl})}
function go(){fetch("../feed?after="+encodeURIComponent(cursor),{credentials:"omit"}).then(function(r){return r.json()}).then(function(d){if(typeof d.now==="number")h.setClock(d.now);if(cursor!=="now")d.events.forEach(function(e){value++;hl.push({id:String(e.id),at:typeof d.now==="number"?d.now:Date.now(),kind:"step",amount:1})});hl=hl.slice(-20);cursor=d.cursor;show()}).catch(function(){}).then(function(){setTimeout(go,1500)})}show();go()})();`;

function animatedPage(params, ctx) {
  // An older core has no animation kit: the element says so plainly instead of breaking
  if (typeof ctx.overlay?.animateScript !== "function") return shell(params, `<div data-ov-part="text">${esc(ctx.locale === "fr" ? "Mettez Curiosa à jour" : "Update Curiosa")}</div>`);
  return `<!doctype html><html data-ov-region="element"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${tokens(params)}}html,body{margin:0;height:100%;background:transparent;overflow:hidden}#st{position:absolute;inset:0}</style></head><body><div id="st" data-ov-part="panel"></div><script>${ctx.overlay.animateScript()}</script><script>${ANIMATED_SCRIPT}</script></body></html>`;
}

PAGES.animated = animatedPage;

const definition = {
  // Les adresses des éléments : calculées côté serveur (avec les secrets du module s'il en a), le cœur y ajoute ov-* et opt-*.
  overlayElements: Object.fromEntries(Object.keys(PAGES).map((id) => [id, (ctx) => ({ url: `/m/${ctx.instance.key}/element/${id}` })])),
  routes: {
    "element/:slug": (request, ctx) => {
      const page = PAGES[ctx.params.slug];
      if (!page) return new Response("Not found", { status: 404 });
      const params = new URL(request.url).searchParams;
      return new Response(page(params, ctx), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" } });
    },
    feed: async (request, ctx) => {
      const after = new URL(request.url).searchParams.get("after");
      // `now`: the server's clock, so every overlay page draws the same instant (core 0.30.0 animated element)
      return Response.json({ ...(await readFeed(ctx, after)), now: Date.now() }, { headers: { "cache-control": "no-store" } });
    },
  },
  adminActions: {
    push: async (ctx, input) => { await publish(ctx, input?.text); return { ok: true }; },
  },
};

export default definition;
