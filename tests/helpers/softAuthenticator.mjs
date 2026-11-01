// Un authentificateur WebAuthn logiciel, pour tester le serveur sans appareil : fabrique de VRAIES réponses (attestation « none », assertions ES256).
import crypto from "node:crypto";

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

/** CBOR minimal : entiers, octets, texte, tableaux associatifs — tout ce qu'une attestation « none » contient. */
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
export function cbor(v) {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const t = Buffer.from(v); return Buffer.concat([head(3, t.length), t]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, val]) => [cbor(k), cbor(val)])]);
}

export function makeAuthenticator({ rpID, origin }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = crypto.randomBytes(32);
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  let counter = 0;
  const rpIdHash = (id) => sha256(id ?? rpID);
  const flagsOf = (o) => (o.up === false ? 0 : 0x01) | (o.uv === false ? 0 : 0x04);
  const clientData = (type, challenge, o) => Buffer.from(JSON.stringify({ type, challenge, origin: o.origin ?? origin, crossOrigin: false }));
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const self = {
    credentialId: b64(credentialId),
    /** Réponse à navigator.credentials.create() */
    register(challenge, o = {}) {
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([rpIdHash(o.rpID), Buffer.from([flagsOf(o) | 0x40]), u32(counter), Buffer.alloc(16), idLen, credentialId, cose]);
      const attestationObject = cbor({ fmt: "none", attStmt: {}, authData });
      return { id: self.credentialId, rawId: self.credentialId, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(clientData("webauthn.create", challenge, o)), attestationObject: b64(attestationObject), transports: ["internal"] } };
    },
    /** Réponse à navigator.credentials.get() */
    assert(challenge, o = {}) {
      counter = o.counter ?? counter + 1;
      const authData = Buffer.concat([rpIdHash(o.rpID), Buffer.from([flagsOf(o)]), u32(counter)]);
      const cd = clientData("webauthn.get", challenge, o);
      const signer = o.key ?? privateKey;
      const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(cd)]), signer);
      return { id: self.credentialId, rawId: self.credentialId, type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(cd), authenticatorData: b64(authData), signature: b64(signature), userHandle: o.userHandle } };
    },
  };
  return self;
}
export const otherKey = () => crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
