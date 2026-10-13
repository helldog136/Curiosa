// Adresses : ce qu'on accepte comme LIEN (http, https, mailto), ce qu'on accepte comme adresse À TÉLÉCHARGER (http(s) public seulement), et la clé de dédoublonnage.
import net from "node:net";

export const MAX_URL = 2000;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|igshid|igsh|si|mc_cid|mc_eid|ref|ref_src|_branch_match_id)$/i;

/** Lien sortant sûr, résolu par rapport à `base` ; null sinon. Schémas autorisés : http, https, mailto (jamais javascript:, data:, file:, tel:…). */
export function cleanLinkUrl(raw, base) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").trim();
  if (!s || s.length > MAX_URL) return null;
  if (/^mailto:/i.test(s)) {
    const addr = s.slice(7).split("?")[0];
    return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(decodeURIComponentSafe(addr)) ? s : null;
  }
  let u;
  try { u = new URL(s, base || undefined); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !(u.hostname.includes(".") || net.isIP(u.hostname.replace(/^\[|\]$/g, "")))) return null;
  return u.href.length > MAX_URL ? null : u.href;
}
const decodeURIComponentSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** Clé de comparaison : même lien à la barre finale, au « www » et aux paramètres de suivi près. */
export function urlKey(url) {
  if (/^mailto:/i.test(url)) return `mailto:${url.slice(7).split("?")[0].toLowerCase()}`;
  try {
    const u = new URL(url);
    const keep = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${keep ? `?${keep}` : ""}`;
  } catch { return url; }
}
/** Retire les paramètres de suivi d'une adresse. */
export function stripTracking(url) {
  try { const u = new URL(url); for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k); u.hash = ""; return u.href; } catch { return url; }
}

/* ───────────── adresses à télécharger : publiques seulement ───────────── */

/** Adresse IP privée, locale ou réservée ? (IPv4 et IPv6, y compris l'IPv4 écrite en IPv6.) */
export function isPrivateAddress(ip) {
  const a = String(ip).replace(/^\[|\]$/g, "").toLowerCase();
  const v = net.isIP(a);
  if (v === 4) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || p >= 224 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19));
  }
  if (v === 6) {
    const mapped = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) { const x = parseInt(hex[1], 16), y = parseInt(hex[2], 16); return isPrivateAddress(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`); }
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || a.startsWith("2001:db8");
  }
  return false;
}
const PRIVATE_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example)$/i;

/** Lève une erreur si l'adresse n'est pas une page web publique (http/https, port usuel, pas d'identifiants, pas de nom ou d'IP locale). */
export function assertPublicUrl(raw, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { throw importError("bad-url", `adresse illisible : ${String(raw).slice(0, 80)}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw importError("bad-scheme", `seules les adresses http(s) sont acceptées (reçu : ${u.protocol})`);
  if (u.username || u.password) throw importError("credentials", "une adresse contenant un identifiant ou un mot de passe est refusée");
  if (allowLocal) return u;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  if (port !== "443" && port !== "80") throw importError("bad-port", `port ${port} refusé (seuls 80 et 443 sont acceptés)`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || PRIVATE_NAME.test(host) || (!host.includes(".") && !net.isIP(host)) || isPrivateAddress(host)) throw importError("private-address", `adresse non publique refusée : ${host || "?"}`);
  return u;
}

export function importError(code, message) { return Object.assign(new Error(message), { code, name: "ImportError" }); }
