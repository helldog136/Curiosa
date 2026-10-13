// Réseaux sociaux reconnus PAR LEUR ADRESSE. Chaque réseau correspond à un module du catalogue (un module par réseau, une instance par compte, sujet `social.link`).
// Les identifiants de modules et leurs réglages sont ceux du catalogue : `profile` (identifiant ou adresse du profil) pour la plupart, `channel` pour Twitch, `channelId` pour YouTube.
// Un lien n'est « un réseau » que s'il pointe vers un PROFIL (pas une vidéo, un message ou un dépôt précis) : le reste reste un lien ordinaire.

const HANDLE = /^[A-Za-z0-9._-]{1,60}$/;
const segs = (u) => u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
const hostIs = (u, ...names) => { const h = u.hostname.toLowerCase().replace(/^www\./, ""); return names.some((n) => h === n || h.endsWith(`.${n}`)); };
const NOT = (list) => (s) => !list.includes(s.toLowerCase());

/**
 * { id, module, setting, label, icon, hosts, parse(u, segs) → { handle?, url? } | null }
 *  - handle : identifiant à saisir dans le réglage ; url : adresse de profil à saisir quand il n'y a pas d'identifiant simple.
 *  - template : adresse reconstruite à partir de l'identifiant (le module fait de même) ; sert à vérifier que l'identifiant suffit.
 */
