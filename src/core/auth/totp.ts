import crypto from "node:crypto";

/**
 * CODE À USAGE UNIQUE (TOTP, RFC 6238) : celui qu'affichent Google Authenticator, Authy, 1Password… Six chiffres, renouvelés toutes les 30 secondes.
 * Écrit avec le seul module `crypto` de Node : aucune dépendance de plus.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = "", out = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = "";
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Une clé de 160 bits, au format que les applications savent lire (32 caractères). */
export const generateSecret = (): string => base32Encode(crypto.randomBytes(20));

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepOf = (now: number): number => Math.floor(now / 1000 / STEP_SECONDS);
export const codeAt = (secretB32: string, step: number): string => hotp(base32Decode(secretB32), step);

const same = (a: string, b: string): boolean => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Le code saisi est-il bon ? Tolère un pas d'avance ou de retard (horloge du téléphone un peu décalée). Renvoie le pas accepté, ou null.
 * `afterStep` : dernier pas déjà accepté pour ce compte — un code ne sert jamais deux fois, même dans sa fenêtre de validité.
 */
export function verifyTotp(secretB32: string, input: string, opts: { now?: number; window?: number; afterStep?: number | null } = {}): number | null {
  const code = input.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const current = stepOf(opts.now ?? Date.now());
  const window = opts.window ?? 1;
  const after = opts.afterStep ?? -1;
  let matched: number | null = null;
  for (let s = current - window; s <= current + window; s++) {
    // on teste TOUS les pas (pas de sortie anticipée) : la durée ne dit pas lequel était bon
    if (same(hotp(secret, s), code) && s > after) matched = matched === null ? s : Math.max(matched, s);
  }
  return matched;
}

/** Adresse lue par l'application quand on scanne le QR code. */
export function otpauthUri(opts: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  return `otpauth://totp/${label}?secret=${opts.secret}&issuer=${encodeURIComponent(opts.issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
