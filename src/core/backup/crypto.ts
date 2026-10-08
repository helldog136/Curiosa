import crypto from "node:crypto";

/**
 * Chiffrement d'une sauvegarde — FORMAT STANDARD OPENSSL, pour qu'elle reste lisible sans ce framework :
 *
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in sauvegarde.tar.gz.enc -out sauvegarde.tar.gz
 *
 * Contenu du fichier : « Salted__ » + sel (8 octets) + données chiffrées en AES-256-CBC. La clé et le vecteur
 * viennent de PBKDF2-HMAC-SHA256 (600 000 itérations) appliqué au mot de passe et au sel, exactement comme `openssl enc -pbkdf2`.
 * Le mot de passe est choisi au moment de la sauvegarde ; il n'est stocké nulle part.
 */
export const KDF_ITERATIONS = 600_000;
const MAGIC = Buffer.from("Salted__");
export const MIN_PASSWORD_LENGTH = 10;

function derive(password: string, salt: Buffer, iterations: number) {
  const material = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 48, "sha256");
  return { key: material.subarray(0, 32), iv: material.subarray(32, 48) };
}

export function encryptBackup(plain: Buffer, password: string, iterations = KDF_ITERATIONS): Buffer {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password-too-short");
  const salt = crypto.randomBytes(8);
  const { key, iv } = derive(password, salt, iterations);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([MAGIC, salt, cipher.update(plain), cipher.final()]);
}

export type DecryptResult = { ok: true; plain: Buffer } | { ok: false; error: "not-a-backup" | "wrong-password" };

/** Déchiffre. Un mauvais mot de passe est signalé (padding invalide ou archive gzip illisible) ; on ne devine jamais. */
export function decryptBackup(data: Buffer, password: string, iterations = KDF_ITERATIONS): DecryptResult {
  if (data.length < 32 || !data.subarray(0, 8).equals(MAGIC)) return { ok: false, error: "not-a-backup" };
  const { key, iv } = derive(password, data.subarray(8, 16), iterations);
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    plain = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
  } catch {
    return { ok: false, error: "wrong-password" };
  }
  // Un mauvais mot de passe passe parfois le contrôle du bourrage (≈ 1 fois sur 256) : le contenu doit être un gzip.
  if (plain.length < 2 || plain[0] !== 0x1f || plain[1] !== 0x8b) return { ok: false, error: "wrong-password" };
  return { ok: true, plain };
}