export const PLATFORMS = [
  { id: "twitch", module: "twitch-channel", setting: "channel", label: "Twitch", icon: "twitch", hosts: ["twitch.tv"], parse: (u, s) => s.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(s[0]) && NOT(["videos", "directory", "downloads", "jobs", "turbo", "settings", "p", "store", "prime", "friends", "subscriptions"])(s[0]) ? { handle: s[0].toLowerCase() } : null },
  { id: "youtube", module: "youtube-channel", setting: "channelId", label: "YouTube", icon: "youtube", hosts: ["youtube.com"], parse: (u, s) => (s[0] === "channel" && /^UC[\w-]{22}$/.test(s[1] ?? "") && s.length === 2 ? { handle: s[1] } : null) },
  { id: "instagram", module: "instagram", setting: "profile", label: "Instagram", icon: "instagram", hosts: ["instagram.com"], template: "https://www.instagram.com/{h}/", parse: (u, s) => s.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(s[0]) && NOT(["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct", "about"])(s[0]) ? { handle: s[0] } : null },
  { id: "tiktok", module: "tiktok", setting: "profile", label: "TikTok", icon: "tiktok", hosts: ["tiktok.com"], template: "https://www.tiktok.com/@{h}", parse: (u, s) => s.length === 1 && /^@[A-Za-z0-9._]{1,40}$/.test(s[0]) ? { handle: s[0].slice(1) } : null },
  { id: "x", module: "x-twitter", setting: "profile", label: "X (Twitter)", icon: "x", hosts: ["x.com", "twitter.com"], template: "https://x.com/{h}", parse: (u, s) => s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0]) && NOT(["i", "intent", "share", "home", "hashtag", "search", "explore", "settings", "login", "about", "tos", "privacy"])(s[0]) ? { handle: s[0] } : null },
  { id: "facebook", module: "facebook", setting: "profile", label: "Facebook", icon: "facebook", hosts: ["facebook.com", "fb.com"], template: "https://www.facebook.com/{h}", parse: (u, s) => {
    if (s.length === 1 && /^[A-Za-z0-9.-]{1,60}$/.test(s[0]) && NOT(["sharer", "sharer.php", "share", "dialog", "events", "watch", "marketplace", "login", "plugins", "tr", "policy", "help", "gaming", "reel", "photo", "stories", "profile.php", "permalink.php", "story.php"])(s[0])) return { handle: s[0] };
    if (s.length === 1 && s[0] === "profile.php" && /^\d+$/.test(u.searchParams.get("id") ?? "")) return { url: `https://www.facebook.com/profile.php?id=${u.searchParams.get("id")}` };
    if ((s[0] === "groups" || s[0] === "people") && s.length >= 2 && s.length <= 3) return { url: `https://www.facebook.com/${s.join("/")}` };
    return null;
  } },
  { id: "discord", module: "discord", setting: "profile", label: "Discord", icon: "discord", hosts: ["discord.gg", "discord.com", "discordapp.com"], template: "https://discord.gg/{h}", parse: (u, s) => {
    const code = hostIs(u, "discord.gg") ? s[0] : s[0] === "invite" ? s[1] : null;
    return code && (hostIs(u, "discord.gg") ? s.length === 1 : s.length === 2) && /^[A-Za-z0-9-]{2,40}$/.test(code) ? { handle: code } : null;
  } },
  { id: "github", module: "github", setting: "profile", label: "GitHub", icon: "github", hosts: ["github.com"], template: "https://github.com/{h}", parse: (u, s) => s.length === 1 && /^[A-Za-z0-9-]{1,39}$/.test(s[0]) && NOT(["about", "features", "pricing", "login", "join", "sponsors", "orgs", "topics", "marketplace", "settings", "explore", "notifications", "new", "pulls", "issues", "enterprise", "security", "customer-stories"])(s[0]) ? { handle: s[0] } : null },
  { id: "bluesky", module: "bluesky", setting: "profile", label: "Bluesky", icon: "bluesky", hosts: ["bsky.app"], template: "https://bsky.app/profile/{h}", parse: (u, s) => s[0] === "profile" && s.length === 2 && HANDLE.test(s[1]) ? { handle: s[1] } : null },
  { id: "mastodon", module: "mastodon", setting: "profile", label: "Mastodon", icon: "mastodon", hosts: [], parse: (u, s) => s.length === 1 && /^@[A-Za-z0-9_.-]{1,60}$/.test(s[0]) ? { url: `https://${u.hostname.toLowerCase()}/${s[0]}` } : null },
  { id: "threads", module: "threads", setting: "profile", label: "Threads", icon: "threads", hosts: ["threads.net", "threads.com"], template: "https://www.threads.net/@{h}", parse: (u, s) => s.length === 1 && /^@[A-Za-z0-9._]{1,40}$/.test(s[0]) ? { handle: s[0].slice(1) } : null },
  { id: "kick", module: "kick", setting: "profile", label: "Kick", icon: "kick", hosts: ["kick.com"], template: "https://kick.com/{h}", parse: (u, s) => s.length === 1 && HANDLE.test(s[0]) && NOT(["categories", "video", "videos", "browse", "following"])(s[0]) ? { handle: s[0] } : null },
  { id: "spotify", module: "spotify", setting: "profile", label: "Spotify", icon: "spotify", hosts: ["spotify.com"], parse: (u, s) => ["artist", "user", "show"].includes(s[0]) && s.length === 2 && /^[A-Za-z0-9_.-]{2,64}$/.test(s[1]) ? { url: `https://open.spotify.com/${s[0]}/${s[1]}` } : null },
  { id: "reddit", module: "reddit", setting: "profile", label: "Reddit", icon: "reddit", hosts: ["reddit.com"], template: "https://www.reddit.com/user/{h}", parse: (u, s) => {
    if ((s[0] === "user" || s[0] === "u") && s.length === 2 && HANDLE.test(s[1])) return { handle: s[1] };
    if (s[0] === "r" && s.length === 2 && HANDLE.test(s[1])) return { url: `https://www.reddit.com/r/${s[1]}` };
    return null;
  } },
  { id: "patreon", module: "patreon", setting: "profile", label: "Patreon", icon: "patreon", hosts: ["patreon.com"], template: "https://www.patreon.com/{h}", parse: (u, s) => {
    const name = s.length === 1 ? s[0] : s[0] === "c" && s.length === 2 ? s[1] : null;
    return name && HANDLE.test(name) && NOT(["posts", "join", "user", "login", "home", "explore", "about", "pricing", "bePatron"])(name) ? (s.length === 1 ? { handle: name } : { url: `https://www.patreon.com/c/${name}` }) : null;
  } },
  { id: "kofi", module: "kofi", setting: "profile", label: "Ko-fi", icon: "kofi", hosts: ["ko-fi.com"], template: "https://ko-fi.com/{h}", parse: (u, s) => s.length === 1 && HANDLE.test(s[0]) && NOT(["s", "explore", "home", "login", "gold"])(s[0]) ? { handle: s[0] } : null },
  { id: "snapchat", module: "snapchat", setting: "profile", label: "Snapchat", icon: "snapchat", hosts: ["snapchat.com"], template: "https://www.snapchat.com/add/{h}", parse: (u, s) => s[0] === "add" && s.length === 2 && HANDLE.test(s[1]) ? { handle: s[1] } : null },
  { id: "pinterest", module: "pinterest", setting: "profile", label: "Pinterest", icon: "pinterest", hosts: ["pinterest.com", "pinterest.fr", "pinterest.be"], template: "https://www.pinterest.com/{h}/", parse: (u, s) => s.length === 1 && HANDLE.test(s[0]) && NOT(["pin", "ideas", "search", "today", "login", "business", "about", "_saved", "_created"])(s[0]) ? { handle: s[0] } : null },
  { id: "telegram", module: "telegram", setting: "profile", label: "Telegram", icon: "telegram", hosts: ["t.me", "telegram.me"], template: "https://t.me/{h}", parse: (u, s) => s.length === 1 && /^[A-Za-z0-9_]{4,40}$/.test(s[0]) && NOT(["share", "joinchat", "addstickers", "proxy", "socks", "login", "setlanguage"])(s[0]) ? { handle: s[0] } : s.length === 1 && /^\+[A-Za-z0-9_-]{6,40}$/.test(s[0]) ? { url: `https://t.me/${s[0]}` } : null },
  { id: "steam", module: "steam", setting: "profile", label: "Steam", icon: "steam", hosts: ["steamcommunity.com"], template: "https://steamcommunity.com/id/{h}", parse: (u, s) => {
    if (s[0] === "id" && s.length === 2 && HANDLE.test(s[1])) return { handle: s[1] };
    if ((s[0] === "profiles" || s[0] === "groups") && s.length === 2 && HANDLE.test(s[1])) return { url: `https://steamcommunity.com/${s[0]}/${s[1]}` };
    return null;
  } },
  { id: "soundcloud", module: "soundcloud", setting: "profile", label: "SoundCloud", icon: "soundcloud", hosts: ["soundcloud.com"], template: "https://soundcloud.com/{h}", parse: (u, s) => s.length === 1 && HANDLE.test(s[0]) && NOT(["discover", "upload", "pages", "stream", "you", "search", "charts", "stations", "popular"])(s[0]) ? { handle: s[0] } : null },
  { id: "bandcamp", module: "bandcamp", setting: "profile", label: "Bandcamp", icon: "bandcamp", hosts: ["bandcamp.com"], parse: (u, s) => /^[a-z0-9-]+\.bandcamp\.com$/i.test(u.hostname) && !/^www\./i.test(u.hostname) && (s.length === 0 || (s.length === 1 && s[0] === "music")) ? { url: `https://${u.hostname.toLowerCase()}/` } : null },
];

