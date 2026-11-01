import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "../db";

/**
 * CLÉS D'ACCÈS (passkeys, WebAuthn). On se connecte avec l'empreinte, le visage, le code de l'appareil ou une clé de sécurité : pas de mot de passe, pas de code.
 * La clé PRIVÉE reste dans l'appareil ; le site ne garde que la clé publique. Une clé d'accès est « à double facteur » à elle seule (l'appareil + la preuve que
 * c'est bien vous : la vérification de l'utilisateur est EXIGÉE), donc elle ouvre la session sans demander le code de la double vérification.
 * La cryptographie est faite par la bibliothèque de référence @simplewebauthn/server, jamais à la main.
 */
export const MAX_PASSKEYS = 10;
const CHALLENGE_TTL_MS = 5 * 60_000;

/** Le « domaine » et l'adresse du site telles que le navigateur les voit : une clé d'accès n'est valable que pour CE domaine (impossible à hameçonner). */
export type Relying = { rpID: string; origin: string; rpName: string };
export function relyingParty(siteUrl: string, rpName: string, requestOrigin?: string | null): Relying {
  // SITE_URL (réglé dans .env) fait foi ; à défaut, l'adresse de la requête (l'en-tête Host posé par le reverse proxy)
  const explicit = !/^https?:\/\/localhost(:\d+)?$/.test(siteUrl);
  const url = new URL(explicit || !requestOrigin ? siteUrl : requestOrigin);
  return { rpID: url.hostname, origin: url.origin, rpName: rpName || "Curiosa" };
}

async function newChallenge(purpose: "register" | "login", challenge: string, userId: string | null, now = new Date()): Promise<string> {
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  const row = await prisma.passkeyChallenge.create({ data: { challenge, purpose, userId, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) } });
  return row.id;
}

/** Le défi est lu ET détruit : il ne sert jamais deux fois. */
async function takeChallenge(id: string, purpose: "register" | "login", userId: string | null, now = new Date()): Promise<string | null> {
  const row = await prisma.passkeyChallenge.findUnique({ where: { id: String(id ?? "") } });
  if (!row) return null;
  const gone = await prisma.passkeyChallenge.deleteMany({ where: { id: row.id } });
  if (gone.count !== 1 || row.purpose !== purpose || row.expiresAt < now || (row.userId ?? null) !== userId) return null;
  return row.challenge;
}

/* ───────────── Enregistrer une clé d'accès (personne connectée) ───────────── */

export async function startRegistration(userId: string, rp: Relying): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string } | { error: "max" | "unknown" }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { passkeys: true } });
  if (!user) return { error: "unknown" };
  if (user.passkeys.length >= MAX_PASSKEYS) return { error: "max" };
  const options = await generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpID, userName: user.email, userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports ? p.transports.split(",") : undefined })),
    // « required » : la clé d'accès est retrouvée sans taper son e-mail, et prouve que c'est bien la personne (empreinte, visage, code de l'appareil)
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { options, challengeId: await newChallenge("register", options.challenge, userId) };
}

export async function finishRegistration(userId: string, challengeId: string, response: RegistrationResponseJSON, name: string, rp: Relying): Promise<{ ok: true } | { ok: false }> {
  const challenge = await takeChallenge(challengeId, "register", userId);
  if (!challenge) return { ok: false };
  let verified;
  try {
    verified = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true });
  } catch { return { ok: false }; }
  if (!verified.verified || !verified.registrationInfo) return { ok: false };
  const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
  if ((await prisma.passkey.count({ where: { userId } })) >= MAX_PASSKEYS) return { ok: false };
  try {
    await prisma.passkey.create({ data: {
      userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter,
      transports: (response.response.transports ?? []).join(",") || null, name: cleanName(name), deviceType: credentialDeviceType, backedUp: credentialBackedUp,
    } });
  } catch { return { ok: false }; } // clé déjà enregistrée
  return { ok: true };
}

const cleanName = (name: string): string => String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) || "Clé d'accès";

/* ───────────── Se connecter avec une clé d'accès ───────────── */

export async function startLogin(rp: Relying): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }> {
  // pas de liste de clés : le navigateur propose celles qu'il connaît pour ce site (aucune fuite sur les comptes existants)
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  return { options, challengeId: await newChallenge("login", options.challenge, null) };
}

/** Renvoie le compte dont la clé d'accès vient de signer le défi, sinon null. */
export async function finishLogin(challengeId: string, response: AuthenticationResponseJSON, rp: Relying): Promise<{ userId: string; email: string } | null> {
  const challenge = await takeChallenge(challengeId, "login", null);
  if (!challenge) return null;
  const key = await prisma.passkey.findUnique({ where: { credentialId: String(response?.id ?? "") }, include: { user: true } });
  if (!key) return null;
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: key.counter, transports: key.transports ? key.transports.split(",") : undefined },
    });
  } catch { return null; }
  if (!verified.verified) return null;
  await prisma.passkey.update({ where: { id: key.id }, data: { counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date(), backedUp: verified.authenticationInfo.credentialBackedUp } });
  return { userId: key.userId, email: key.user.email };
}

/* ───────────── Gérer ses clés ───────────── */

export const listPasskeys = (userId: string) =>
  prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true, lastUsedAt: true, deviceType: true, backedUp: true } });

export const countPasskeys = (userId: string) => prisma.passkey.count({ where: { userId } });

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const r = await prisma.passkey.deleteMany({ where: { id, userId } });
  return r.count === 1;
}

export async function renamePasskey(userId: string, id: string, name: string): Promise<boolean> {
  const r = await prisma.passkey.updateMany({ where: { id, userId }, data: { name: cleanName(name) } });
  return r.count === 1;
}
