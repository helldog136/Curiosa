// Du résultat brut d'un adaptateur à la fiche normalisée (« profil ») : textes nettoyés, adresses vérifiées, doublons retirés, réseaux reconnus, rien d'ignoré en silence.
// La fiche est un JSON stable (mêmes entrées → mêmes octets) : l'assistant peut la relire, la corriger à la main, puis en faire une sauvegarde.
import { cleanText } from "./text.mjs";
import { classify, MAX_SOCIALS, platformFromType } from "./socials.mjs";
import { cleanLinkUrl, hostOf, stripTracking, urlKey } from "./urls.mjs";

export const PROFILE_KIND = "curiosa-links-profile";
export const MAX_LINKS = 200;
const SERVICE_PATH = /^\/(signup|sign-up|register|login|log-in|privacy|terms|legal|about|help|support|report|cookies|s\/|pricing|blog\/?$)/i;

const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));
/** Lien vers le service lui-même (page d'accueil, inscription, mentions) ou vers une autre page de la même adresse de service ? */
function isServiceLink(url, pageHost, serviceHosts) {
  if (/^mailto:/i.test(url)) return false;
  const h = hostOf(url);
  if (!hostMatches(h, serviceHosts)) return false;
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* adresse déjà validée */ }
  return h === pageHost || path === "/" || SERVICE_PATH.test(path);
}

const KNOWN = { linkedin: "LinkedIn", email: "E-mail", mail: "E-mail", website: "Site web", web: "Site web", vimeo: "Vimeo", medium: "Medium", whatsapp: "WhatsApp", paypal: "PayPal", apple: "Apple Music", applemusic: "Apple Music", amazon: "Amazon", tumblr: "Tumblr", etsy: "Etsy", deezer: "Deezer", twitterx: "X (Twitter)" };
const typeLabel = (type) => { const t = cleanText(type, 40); return KNOWN[t.toLowerCase().replace(/[^a-z]/g, "")] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ""); };
const youtubeNote = (url) => `chaîne YouTube ${url} : le bouton YouTube demande l'identifiant de chaîne (commence par UC…) ; elle est reprise comme lien, à compléter dans l'admin si vous voulez le bouton`;
const guessName = (url) => { try { const seg = new URL(url).pathname.split("/").filter(Boolean)[0]; return seg ? cleanText(seg.replace(/[-_.]+/g, " "), 80) : ""; } catch { return ""; } };

/**
 * raw : { name, description, avatar, links:[{title,url,section,locked,needsResolve}], socials:[{url,type,label}], skipped:[{title,url,reason}], notes:[] }
 * ctx : { input, url, aggregator, adapter, fallback, fallbackReason, serviceHosts, keepSocialsInLinks }
 */
