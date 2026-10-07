// Labyrinthe 3D pour OBS — module communautaire de Vitrine (hors du cœur : s'installe depuis git).
//
// Il ne sait rien des blogs, des codes promo ni des sponsors : il digère des « affiches »
// (sujets `core.entry` — les entrées publiées de n'importe quelle instance — et `maze.poster`,
// un format que n'importe quel autre module peut fournir : clips Twitch, vidéos YouTube…) et
// les colle sur les murs. L'admin choisit quelles instances l'alimentent.
import fs from "node:fs";

const webDir = new URL("./web/", import.meta.url);
const clean = (list, max = 5) =>
  list.map((u) => String(u ?? "").trim()).filter((u) => /^(https?:\/\/|\/uploads\/)/.test(u)).slice(0, max);
const num = (v, def, min, max) => Math.min(max, Math.max(min, Number(v) || def));
const color = (v, def) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

// Les fichiers du moteur sont servis tels quels par la route /m/<clé>/<fichier>.js — ce sont des
// modules ES du navigateur qui s'importent entre eux en chemins relatifs.
const routes = {};
for (const file of fs.readdirSync(webDir).filter((f) => /^[a-z-]+\.js$/.test(f))) {
  routes[file] = () =>
    new Response(fs.readFileSync(new URL(file, webDir)), {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
    });
}

// Mode développeur : ?seed=42 (tracé et trajet reproductibles), ?luck=always|never|0.3 (s'arrêter
// devant une affiche), ?fast=1 (délais minimaux), ?dev=1 (= luck=always + fast=1). Ignoré tant que
// le réglage « Mode développeur » de l'instance n'est pas activé.
function devOptions(query) {
  const dev = query.get("dev") === "1";
  const seed = Number(query.get("seed"));
  const luckRaw = query.get("luck") ?? (dev ? "always" : "");
  const luck = luckRaw === "always" || luckRaw === "never" ? luckRaw : luckRaw !== "" && Number.isFinite(Number(luckRaw)) ? Number(luckRaw) : undefined;
  return { seed: query.get("seed") !== null && Number.isFinite(seed) ? Math.trunc(seed) : undefined, luck, fast: dev || query.get("fast") === "1" };
}

const safeImage = (v) => (typeof v === "string" && /^(https?:\/\/|\/(?!\/))/.test(v) ? v : null);
const safeLink = (v) => (typeof v === "string" && /^(https?:\/\/|\/(?!\/))/i.test(v.trim()) ? v.trim() : null);

routes.items = async (_request, ctx) => {
  const [entries, posters, site] = await Promise.all([
    ctx.api.topics.collect("core.entry", { limit: 60 }),
    ctx.api.topics.collect("maze.poster", { limit: 60 }),
    ctx.api.site(ctx.locale),
  ]);
  const raw = [
    ...entries.map((e) => ({
      kind: e.code ? "code" : "article",
      title: String(e.title),
      text: String(e.summary ?? ""),
      url: safeLink(e.url) ?? `${ctx.api.siteUrl}${e.path}`,
      imageUrl: safeImage(e.cover),
    })),
    ...posters.map((p) => ({
      kind: String(p.kind ?? "article"),
      badge: p.badge ? String(p.badge) : undefined,
      title: String(p.title),
      text: String(p.text ?? ""),
      url: safeLink(p.url == null ? ctx.api.siteUrl : String(p.url)) ?? ctx.api.siteUrl,
      imageUrl: safeImage(p.image),
    })),
  ];
  // QR codes générés par le cœur (le module n'a aucune dépendance).
  const items = await Promise.all(raw.map(async (i) => ({ ...i, qrSvg: i.url ? await ctx.api.qr(i.url) : null })));
  return Response.json({ items, logoUrl: site.logo }, { headers: { "cache-control": "no-store" } });
};

export default {
  routes,
  overlay(ctx, { query }) {
    const lines = (v) => String(v ?? "").split("\n");
    const cfg = {
      itemsUrl: `/m/${ctx.instance.key}/items?lang=${ctx.locale}`,
      size: ["small", "medium", "large"].includes(ctx.setting("size")) ? ctx.setting("size") : "medium",
      moveSpeed: num(ctx.setting("moveSpeed"), 1.4, 0.2, 5),
      turnSpeed: num(ctx.setting("turnSpeed"), 220, 30, 720),
      stopMin: num(ctx.setting("stopMin"), 12, 2, 300),
      stopMax: num(ctx.setting("stopMax"), 25, 3, 600),
      hold: num(ctx.setting("hold"), 8, 3, 60),
      fov: num(ctx.setting("fov"), 66, 40, 120),
      accent: color(ctx.setting("accent"), ctx.theme.accent),
      wallColor: color(ctx.setting("wallColor"), "#2a2118"),
      floorColor: color(ctx.setting("floorColor"), "#181310"),
      wall: clean([ctx.setting("wallTexture"), ...lines(ctx.setting("extraWall"))]),
      floor: clean([ctx.setting("floorTexture")]),
      portal: clean([ctx.setting("portalTexture")]),
      hands: clean([ctx.setting("handsSprite")], 1)[0] ?? null,
      dev: ctx.setting("devMode") ? devOptions(query) : null,
    };
    // `<` échappé : la config est insérée dans un <script>, aucun réglage ne doit pouvoir en sortir.
    const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
    return {
      title: ctx.instance.name,
      html: `<div id="vm-root"><canvas id="vm-canvas" style="image-rendering:pixelated"></canvas><div id="vm-focus"></div></div>`,
      css: `
        html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
        #vm-root{position:fixed;inset:0;background:#000}
        #vm-canvas{width:100%;height:100%;display:block}
        #vm-focus{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
        .vm-card{position:relative;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:72%;max-height:82%;padding:24px;
          overflow:hidden;border-radius:16px;border:2px solid ${cfg.accent};border-bottom:0;background:${ctx.theme.surface}ee;color:${ctx.theme.fg};box-shadow:0 20px 60px #000a;backdrop-filter:blur(4px)}
        .vm-badge{font-size:12px;font-weight:700;letter-spacing:.2em;color:${cfg.accent}}
        .vm-title{margin:0;font-size:40px;line-height:1.15;font-family:"Arial Black",Impact,sans-serif}
        .vm-body{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1;overflow:hidden}
        .vm-image{max-height:40%;width:100%;object-fit:cover;border-radius:8px;border:1px solid #fff2}
        .vm-text{margin:0;font-size:24px;line-height:1.5;color:${ctx.theme.muted};display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
        .vm-video{width:100%;height:100%;min-height:300px;border:1px solid #fff2;border-radius:8px}
        .vm-foot{display:flex;align-items:center;gap:16px;border-top:1px solid #fff2;padding-top:12px}
        .vm-qr{width:110px;height:110px;flex:none;background:#fff;border-radius:8px;padding:6px;box-sizing:border-box}
        .vm-qr svg{width:100%;height:100%;display:block}
        .vm-url{font-size:14px;color:${ctx.theme.muted};word-break:break-all}
        .vm-bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:${cfg.accent}}`,
      script: `window.__MAZE__=${json};import("/m/${ctx.instance.key}/main.js");`,
    };
  },
};
