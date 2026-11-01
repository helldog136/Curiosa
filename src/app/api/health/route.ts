// Contrôle de santé léger, utilisé par la mise à jour pour savoir si le NOUVEAU serveur répond : l'en-tête X-Curiosa-Version (empreinte de la version,
// posée par next.config.mjs au build) distingue un ancien serveur resté en mémoire du nouveau. Aucun accès à la base, aucune donnée du site.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
