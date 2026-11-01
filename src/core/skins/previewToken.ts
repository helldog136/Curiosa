/**
 * LIEN D'APERÇU d'un skin (docs/SKINS.md §10.3) : la page Apparence montre la vraie page du site avec un skin, AVANT de l'activer et sans rien enregistrer.
 *
 * Mécanisme : l'administration fabrique une adresse `<page du site>?curiosa_skin_preview=<jeton>` (dans une fenêtre intégrée à la page Apparence). Le proxy
 * ne fait que recopier ce paramètre dans un en-tête interne ; le gabarit du site vérifie le jeton (signature + date) et compose alors le skin demandé, SANS
 * les retouches de la personne (c'est ce que donnerait « Utiliser ce skin ») et SANS rien écrire. Le jeton ne donne accès à rien de privé : le site public est
 * public ; il ne fait que choisir quel skin habille la page. Il vit quinze minutes ; la page porte `noindex`. Aucun cookie, aucun état sur le serveur.
 *
 * Fichier SANS Next ni base de données (le secret est passé par l'appelant) : testable seul.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SKIN_ID_RE } from "./allowlist";
import { BASIC_ID } from "./constants";

/** Paramètre d'adresse et en-tête interne (posé par le proxy, jamais cru s'il vient du visiteur : le proxy l'efface d'abord). */
export const PREVIEW_PARAM = "curiosa_skin_preview";
export const PREVIEW_HEADER = "x-curiosa-skin-preview";
export const PREVIEW_TTL_MS = 15 * 60_000;
/** Forme d'un jeton : `<skin>.<fin en base 36>.<signature>` (longueur bornée : le proxy ne transmet rien d'autre). */
export const PREVIEW_TOKEN_RE = /^[a-z][a-z0-9-]{0,40}\.[0-9a-z]{6,10}\.[A-Za-z0-9_-]{22}$/;

const mac = (secret: string, skinId: string, exp: string): string => createHmac("sha256", secret).update(`skin-preview|${skinId}|${exp}`).digest("base64url").slice(0, 22);

/** Fabrique le jeton d'aperçu de `skinId` (`basic` compris) pour quinze minutes. */
export function signPreview(skinId: string, secret: string, now = Date.now()): string {
  if (skinId !== BASIC_ID && !SKIN_ID_RE.test(skinId)) throw new Error("bad skin id");
  const exp = (now + PREVIEW_TTL_MS).toString(36);
  return `${skinId}.${exp}.${mac(secret, skinId, exp)}`;
}

/** Le skin que ce jeton demande, ou `null` (forme, signature ou date invalide). */
export function verifyPreview(token: unknown, secret: string, now = Date.now()): string | null {
  if (typeof token !== "string" || !PREVIEW_TOKEN_RE.test(token)) return null;
  const [id, exp, sig] = token.split(".") as [string, string, string];
  if (id !== BASIC_ID && !SKIN_ID_RE.test(id)) return null;
  const expected = Buffer.from(mac(secret, id, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const end = parseInt(exp, 36);
  if (!Number.isFinite(end) || end < now || end - now > PREVIEW_TTL_MS + 1000) return null;
  return id;
}

/** `?curiosa_skin_preview=…` ajouté à l'adresse d'une page du site (chemin commençant par « / »). */
export function previewUrl(path: string, token: string): string {
  const base = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${base}${base.includes("?") ? "&" : "?"}${PREVIEW_PARAM}=${token}`;
}
