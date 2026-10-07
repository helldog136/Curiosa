/**
 * RÉFÉRENCEMENT — fonctionnalités du cœur, indépendantes de toute donnée métier.
 *   - robots.txt : bloque les robots d'entraînement / de collecte IA (aucun trafic utile, que de la charge), JAMAIS un moteur de recherche.
 *     Réglable (`seo.blockAiBots`, activé par défaut) dans les réglages avancés.
 *   - JSON-LD : un `WebSite` et son éditeur, pour que les moteurs comprennent de quel site il s'agit. Rien qui ne vienne des réglages du site.
 */
export const AI_AND_SCRAPER_BOTS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider",
  "PerplexityBot", "Amazonbot", "Diffbot", "ImagesiftBot", "Omgilibot", "Omgili", "FacebookBot", "Meta-ExternalAgent", "cohere-ai", "YouBot", "Timpibot",
];

export type RobotsRule = { userAgent: string; allow?: string; disallow?: string | string[] };
export function robotsRules(blockAi: boolean): RobotsRule[] {
  return [
    { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/m/"] },
    ...(blockAi ? AI_AND_SCRAPER_BOTS.map((userAgent) => ({ userAgent, disallow: "/" })) : []),
  ];
}

const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");

/** JSON-LD inséré dans une balise <script> : `<` et les séparateurs de ligne sont échappés (un titre contenant `</script>` ne doit rien casser). */
export function jsonLd(json: unknown): string {
  return JSON.stringify(json).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");
}

export function siteJsonLd(site: { url: string; name: string; tagline: string; logo: string | null; locale: string }) {
  const abs = (v: string) => (/^https?:\/\//.test(v) ? v : `${site.url}${v}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site.url}/#publisher`,
        name: site.name,
        url: site.url,
        ...(site.logo ? { logo: abs(site.logo) } : {}),
        ...(site.tagline ? { description: site.tagline } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${site.url}/#website`,
        url: site.url,
        name: site.name,
        ...(site.tagline ? { description: site.tagline } : {}),
        publisher: { "@id": `${site.url}/#publisher` },
        inLanguage: site.locale,
      },
    ],
  };
}
