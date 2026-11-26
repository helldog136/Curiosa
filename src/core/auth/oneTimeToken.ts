import crypto from "node:crypto";
import { getAuthSecret } from "../secret";

/**
 * ONE-TIME LINK TOKENS (invitations, password resets). A token is 256 bits from the system random generator, written in base64url (43 characters). Only a KEYED hash
 * (HMAC-SHA-256 with the site's secret, one label per use) is stored: a copy of the database alone never yields a working link, and a token of one kind never opens the other.
 * The hash is looked up by an exact, unique index; the stored hash and the computed one are also compared in constant time.
 * Nothing here logs, throws a message that contains a token, or keeps a token after it returns.
 */
export const TOKEN_BYTES = 32;
/** A token has exactly this shape; anything else is refused before the database is asked (and counts as a failed try). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type TokenKind = "invite" | "reset";

export const newToken = (): string => crypto.randomBytes(TOKEN_BYTES).toString("base64url");
export const looksLikeToken = (value: unknown): value is string => typeof value === "string" && TOKEN_RE.test(value);

export function hashToken(kind: TokenKind, token: string): string {
  return crypto.createHmac("sha256", getAuthSecret()).update(`one-time-link|${kind}|${token}`).digest("hex");
}

/** Constant-time comparison of two hex digests of equal length (false for anything else). */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex");
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}
