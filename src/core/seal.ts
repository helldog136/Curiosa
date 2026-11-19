import crypto from "node:crypto";
import { getAuthSecret } from "./secret";

/**
 * SEALING of a small secret kept in the database (0.42.0): AES-256-GCM, the key derived from a purpose label and the site secret (`AUTH_SECRET` or
 * `data/auth-secret`). The stored text is `iv.tag.body` (base64url). Two purposes never share a key, so a sealed value of one cannot be opened as another.
 * The site secret is NOT part of a backup: restored on another server, the value cannot be opened any more and `unseal` answers null (never an exception).
 */
const key = (purpose: string): Buffer => crypto.createHash("sha256").update(`${purpose}|${getAuthSecret()}`).digest();

export function seal(purpose: string, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(purpose: string, sealed: unknown): string | null {
  try {
    if (typeof sealed !== "string") return null;
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
    if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key(purpose), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch { return null; }
}
