/**
 * PAGE « LIEN TERMINÉ » : ce que voit un visiteur quand la date de fin d'un lien court est passée (réponse 410).
 * Une page complète et autonome (aucun fichier à charger, aucun script, aucun cookie) aux couleurs du site : les variables du thème (`themeCss`) y sont reprises.
 * Fonction pure : tout est échappé ; le message de la personne est du texte simple (jamais du HTML).
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type GonePage = {
  lang: string;
  rtl?: boolean;
  siteName: string;
  title: string;
  /** Message de la personne ; vide = `defaultMessage`. */
  message: string;
  defaultMessage: string;
  homeLabel: string;
  homeHref: string;
  /** Variables du thème (`themeCss(theme)`), reprises telles quelles dans la page. */
  themeCss: string;
  logoUrl?: string | null;
};

export function renderGonePage(p: GonePage): string {
  const message = p.message.trim() || p.defaultMessage;
  const logo = p.logoUrl && /^(\/uploads\/|https:\/\/)/.test(p.logoUrl) ? `<img class="logo" src="${esc(p.logoUrl)}" alt="">` : "";
  return `<!doctype html>
<html lang="${esc(p.lang)}" dir="${p.rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} | ${esc(p.siteName)}</title>
<style>${p.themeCss}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--v-bg);color:var(--v-fg);font-family:var(--v-font);line-height:1.6}
main{width:100%;max-width:32rem;text-align:center;background:var(--v-surface);border:1px solid var(--v-line);border-radius:20px;padding:36px 24px}
.logo{display:block;margin:0 auto 16px;max-height:56px;max-width:60%;height:auto}
.site{margin:0 0 20px;color:var(--v-muted);font-size:.95rem}
h1{margin:0 0 12px;font-size:1.6rem;line-height:1.25}
p.msg{margin:0 0 28px;white-space:pre-line;overflow-wrap:anywhere}
a.home{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 22px;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);font-weight:600;text-decoration:none}
a.home:hover{filter:brightness(1.08)}
a.home:focus-visible{outline:3px solid var(--v-fg);outline-offset:3px}
</style>
</head>
<body>
<main id="content">
${logo}<p class="site">${esc(p.siteName)}</p>
<h1>${esc(p.title)}</h1>
<p class="msg">${esc(message)}</p>
<a class="home" href="${esc(p.homeHref)}">${esc(p.homeLabel)}</a>
</main>
</body>
</html>`;
}
