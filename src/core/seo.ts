/**
 * RÉFÉRENCEMENT ET LISIBILITÉ POUR LES IA — fonctionnalités du cœur, indépendantes de toute donnée métier.
 *   - robots.txt : DEUX familles de robots IA, réglables séparément, JAMAIS un moteur de recherche classique.
 *       · robots d'ENTRAÎNEMENT : ils copient le site pour entraîner des modèles (aucun trafic en retour) → bloqués par défaut ;
 *       · robots de RÉPONSE : ils lisent une page pour répondre à une question et la citent → autorisés par défaut.
 *   - JSON-LD : le site et son éditeur (organisation ou personne), ses profils (`sameAs`), le fil d'Ariane des pages à chemin,
 *     et un petit assistant pour que les modules ajoutent leurs propres données structurées.
 *   - adresses canoniques, versions par langue (hreflang), cartes de partage (Open Graph, Twitter).
 * Ce fichier est PUR (aucun accès à la base) : les réglages sont lus dans seoSettings.ts.
 */

/**
 * Robots d'ENTRAÎNEMENT / de collecte pour modèles. Liste à REVOIR régulièrement (dernière relecture : octobre 2026) :
 * de nouveaux robots apparaissent, d'autres changent de rôle. En cas de doute sur un robot, il va dans cette famille
 * seulement s'il copie des pages sans jamais répondre à un utilisateur.
 */
export const AI_TRAINING_BOTS = [
  "GPTBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider",
  "Meta-ExternalAgent", "FacebookBot", "cohere-ai", "Amazonbot", "Diffbot", "ImagesiftBot", "Omgilibot", "Omgili", "Timpibot",
];

/**
 * Robots de RÉPONSE / de recherche IA : ils lisent une page pour répondre à un utilisateur (ou construire l'index d'un
 * moteur de réponse) et CITENT la source. Liste à REVOIR régulièrement (dernière relecture : octobre 2026).
 * Les « vues d'ensemble IA » de Google suivent le robot de recherche classique de Google : elles ne se règlent pas ici.
 */
export const AI_ANSWER_BOTS = [
  "OAI-SearchBot", "ChatGPT-User", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "DuckAssistBot",
  "MistralAI-User", "YouBot", "Meta-ExternalFetcher", "Amzn-SearchBot", "Amzn-User",
];

/** Les deux familles ensemble (ancien nom, gardé pour les outils qui l'importaient). */
export const AI_AND_SCRAPER_BOTS = [...AI_TRAINING_BOTS, ...AI_ANSWER_BOTS];

/** Ce que l'administrateur a ENREGISTRÉ (absent = jamais touché). `legacy` : l'ancien réglage unique « bloquer les robots IA ». */
export type StoredAiBlocking = { training?: unknown; answers?: unknown; legacy?: unknown };
export type AiBlocking = { blockTraining: boolean; blockAnswers: boolean };

/**
 * RÈGLE DE COMPATIBILITÉ (valeur enregistrée ou absente) :
 *   - une valeur propre à une famille, si elle est enregistrée, l'emporte ;
 *   - sinon, l'ancien réglage unique, s'il a été enregistré (vrai = bloquer les deux familles, faux = autoriser les deux) ;
 *   - sinon (réglage jamais touché) : entraînement bloqué, réponse autorisée.
 * Seuls les vrais booléens comptent : toute autre valeur est considérée comme absente.
 */
export function resolveAiBlocking(stored: StoredAiBlocking): AiBlocking {
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  const legacy = bool(stored.legacy);
  return { blockTraining: bool(stored.training) ?? legacy ?? true, blockAnswers: bool(stored.answers) ?? legacy ?? false };
}

export type RobotsRule = { userAgent: string; allow?: string; disallow?: string | string[] };
/** `true` / `false` seul : les deux familles ensemble (ancien comportement). */
export function robotsRules(blocking: AiBlocking | boolean): RobotsRule[] {
  const b = typeof blocking === "boolean" ? { blockTraining: blocking, blockAnswers: blocking } : blocking;
  return [
    { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/m/"] },
    ...(b.blockTraining ? AI_TRAINING_BOTS : []).map((userAgent) => ({ userAgent, disallow: "/" })),
    ...(b.blockAnswers ? AI_ANSWER_BOTS : []).map((userAgent) => ({ userAgent, disallow: "/" })),
  ];
}

const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");

/** JSON-LD inséré dans une balise <script> : `<` et les séparateurs de ligne sont échappés (un titre contenant `</script>` ne doit rien casser). */
export function jsonLd(json: unknown): string {
  return JSON.stringify(json).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");
}

export type SiteEntity = "organization" | "person";
export const isSiteEntity = (v: unknown): v is SiteEntity => v === "organization" || v === "person";

/** Profils du site : https seulement, sans doublon (sans tenir compte d'une « / » finale), 10 au plus. */
export const MAX_SAME_AS = 10;
export function sameAsList(links: readonly string[], max = MAX_SAME_AS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of links) {
    let u: URL;
    try { u = new URL(String(raw).trim()); } catch { continue; }
    if (u.protocol !== "https:" || u.username || u.password) continue;
    const href = u.href;
    const key = href.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(href);
    if (out.length >= max) break;
  }
  return out;
}

