/**
 * TABLEAU DE BORD — « À faire » : tout ce qui attend une action de CETTE personne, avec un bouton « Ouvrir → ». Les tâches que les extensions déclarent (avis à valider, messages…)
 * viennent de modules.ts et se placent à la suite ; ici, celles du cœur : brouillons à finir (avec leurs titres), demandes d'assistants à approuver, mises à jour (site, extensions, skins),
 * sauvegarde trop ancienne, problèmes de santé, extensions à régler, pastilles historiques des extensions (`adminBadge`).
 *
 * Chaque source est lue À L'AFFICHAGE, isolée des autres (une source en échec disparaît, jamais le tableau de bord), sans réseau (rapports déjà gardés) ou avec un délai de 1,5 s.
 * Chaque tâche n'apparaît que si la personne a le droit d'agir dessus : aucun droit élargi.
 */
import { prisma } from "../db";
import { stateWhere } from "../content/adminList";
import { can, hasRole, type AdminUser } from "../auth/access";
import { withDeadline, TIMED_OUT } from "../deadline";
import type { Translator } from "../i18n/dictionary";
import { maintenanceSummary } from "../maintenance/summary";
import { glance } from "../maintenance/inspect";
import { EXTENSIONS_UPDATES_HREF } from "../modules/extensionsLinks";
import { assistantsTabHref } from "../services/mcp/assistantsLinks";
import { getUpdateCheck } from "../updates/service";
import { DASHBOARD_LIMITS } from "./spec";
import { APPEARANCE_HREF, BACKUP_HREF, DRAFTS_HREF, UPDATES_HREF, entriesHref, entryHref, instanceHref } from "@/core/adminLinks";

export const TODO_LIMITS = { draftRows: 5, readMs: DASHBOARD_LIMITS.timeoutMs } as const;

export type TodoRow = { title: string; detail?: string; href: string };
export type TodoItem = {
  id: string;
  kind: "drafts" | "ai" | "update-core" | "update-modules" | "update-skins" | "backup" | "setup" | "badge" | "module";
  icon: string;
  /** La phrase, prête à afficher. */
  label: string;
  /** Une précision courte sous la phrase. */
  detail?: string;
  /** Le nombre, quand il y en a un (pastille). */
  count?: number;
  /** « Ouvrir → » mène ici. */
  href: string;
  /** Lignes à montrer sous la phrase (les brouillons et leurs titres). */
  rows?: TodoRow[];
};

/** Ce que le tableau de bord sait déjà des extensions (le menu d'administration l'a calculé pour cette requête). */
export type TodoNavItem = { id: string; key: string; name: string; icon: string; content: boolean; error: boolean; badge: number; moduleId: string };

export type TodoEnv = {
  user: AdminUser;
  t: Translator;
  locale: string;
  defaultLocale: string;
  nav: readonly TodoNavItem[];
  /** Le tableau de bord montre déjà le bloc « À finir » (brouillons avec leurs titres) : ne pas les répéter dans « À faire ». */
  skipDrafts?: boolean;
  /** Extensions à régler (nom → résumé de ce qu'il reste à renseigner), lu par la page pour qui règle les extensions. */
  toSetUp?: readonly { id: string; name: string; icon: string; summary: string }[];
};

/** Lit une source avec un délai ; un délai dépassé ou une exception donne `fallback` (la source disparaît, le reste s'affiche). */
async function within<T>(work: () => Promise<T>, fallback: T, ms: number = TODO_LIMITS.readMs): Promise<T> {
  try { const r = await withDeadline(work, ms); return r === TIMED_OUT ? fallback : r; } catch { return fallback; }
}

