/**
 * VISIBILITÉ DANS LES RÉPONSES DES IA — la liste de contrôles de la page d'admin « Visibilité dans les réponses des IA ».
 * Pure : l'état du site et les « sondes » (qui appellent robots.txt, le plan du site et llms.txt EN INTERNE, sans réseau) sont fournis.
 * Pas de note chiffrée : chaque point est « fait », « à faire » ou « pour information ».
 */
export type CheckStatus = "ok" | "todo" | "info";
export type VisibilityCheck = {
  id: string;
  status: CheckStatus;
  /** Réglage qui corrige le point (absent : rien à régler ici). */
  fix?: string;
  /** Variables de la phrase d'explication. */
  vars?: Record<string, string | number>;
};

export type VisibilityState = {
  blockAnswers: boolean;
  blockTraining: boolean;
  llmsEnabled: boolean;
  hasName: boolean;
  hasTagline: boolean;
  hasLogo: boolean;
  socialCount: number;
  mainLocale: string;
  otherLocales: string[];
  entity: "organization" | "person";
  feedItems: number;
};
/** Résultat des appels internes : `null` = n'a pas répondu correctement. */
export type VisibilityProbes = { robots: boolean; sitemapUrls: number | null; llms: { bytes: number } | null };

const SETTINGS_PRIVACY = "/admin/settings#privacy";
const SETTINGS_SITE = "/admin/settings#site";

export function computeChecks(s: VisibilityState, p: VisibilityProbes): VisibilityCheck[] {
  const ok = (v: boolean): CheckStatus => (v ? "ok" : "todo");
  return [
    { id: "answers", status: ok(!s.blockAnswers), fix: SETTINGS_PRIVACY },
    { id: "llms", status: ok(s.llmsEnabled && !!p.llms), fix: s.llmsEnabled ? undefined : SETTINGS_PRIVACY, vars: { size: p.llms ? Math.max(1, Math.round(p.llms.bytes / 1024)) : 0 } },
    { id: "robots", status: ok(p.robots) },
    { id: "sitemap", status: ok((p.sitemapUrls ?? 0) > 0), vars: { n: p.sitemapUrls ?? 0 } },
    { id: "description", status: ok(s.hasTagline), fix: SETTINGS_SITE },
    { id: "name", status: ok(s.hasName), fix: SETTINGS_SITE },
    { id: "logo", status: ok(s.hasLogo), fix: SETTINGS_SITE },
    { id: "social", status: ok(s.socialCount > 0), fix: "/admin/social", vars: { n: s.socialCount } },
    { id: "languages", status: "info", fix: "/admin/settings#languages", vars: { main: s.mainLocale, others: s.otherLocales.join(", "), count: s.otherLocales.length } },
    { id: "structured", status: "ok", fix: SETTINGS_SITE, vars: { kind: s.entity, n: s.socialCount } },
    { id: "rss", status: ok(s.feedItems > 0), vars: { n: s.feedItems } },
    { id: "training", status: "info", fix: SETTINGS_PRIVACY, vars: { blocked: s.blockTraining ? 1 : 0 } },
  ];
}

/** Nombre de points « à faire » : le seul chiffre affiché (un décompte, pas une note). */
export const todoCount = (checks: readonly VisibilityCheck[]) => checks.filter((c) => c.status === "todo").length;