export type SiteJsonLdInput = {
  url: string; name: string; tagline: string; logo: string | null; locale: string;
  /** « Ce site est celui d'une personne / d'une organisation » ; absent = organisation (comportement d'origine). */
  entity?: SiteEntity;
  /** Adresses des profils (réseaux sociaux) ; filtrées par `sameAsList`. */
  sameAs?: readonly string[];
  /** Adresse canonique de la page d'accueil dans cette langue (par défaut `url`). */
  homeUrl?: string;
};

export function siteJsonLd(site: SiteJsonLdInput) {
  const abs = (v: string) => (/^https?:\/\//.test(v) ? v : `${site.url}${v}`);
  const home = site.homeUrl ?? site.url;
  const sameAs = sameAsList(site.sameAs ?? []);
  const person = site.entity === "person";
  const graph = [
    {
      "@type": person ? "Person" : "Organization",
      "@id": `${site.url}/#publisher`,
      name: site.name,
      url: site.url,
      ...(site.logo ? { [person ? "image" : "logo"]: abs(site.logo) } : {}),
      ...(site.tagline ? { description: site.tagline } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    },
    {
      "@type": "WebSite",
      "@id": `${site.url}/#website`,
      url: home,
      name: site.name,
      ...(site.tagline ? { description: site.tagline } : {}),
      publisher: { "@id": `${site.url}/#publisher` },
      inLanguage: site.locale,
    },
  ];
  return { "@context": "https://schema.org", "@graph": graph };
}

export type BreadcrumbItem = { name: string; url: string };
/** Le fil d'Ariane prêt à insérer dans une balise `application/ld+json` (avec `@context`), ou `null`. */
export function breadcrumbDocument(items: readonly BreadcrumbItem[]): Record<string, unknown> | null {
  const list = breadcrumbJsonLd(items);
  return list ? { "@context": "https://schema.org", ...list } : null;
}
/** Fil d'Ariane (schema.org `BreadcrumbList`) : deux niveaux au moins (accueil + la page), 8 au plus ; `null` sinon. */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): Record<string, unknown> | null {
  const clean = items.filter((i) => i.name.trim() && i.url).slice(0, 8);
  if (clean.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: clean.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.name.trim().slice(0, 200), item: i.url })),
  };
}

// ─── Adresses canoniques, langues, cartes de partage ─────────────────────────

/** Adresse publique d'une page dans une langue (`path` sans préfixe de langue, « / » pour l'accueil). */
export function pageUrl(site: string, locale: string, defaultLocale: string, path: string): string {
  const prefix = locale === defaultLocale ? "" : `/${locale}`;
  const clean = ("/" + path.replace(/[?#].*$/, "").replace(/^\/+/, "")).replace(/\/+$/, "");
  return `${site}${prefix}${clean === "" ? "/" : clean}`;
}

/** `canonical` + `hreflang` (dont `x-default` = langue par défaut) pour une page qui existe dans TOUTES les langues activées. */
export function languageAlternates(site: string, locales: readonly string[], locale: string, defaultLocale: string, path: string): { canonical: string; languages?: Record<string, string> } {
  const canonical = pageUrl(site, locale, defaultLocale, path);
  if (locales.length < 2) return { canonical };
  const languages: Record<string, string> = Object.fromEntries(locales.map((l) => [l, pageUrl(site, l, defaultLocale, path)]));
  languages["x-default"] = pageUrl(site, defaultLocale, defaultLocale, path);
  return { canonical, languages };
}

/** Open Graph + carte Twitter COHÉRENTS (mêmes titre, description, image, adresse). */
export function socialMeta(m: { siteName: string; title: string; description?: string; image?: string | null; url: string; type?: "website" | "article"; locale?: string }) {
  const images = m.image ? [m.image] : undefined;
  return {
    openGraph: { siteName: m.siteName, title: m.title, description: m.description, images, url: m.url, type: m.type ?? "website", ...(m.locale ? { locale: m.locale } : {}) },
    twitter: { card: images ? ("summary_large_image" as const) : ("summary" as const), title: m.title, description: m.description, images },
  };
}

// ─── JSON-LD des modules ─────────────────────────────────────────────────────

/** Types schema.org recommandés pour les modules (voir docs/CREATE-A-MODULE.md). */
export const RECOMMENDED_JSON_LD_TYPES = ["Article", "BlogPosting", "Event", "BroadcastEvent", "VideoObject", "Person", "FAQPage", "Product"] as const;
export const MAX_MODULE_JSON_LD = 20_000;

function limitValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.slice(0, 5000);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean" || v === null) return v;
  if (depth >= 8) return undefined;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => limitValue(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
      if (k === "__proto__") continue;
      const y = limitValue(x, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return undefined;
}

/**
 * Prépare le JSON-LD d'un module : un objet avec un `@type` (ou un `@graph`), `@context` ajouté s'il manque, valeurs bornées
 * (texte 5 000 caractères, 100 éléments par liste, 8 niveaux, 20 000 caractères au total). `null` si la donnée est inutilisable.
 */
export function moduleJsonLd(data: unknown): Record<string, unknown> | null {
  const v = limitValue(data, 0);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const typed = (typeof obj["@type"] === "string" && obj["@type"]) || Array.isArray(obj["@graph"]);
  if (!typed) return null;
  const out = { "@context": "https://schema.org", ...obj };
  return jsonLd(out).length > MAX_MODULE_JSON_LD ? null : out;
}
