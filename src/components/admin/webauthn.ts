/**
 * Passerelle entre les options JSON du serveur et l'API WebAuthn du navigateur (qui veut des tampons binaires). Rien de cryptographique ici :
 * le navigateur et l'appareil signent, le serveur vérifie (bibliothèque de référence).
 */
const toBuffer = (b64url: string): ArrayBuffer => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64url = (buf: ArrayBuffer | null | undefined): string | undefined => {
  if (!buf) return undefined;
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const passkeysSupported = (): boolean => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

type Json = Record<string, unknown>;
const descriptors = (list: unknown) => (Array.isArray(list) ? list.map((c: Json) => ({ ...c, id: toBuffer(String(c.id)) })) : undefined);

/** Crée une clé d'accès (l'appareil demande empreinte, visage ou code). Renvoie la réponse au format attendu par le serveur. */
export async function createPasskey(options: Json): Promise<Json> {
  const publicKey = {
    ...options,
    challenge: toBuffer(String(options.challenge)),
    user: { ...(options.user as Json), id: toBuffer(String((options.user as Json).id)) },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject), transports: r.getTransports?.() ?? [] },
  };
}

/** Se connecte avec une clé d'accès (aucun e-mail à saisir : le navigateur propose les clés qu'il connaît pour ce site). */
export async function getPasskeyAssertion(options: Json): Promise<Json> {
  const publicKey = { ...options, challenge: toBuffer(String(options.challenge)), allowCredentials: descriptors(options.allowCredentials) } as unknown as PublicKeyCredentialRequestOptions;
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(), authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature), userHandle: toB64url(r.userHandle) },
  };
}