export function normalise(raw, ctx) {
  const notRetained = [], duplicates = [], toCheck = [], notes = [...(raw.notes ?? [])];
  const base = ctx.url || undefined;
  const pageHost = hostOf(ctx.url ?? "");
  const serviceHosts = ctx.serviceHosts ?? [];

  const site = { name: cleanText(raw.name, 80), description: cleanText(raw.description, 600), avatar: "" };
  if (!site.name) { site.name = guessName(ctx.url ?? ""); if (site.name) toCheck.push(`nom du site déduit de l'adresse (« ${site.name} ») : à vérifier`); else toCheck.push("aucun nom trouvé : à renseigner"); }
  if (!site.description) toCheck.push("aucune présentation (bio) trouvée");
  if (raw.avatar) { site.avatar = cleanLinkUrl(String(raw.avatar), base) ?? ""; if (!site.avatar || /^mailto:/i.test(site.avatar)) { site.avatar = ""; toCheck.push("l'adresse de l'avatar n'est pas valable : pas d'avatar repris"); } }
  else toCheck.push("aucun avatar trouvé");

  for (const s of raw.skipped ?? []) notRetained.push({ title: cleanText(s.title, 120) || "(sans titre)", url: cleanLinkUrl(String(s.url ?? ""), base) ?? "", reason: cleanText(s.reason, 160) });

  const socials = [], socialKeys = new Set();
  const links = [], linkKeys = new Map();
  const addSocial = (c, from) => {
    const key = `${c.platform}:${String(c.handle ?? c.url).toLowerCase().replace(/\/+$/, "")}`;
    if (socialKeys.has(key)) { duplicates.push({ title: c.label, url: c.url, of: c.label }); return "dup"; }
    if (socials.length >= MAX_SOCIALS) return "full";
    socialKeys.add(key);
    socials.push({ platform: c.platform, module: c.module, setting: c.setting, value: c.value, label: c.label, handle: c.handle, url: stripTracking(c.url), from });
    return "ok";
  };
  const addLink = (l) => {
    const key = urlKey(l.url);
    if (linkKeys.has(key)) { duplicates.push({ title: l.title, url: l.url, of: linkKeys.get(key) }); return; }
    if (links.length >= MAX_LINKS) { notRetained.push({ title: l.title, url: l.url, reason: `au-delà de ${MAX_LINKS} liens` }); return; }
    linkKeys.set(key, l.title);
    links.push(l);
  };
  const linkOf = (title, url, section, icon) => ({ title: cleanText(title, 120) || hostOf(url) || url, url, section: cleanText(section, 60), icon: icon ?? null });

  // 1. réseaux annoncés comme tels par la page (rangée d'icônes) ; ceux qui n'ont pas de module deviennent des liens, rangés APRÈS la liste
  const later = [];
  for (const s of raw.socials ?? []) {
    const url = cleanLinkUrl(String(s.url ?? ""), base);
    const label = cleanText(s.label, 60);
    if (!url) { notRetained.push({ title: label || cleanText(s.type, 40) || "(réseau)", url: cleanText(String(s.url ?? ""), 200), reason: "adresse non valide ou schéma non autorisé" }); continue; }
    const c = classify(url, { hint: platformFromType(s.type) });
    if (c && !c.unresolved) {
      if (addSocial(c, "icônes") === "full") { later.push(linkOf(label || c.label, url, "", c.icon)); toCheck.push(`plus de ${MAX_SOCIALS} réseaux : « ${label || c.label} » est repris comme lien`); }
    } else if (c?.unresolved) {
      later.push(linkOf(label || c.label, url, "", c.icon));
      toCheck.push(youtubeNote(url));
    } else if (!isServiceLink(url, pageHost, serviceHosts)) {
      const shown = label || typeLabel(s.type) || hostOf(url);
      later.push(linkOf(shown, url, "", null));
      if (!/^mailto:/i.test(url)) notes.push(`réseau sans module dédié : « ${shown} » repris comme lien`);
    }
  }

  // 2. liens de la liste
  for (const l of raw.links ?? []) {
    let url = cleanLinkUrl(String(l.url ?? ""), base);
    const title = cleanText(l.title, 120);
    if (!url) { notRetained.push({ title: title || "(sans titre)", url: cleanText(String(l.url ?? ""), 200), reason: /^\s*(javascript|data|vbscript|file|tel|sms|blob):/i.test(String(l.url ?? "")) ? "adresse non autorisée (seuls http, https et mailto le sont)" : "adresse manquante ou illisible" }); continue; }
    if (l.needsResolve) { notRetained.push({ title: title || hostOf(url), url, reason: "redirection du service non résolue : relancez avec --resolve-redirects, ou copiez l'adresse à la main" }); continue; }
    if (isServiceLink(url, pageHost, serviceHosts)) { notRetained.push({ title: title || hostOf(url), url, reason: "lien du service lui-même (pas un lien de la personne)" }); continue; }
    if (l.locked) toCheck.push(`« ${title || hostOf(url)} » est protégé sur la page d'origine (âge, mot de passe…) : vérifiez qu'il est bien accessible`);
    const c = classify(url);
    if (c && !c.unresolved) {
      const r = addSocial(c, "liste");
      if (r === "ok") { notes.push(`« ${title || c.label} » (${c.label}) est devenu un bouton réseau`); if (ctx.keepSocialsInLinks) addLink(linkOf(title, url, l.section, c.icon)); continue; }
      if (r === "dup") continue;
      addLink(linkOf(title, url, l.section, c.icon)); continue; // plus de place dans l'en-tête : reste un lien
    }
    if (c?.unresolved) toCheck.push(youtubeNote(url));
    addLink(linkOf(title, url, l.section, c?.icon ?? null));
  }

  for (const l of later) addLink(l);

  if (!links.length && !socials.length) toCheck.push("aucun lien trouvé : la page est vide, protégée, ou sa structure n'est pas reconnue — essayez d'enregistrer la page depuis le navigateur (Fichier > Enregistrer sous) et de relancer sur ce fichier");
  if (ctx.fallback) toCheck.push(`lecture de secours (adaptateur générique) : ${ctx.fallbackReason} — vérifiez l'ordre et les titres des liens`);
  const sections = [...new Set(links.map((l) => l.section).filter(Boolean))];

  return {
    kind: PROFILE_KIND, version: 1,
    source: { input: cleanText(ctx.input, 300), url: ctx.url ?? "", aggregator: ctx.aggregator ?? "unknown", adapter: ctx.adapter ?? "generic", fallback: !!ctx.fallback, fallbackReason: ctx.fallback ? cleanText(ctx.fallbackReason, 300) : "" },
    site,
    links: links.map(({ title, url, section, icon }) => ({ title, url, section, icon })),
    socials: socials.map((s) => ({ platform: s.platform, module: s.module, setting: s.setting, value: s.value, label: s.label, handle: s.handle, url: s.url })),
    sections,
    notRetained,
    duplicates: duplicates.map((d) => ({ title: cleanText(d.title, 120), url: d.url, of: cleanText(d.of, 120) })),
    toCheck: [...new Set(toCheck)],
    notes: [...new Set(notes)],
  };
}

/** Une fiche relue depuis un fichier (corrigée à la main) : on la revalide comme si elle venait d'une page. */
export function revalidateProfile(p) {
  if (!p || p.kind !== PROFILE_KIND || !Array.isArray(p.links) || !Array.isArray(p.socials)) throw new Error("ce fichier n'est pas une fiche produite par import-links (kind attendu : " + PROFILE_KIND + ")");
  const raw = {
    name: p.site?.name, description: p.site?.description, avatar: p.site?.avatar, notes: p.notes ?? [],
    links: p.links.map((l) => ({ title: l.title, url: l.url, section: l.section })),
    socials: p.socials.map((s) => ({ url: s.url ?? s.value, type: s.platform, label: s.label })),
  };
  const out = normalise(raw, { input: p.source?.input ?? "", url: "", aggregator: p.source?.aggregator, adapter: p.source?.adapter, fallback: p.source?.fallback, fallbackReason: p.source?.fallbackReason, serviceHosts: [] });
  out.source.url = typeof p.source?.url === "string" ? p.source.url : "";
  out.notRetained = [...(p.notRetained ?? []), ...out.notRetained].filter((x, i, a) => a.findIndex((y) => y.url === x.url && y.title === x.title) === i);
  out.toCheck = [...new Set([...(p.toCheck ?? []).filter((t) => !/aucun (nom|avatar|présentation)/.test(t)), ...out.toCheck])];
  return out;
}
