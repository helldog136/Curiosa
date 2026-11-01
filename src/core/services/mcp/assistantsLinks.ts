/**
 * Adresses de la section « Assistants IA » de l'admin, et correspondance avec les anciennes pages (API & MCP, Maintenance par IA).
 * Logique pure (aucune dépendance) : toutes les pages, actions, e-mails et redirections passent par ici, aucune adresse n'est écrite ailleurs.
 */
export const ASSISTANTS_HREF = "/admin/assistants";

/** Les trois vues de la page, dans l'ordre d'affichage. */
export const ASSISTANT_TABS = ["access", "requests", "history"] as const;
export type AssistantTab = (typeof ASSISTANT_TABS)[number];

/** Un onglet inconnu ou absent ouvre toujours « Accès » : une adresse périmée ne mène jamais à une page vide. */
export function parseTab(value: unknown): AssistantTab {
  const v = Array.isArray(value) ? value[0] : value;
  return ASSISTANT_TABS.find((t) => t === v) ?? "access";
}

/** Adresse d'un onglet ; « Accès » est la vue par défaut, donc sans paramètre. */
export function assistantsTabHref(tab: AssistantTab, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (tab !== "access") q.set("tab", tab);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `${ASSISTANTS_HREF}?${s}` : ASSISTANTS_HREF;
}

/** Page d'un accès. */
export function accessHref(id: string): string {
  return `${ASSISTANTS_HREF}/${encodeURIComponent(id)}`;
}

/** Formulaire de création (ancre conservée), éventuellement avec le type « Maintenance » déjà choisi. */
export function newAccessHref(maintenance = false): string {
  return `${maintenance ? `${ASSISTANTS_HREF}?profile=maintenance` : ASSISTANTS_HREF}#new-token`;
}

export type RawQuery = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Avertissements que la vue « Demandes à valider » sait afficher (liste fermée : rien d'autre ne passe dans l'adresse). */
export const REQUEST_NOTICES = ["busy", "expired", "not-pending", "unknown", "forbidden"] as const;

/**
 * Anciennes adresses → nouvelle vue, paramètres utiles conservés :
 *   /admin/mcp                → Assistants IA › Accès (?profile=maintenance conservé)
 *   /admin/mcp/<id>           → page de cet accès
 *   /admin/maintenance-ia     → Assistants IA › Demandes à valider (?notice=… conservé)
 * Null pour une adresse qui n'est pas une ancienne page.
 */
export function legacyAssistantsTarget(pathname: string, query: RawQuery = {}): string | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/admin/mcp") return first(query.profile) === "maintenance" ? `${ASSISTANTS_HREF}?profile=maintenance` : ASSISTANTS_HREF;
  const one = /^\/admin\/mcp\/([^/]+)$/.exec(path);
  if (one) return `${ASSISTANTS_HREF}/${one[1]}`;
  if (path === "/admin/maintenance-ia") {
    const notice = REQUEST_NOTICES.find((n) => n === first(query.notice));
    return assistantsTabHref("requests", notice ? { notice } : {});
  }
  return null;
}
