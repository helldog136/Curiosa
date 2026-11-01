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
  { id: "png", exposedAs: "ctx.api.png({ width, height, tree })", where: "services/render.ts", summary: "Rend une image PNG à partir d'une arborescence de boîtes (affiche, planning à partager…) ; les images distantes sont limitées aux adresses https publiques." },
  { id: "store", exposedAs: "ctx.api.store", where: "services/store.ts", summary: "Stockage privé par instance : collections de documents JSON." },
  { id: "topics", exposedAs: "ctx.api.topics.collect(sujet)", where: "services/topics.ts", summary: "Échange d'informations typées entre modules (consommateurs ↔ fournisseurs, abonnements, validation)." },
  { id: "mcp", exposedAs: null, where: "services/mcp/", summary: "Serveur MCP : jetons, portées, validation, audit, interrupteur. Les modules déclarent `mcp`, le cœur expose." },
  { id: "mail", exposedAs: "ctx.api.mail.send(…)", where: "services/mail.ts", summary: "Envoi d'e-mails au nom du site : SMTP réglé dans l'admin, expéditeur fixe, un destinataire, débit limité, audit." },
  { id: "rawg", exposedAs: "ctx.api.rawg.cover(titre), ctx.api.rawg.candidates(titre)", where: "services/rawgRelay.ts", summary: "DÉPRÉCIÉ depuis la 0.3.0 (permission « rawg ») : simple relais, sans repli, vers le service `game.cover` du module « Jaquettes de jeux », pour les modules d'avant qui ne le connaissent pas ; sans le module, `no-key`, jamais d'exception. La clé RAWG et les corrections appartiennent au module ; la reprise finale de celles que le cœur gardait encore (services/rawgHandover.ts) se fait toute seule, une fois, sans rien effacer. Préférez le service `game.cover`." },
  { id: "files", exposedAs: "ctx.api.files.claim(url) / remove(url)", where: "services/files.ts", summary: "Fichiers envoyés qu'un module garde et supprime : revendication par la personne qui vient de les envoyer (30 minutes, atomique), propriétaire = l'instance, suppression de l'original et des dérivés, plafond par module, audit, sauvegardé ; permission « files »." },
  { id: "privacy", exposedAs: "ctx.api.privacy.declarations()", where: "modules/privacyDeclarations.ts", summary: "Lecture seule des déclarations de vie privée des modules actifs (par langue, bornée, sans secret) ; permission « privacy »." },
  { id: "measured-links", exposedAs: "ctx.api.links.measured(url)", where: "redirectMeasure.ts", summary: "Adresse mesurée d'un bouton : le lien court actif de la destination quand la personne qui gère le site a activé « Compter les clics sur mes liens », sinon l'adresse inchangée." },
  { id: "visitor", exposedAs: "ctx.api.visitor.fingerprint(request, portée)", where: "modules/visitorFingerprint.ts", summary: "Empreinte salée, non réversible et cloisonnée de la personne qui visite (limites de débit des modules), sur l'adresse de confiance ; sel en mémoire renouvelé chaque jour." },
  { id: "net", exposedAs: "ctx.api.net.request({ url, … })", where: "services/net.ts", summary: "Client réseau neutre et borné, partagé par tous les modules : délai dur (borné par le temps restant d'une page publique), https seulement, pause après un 429 ou un quota épuisé (sans réseau jusqu'à la reprise), disjoncteur par hôte, déduplication des GET en cours, file bornée (refus immédiat au-delà), une seule reprise, journal sans secret, santé par hôte (bloc d'admin « netHealth »). Ne connaît aucun fournisseur." },
  { id: "scheduler", exposedAs: null, where: "services/scheduler.ts", summary: "Tâches planifiées : les modules déclarent `tasks`, le cœur les exécute (une par instance active, sans chevauchement, erreurs isolées, dernier résultat mémorisé)." },
  { id: "uploads", exposedAs: "réglage de type « image », champ « image » des formulaires d'admin", where: "services/uploads.ts", summary: "Envoi et service d'images (signature vérifiée, SVG refusé)." },
];