// ── Brouillons à finir ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Brouillons = pas publié (même règle que les listes d'entrées de l'administration). Seules comptent les extensions dont la liste existe et n'est pas en erreur. */
export async function draftsToFinish(env: Pick<TodoEnv, "nav" | "locale" | "defaultLocale">, limit: number = TODO_LIMITS.draftRows): Promise<{ total: number; rows: (TodoRow & { instanceKey: string })[]; byKey: Map<string, number> }> {
  const items = env.nav.filter((i) => i.content && !i.error);
  if (items.length === 0) return { total: 0, rows: [], byKey: new Map() };
  const ids = items.map((i) => i.id);
  const where = { AND: [{ instanceId: { in: ids } }, stateWhere("draft", new Date())] };
  const [grouped, latest] = await Promise.all([
    prisma.entry.groupBy({ by: ["instanceId"], where, _count: { _all: true } }),
    prisma.entry.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, include: { translations: { select: { locale: true, title: true } } } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const total = grouped.reduce((n, g) => n + g._count._all, 0);
  const byKey = new Map(grouped.flatMap((g) => { const it = byId.get(g.instanceId); return it ? [[it.key, g._count._all] as [string, number]] : []; }));
  const rows = latest.flatMap((e) => {
    const it = byId.get(e.instanceId);
    if (!it) return [];
    const title = (e.translations.find((x) => x.locale === env.locale) ?? e.translations.find((x) => x.locale === env.defaultLocale) ?? e.translations[0])?.title?.trim();
    return [{ title: title || "…", detail: it.name, href: entryHref(e.id), instanceKey: it.key }];
  });
  return { total, rows, byKey };
}

// ── Mises à jour ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function skinsBehind(): Promise<number> {
  const { listCatalogue } = await import("../skins/service");
  const list = await listCatalogue();
  return list.items.filter((i) => i.installed && i.updateAvailable).length;
}

// ── L'ensemble ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les tâches du cœur de cette personne, dans l'ordre où l'on y pense : ce qui bloque d'abord, puis ce qui se finit, puis ce qui se met à jour. */
export async function loadCoreTodo(env: TodoEnv): Promise<TodoItem[]> {
  const { user, t } = env;
  const admin = hasRole(user, "admin");
  const [drafts, ai, core, modules, skins, backup] = await Promise.all([
    can(user, "core:entries.edit") && !env.skipDrafts ? within(() => draftsToFinish(env), null) : Promise.resolve(null),
    can(user, "core:mcp.tokens") ? within(() => maintenanceSummary(), null) : Promise.resolve(null),
    can(user, "core:updates") ? within(() => getUpdateCheck(), null) : Promise.resolve(null),
    can(user, "core:updates") || admin ? within(async () => (await import("../modules/updateStatus")).peekModulesReport(), null) : Promise.resolve(null),
    can(user, "core:updates") ? within(() => skinsBehind(), 0) : Promise.resolve(0),
    can(user, "core:backup") ? within(() => glance(), null) : Promise.resolve(null),
  ]);
  const out: TodoItem[] = [];

  if (ai && ai.pending > 0) out.push({ id: "ai", kind: "ai", icon: "🤖", label: t("dash.todo.ai", { n: ai.pending }), count: ai.pending, href: assistantsTabHref("requests") });
  for (const s of env.toSetUp ?? []) out.push({ id: `setup-${s.id}`, kind: "setup", icon: s.icon, label: t("dash.todo.setup", { name: s.name }), detail: s.summary, href: instanceHref(s.id) });
  if (drafts && drafts.total > 0) {
    out.push({
      id: "drafts", kind: "drafts", icon: "📝", label: t("dash.todo.drafts", { n: drafts.total }), count: drafts.total, rows: drafts.rows.map((r) => ({ title: r.title, ...(r.detail ? { detail: r.detail } : {}), href: r.href })),
      // La page qui rassemble les brouillons de toutes les extensions.
      href: DRAFTS_HREF,
    });
  }
  if (backup && !backup.backup.recent) out.push({ id: "backup", kind: "backup", icon: "💾", label: t(backup.backup.at ? "dash.todo.backupOld" : "dash.todo.backupNever"), href: BACKUP_HREF });
  if (core?.available && core.latest) out.push({ id: "update-core", kind: "update-core", icon: "⬆️", label: t("dash.todo.updateCore", { version: core.latest.replace(/^v/, "") }), href: UPDATES_HREF });
  const behind = modules?.outdated.length ?? 0;
  if (behind > 0) out.push({ id: "update-modules", kind: "update-modules", icon: "🧩", label: t("dash.todo.updateModules", { n: behind }), count: behind, href: EXTENSIONS_UPDATES_HREF });
  if (skins > 0) out.push({ id: "update-skins", kind: "update-skins", icon: "🎨", label: t("dash.todo.updateSkins", { n: skins }), count: skins, href: APPEARANCE_HREF });
  for (const i of env.nav) if (i.badge > 0 && !i.error) out.push({ id: `badge-${i.id}`, kind: "badge", icon: i.icon, label: t("dash.todo.badge", { n: i.badge, name: i.name }), count: i.badge, href: i.content ? entriesHref(i.key) : instanceHref(i.id) });
  return out;
}

/** Ajoute les tâches des extensions à celles du cœur : les nôtres d'abord (elles bloquent), puis celles des extensions. Pur. */
export function mergeTodo(core: readonly TodoItem[], modules: readonly { moduleId: string; id: string; icon: string; label: string; n: number; href: string }[]): TodoItem[] {
  return [...core, ...modules.map((m): TodoItem => ({ id: `module-${m.moduleId}-${m.id}`, kind: "module", icon: m.icon, label: m.label, count: m.n, href: m.href }))];
}

