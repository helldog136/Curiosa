import crypto from "node:crypto";
import { getAuthSecret } from "../secret";

/**
 * ADRESSE SECRÈTE d'une page d'overlay. Le secret est tiré au hasard (192 bits). Il n'est JAMAIS stocké en clair : on garde son empreinte SHA-256 (pour retrouver
 * la page quand OBS la demande) et une copie chiffrée (AES-256-GCM, clé dérivée du secret du site) pour pouvoir recopier l'adresse dans l'administration.
 * Si le secret du site change, la copie devient illisible : l'administration propose alors « Changer l'adresse secrète » (jamais d'erreur). Rien ici n'est journalisé.
 */
export const SECRET_RE = /^[A-Za-z0-9_-]{32}$/;

export const newSecret = (): string => crypto.randomBytes(24).toString("base64url");
export const hashSecret = (secret: string): string => crypto.createHash("sha256").update(`overlay-page|${secret}`).digest("hex");

const key = (): Buffer => crypto.createHash("sha256").update(`overlay-page-seal|${getAuthSecret()}`).digest();

export function sealSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unsealSecret(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
    if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    const secret = Buffer.concat([d.update(body), d.final()]).toString("utf8");
    return SECRET_RE.test(secret) ? secret : null;
  } catch { return null; }
}

/** Les deux colonnes à écrire pour un secret. */
export const secretColumns = (secret: string): { secretHash: string; secretSealed: string } => ({ secretHash: hashSecret(secret), secretSealed: sealSecret(secret) });
