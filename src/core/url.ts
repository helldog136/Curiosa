/** Schémas autorisés pour tout lien sortant saisi dans l'admin ou venant d'un module. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Lien affichable : externe valide, ou chemin interne ("/page"). Sinon "#". */
export function safeHref(value: string | null | undefined): string {
  if (!value) return "#";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return isSafeExternalUrl(value) ? value : "#";
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

const DOMAIN_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const EMAIL_LIKE = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i;

/**
 * Comprend une adresse saisie à la main AVANT de la valider : espaces autour retirés, `www.monsite.be/contact` et `monsite.be/contact` deviennent
 * `https://…`, une adresse e-mail devient `mailto:…`, `/contact` (page du site) et toute adresse complète sont gardées telles quelles.
 * Ce qui reste incompréhensible est rendu inchangé : c'est alors à la validation de refuser, avec un exemple.
 */
export function normalizeLinkInput(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("//")) return DOMAIN_LIKE.test(v.slice(2)) ? `https://${v.slice(2)}` : v;
  if (v.startsWith("/")) return v;
  if (DOMAIN_LIKE.test(v)) return `https://${v}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (EMAIL_LIKE.test(v)) return `mailto:${v}`;
  return v;
}

/* ───────────── Visites sortantes : adresses qu'on refuse de contacter ─────────────
 * `isSafeExternalUrl` ne regarde que le schéma (c'est un filtre de liens affichés). Dès que le SERVEUR visite lui-même une adresse venue du contenu
 * (contrôle du contenu, vignettes…), il faut en plus refuser tout ce qui mène au réseau interne : voir `hostProblem` (avant la résolution du nom)
 * et `addressIsPrivate` (après : l'adresse numérique que renvoie le DNS). Logique pure, sans réseau.
 */
const INTERNAL_SUFFIX = /\.(localhost|local|localdomain|internal|intranet|private|lan|home|corp|home\.arpa)$/i;

export type HostProblem = "scheme" | "credentials" | "port" | "address" | "internal" | "invalid";

/**
 * Pourquoi cette adresse ne doit pas être visitée par le serveur (null : elle peut l'être, sous réserve de la résolution du nom : `addressIsPrivate`).
 * Refuse : un autre schéma que http(s), des identifiants dans l'adresse, un port autre que 443 (80 pour http), une adresse numérique (IPv4 sous toutes ses
 * écritures, IPv6), un nom interne (`localhost`, `.local`, `.lan`, nom sans point…).
 */
export function hostProblem(input: URL | string): HostProblem | null {
  let url: URL;
  try { url = input instanceof URL ? input : new URL(String(input)); } catch { return "invalid"; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "scheme";
  if (url.username || url.password) return "credentials";
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return "port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return "invalid";
  if (host.startsWith("[") || host.includes(":")) return "address";
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return "address"; // 127.0.0.1, 2130706433, 0x7f000001… (l'analyseur d'adresses les normalise déjà)
  if (!host.includes(".") || host === "localhost" || INTERNAL_SUFFIX.test(host)) return "internal";
  if (!/^[a-z0-9._-]+$/.test(host)) return "invalid"; // adresses internationales : déjà converties en « xn-- » par l'analyseur
  return null;
}

const v4 = (s: string): number[] | null => {
  const p = s.split(".");
  if (p.length !== 4) return null;
  const n = p.map(Number);
  return n.every((x, i) => /^\d{1,3}$/.test(p[i]!) && x >= 0 && x <= 255) ? n : null;
};

/** Une adresse numérique (celle que renvoie la résolution du nom) est-elle privée, locale, partagée ou réservée ? Dans le doute : oui. */
export function addressIsPrivate(ip: string): boolean {
  const s = String(ip ?? "").toLowerCase().trim();
  const four = v4(s);
  if (four) {
    const [a, b, c] = four as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (!s.includes(":")) return true; // ni v4 ni v6 : on ne sait pas, on refuse
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return addressIsPrivate(mapped[1]!);
  const hexMapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hexMapped) { const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16); return addressIsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
  if (s === "::" || s === "::1") return true;
  const first = parseInt(s.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00 || (first === 0x2001 && /^2001:(0?db8|0{1,4}:)/.test(s)) || first === 0x2002 || first === 0x64;
}
