import crypto from "node:crypto";
import { promisify } from "node:util";
import { CHUNK_BYTES, runAsync, runSync, type Steps } from "./steps";

const pbkdf2 = promisify(crypto.pbkdf2);

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

const split = (material: Buffer) => ({ key: material.subarray(0, 32), iv: material.subarray(32, 48) });
function derive(password: string, salt: Buffer, iterations: number) {
  return split(crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 48, "sha256"));
}
/** Même dérivation, dans le pool de threads de Node : la boucle d'événements n'est pas bloquée (600 000 itérations ≈ 0,3 s de calcul). */
async function deriveAsync(password: string, salt: Buffer, iterations: number) {
  return split(await pbkdf2(Buffer.from(password, "utf8"), salt, iterations, 48, "sha256"));
}

/** Chiffre ou déchiffre par morceaux de 1 Mo (AES-CBC se traite en continu : même résultat qu'en un seul bloc). */
function* transform(cipher: crypto.Cipher | crypto.Decipher, data: Buffer): Steps<Buffer> {
  const out: Buffer[] = [];
  for (let i = 0; i < data.length; i += CHUNK_BYTES) { out.push(cipher.update(data.subarray(i, i + CHUNK_BYTES))); yield; }
  out.push(cipher.final());
  return Buffer.concat(out);
}

function* encryptSteps(plain: Buffer, key: Buffer, iv: Buffer, salt: Buffer): Steps<Buffer> {
  return Buffer.concat([MAGIC, salt, yield* transform(crypto.createCipheriv("aes-256-cbc", key, iv), plain)]);
}

export async function encryptBackupAsync(plain: Buffer, password: string, iterations = KDF_ITERATIONS): Promise<Buffer> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password-too-short");
  const salt = crypto.randomBytes(8);
  const { key, iv } = await deriveAsync(password, salt, iterations);
  return runAsync(encryptSteps(plain, key, iv, salt));
}

export function encryptBackup(plain: Buffer, password: string, iterations = KDF_ITERATIONS): Buffer {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password-too-short");
  const salt = crypto.randomBytes(8);
  const { key, iv } = derive(password, salt, iterations);
  return runSync(encryptSteps(plain, key, iv, salt));
}

export type DecryptResult = { ok: true; plain: Buffer } | { ok: false; error: "not-a-backup" | "wrong-password" };

function finish(plain: Buffer): DecryptResult {
  // Un mauvais mot de passe passe parfois le contrôle du bourrage (≈ 1 fois sur 256) : le contenu doit être un gzip.
  if (plain.length < 2 || plain[0] !== 0x1f || plain[1] !== 0x8b) return { ok: false, error: "wrong-password" };
  return { ok: true, plain };
}
const isBackup = (data: Buffer) => data.length >= 32 && data.subarray(0, 8).equals(MAGIC);

/** Déchiffre. Un mauvais mot de passe est signalé (padding invalide ou archive gzip illisible) ; on ne devine jamais. */
export function decryptBackup(data: Buffer, password: string, iterations = KDF_ITERATIONS): DecryptResult {
  if (!isBackup(data)) return { ok: false, error: "not-a-backup" };
  const { key, iv } = derive(password, data.subarray(8, 16), iterations);
  try { return finish(runSync(transform(crypto.createDecipheriv("aes-256-cbc", key, iv), data.subarray(16)))); } catch { return { ok: false, error: "wrong-password" }; }
}

/** Version qui ne bloque pas la boucle d'événements (même format, mêmes résultats). */
export async function decryptBackupAsync(data: Buffer, password: string, iterations = KDF_ITERATIONS): Promise<DecryptResult> {
  if (!isBackup(data)) return { ok: false, error: "not-a-backup" };
  const { key, iv } = await deriveAsync(password, data.subarray(8, 16), iterations);
  try { return finish(await runAsync(transform(crypto.createDecipheriv("aes-256-cbc", key, iv), data.subarray(16)))); } catch { return { ok: false, error: "wrong-password" }; }
}
