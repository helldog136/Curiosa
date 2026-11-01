import { headers } from "next/headers";
import { siteUrl } from "../config";
import { getSiteConfig } from "../settings";
import { relyingParty, type Relying } from "./passkeys";

/** Le domaine du site pour les clés d'accès : SITE_URL (réglé dans .env) ; à défaut, l'adresse par laquelle la requête est arrivée (derrière le reverse proxy). */
export async function currentRelying(): Promise<Relying> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
  const requestOrigin = host && /^[a-z0-9.:\[\]-]+$/i.test(host) ? `${proto === "https" ? "https" : "http"}://${host}` : null;
  return relyingParty(siteUrl, (await getSiteConfig()).name, requestOrigin);
}