/** Instances Mastodon courantes : un `/@nom` n'est reconnu comme Mastodon que sur celles-ci (ou quand la page l'annonce, voir `hint`). */
const MASTODON_HOSTS = ["mastodon.social", "mastodon.online", "mastodon.world", "mstdn.social", "fosstodon.org", "piaille.fr", "mamot.fr", "framapiaf.org", "hachyderm.io", "infosec.exchange", "techhub.social", "floss.social", "chaos.social", "mas.to", "mastodon.art", "social.tchncs.de", "toot.community", "mstdn.party"];

/** Lien de profil d'un réseau reconnu ? → { platform, module, setting, label, icon, value, handle, url } ; { platform:"youtube", unresolved:true } pour une chaîne YouTube sans identifiant UC… ; null sinon. */
export function classify(rawUrl, { hint } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const s = segs(u);
  const candidates = PLATFORMS.filter((p) => (p.id === "mastodon" ? hint === "mastodon" || hostIs(u, ...MASTODON_HOSTS) : hostIs(u, ...p.hosts)));
  for (const p of candidates) {
    const r = p.parse(u, s);
    if (r) return make(p, r);
  }
  if (hostIs(u, "youtube.com") && (/^@[\w.-]+$/.test(s[0] ?? "") || ["c", "user"].includes(s[0])) && s.length <= 2) return { platform: "youtube", unresolved: true, label: "YouTube", icon: "youtube", url: u.href };
  return null;
}
function make(p, { handle, url }) {
  const canonical = url ?? p.template?.replace("{h}", encodeURIComponent(handle)) ?? null;
  // Une adresse de profil suffit toujours (le module vérifie le site) ; l'identifiant seul donne un libellé plus parlant quand le module sait reconstruire l'adresse.
  const useHandle = handle && (p.id === "twitch" || p.id === "youtube" || (p.template && /^[A-Za-z0-9._-]{1,60}$/.test(handle)));
  return { platform: p.id, module: p.module, setting: p.setting, label: p.label, icon: p.icon, handle: handle ?? null, url: canonical ?? (p.id === "twitch" ? `https://www.twitch.tv/${handle}` : `https://www.youtube.com/channel/${handle}`), value: useHandle ? handle : (url ?? canonical) };
}

/** Nom lisible d'un réseau d'après le type annoncé par un service (« INSTAGRAM », « twitter », « x »…). */
export function platformFromType(type) {
  const t = String(type ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const alias = { twitter: "x", xtwitter: "x", kofi: "kofi", bsky: "bluesky", fediverse: "mastodon", tg: "telegram", yt: "youtube", ig: "instagram" };
  const id = alias[t] ?? t;
  return PLATFORMS.some((p) => p.id === id) ? id : null;
}
export const platformIds = () => PLATFORMS.map((p) => p.id);
export const MAX_SOCIALS = 10; // le cœur n'affiche pas plus de dix boutons de réseaux dans l'en-tête
