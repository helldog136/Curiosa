/**
 * CATALOGUE DES SERVICES DU CŒUR — les helpers que la plateforme offre, indépendamment de toute
 * fonctionnalité. Un service est générique : il ne connaît ni un module en particulier ni le contenu
 * éditorial. Ce qui est *fait avec* un service (un overlay qui affiche un QR, un module qui
 * expose des actions MCP) est une fonctionnalité, donc un module.
 *
 * Les règles de séparation sont vérifiées par tests/architecture.test.mjs.
 * Documentation : docs/PLATFORM.md.
 */
export type PlatformService = {
  id: string;
  /** Comment un module l'utilise ; null = le module le déclare, le cœur l'exécute. */
  exposedAs: string | null;
  where: string;
  summary: string;
};

export const PLATFORM_SERVICES: PlatformService[] = [
  { id: "qr", exposedAs: "ctx.api.qr(texte)", where: "services/qr.ts", summary: "Génère un QR code en SVG (fond transparent)." },
  { id: "store", exposedAs: "ctx.api.store", where: "services/store.ts", summary: "Stockage privé par instance : collections de documents JSON." },
  { id: "topics", exposedAs: "ctx.api.topics.collect(sujet)", where: "services/topics.ts", summary: "Échange d'informations typées entre modules (consommateurs ↔ fournisseurs, abonnements, validation)." },
  { id: "mcp", exposedAs: null, where: "services/mcp/", summary: "Serveur MCP : jetons, portées, validation, audit, interrupteur. Les modules déclarent `mcp`, le cœur expose." },
  { id: "uploads", exposedAs: "réglage de type « image », champ « image » des formulaires d'admin", where: "services/uploads.ts", summary: "Envoi et service d'images (signature vérifiée, SVG refusé)." },
];
