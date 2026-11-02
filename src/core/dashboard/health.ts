/**
 * TABLEAU DE BORD — « Santé » : UNE pastille, « Tout va bien » ou « n points à vérifier ». Les points viennent de ce que le site sait déjà (coup d'œil de la maintenance,
 * résumé du dernier contrôle du contenu) : aucun réseau, aucun module appelé. Chaque point dit quoi faire et mène à l'écran qui le règle, ou à rien si la personne n'a pas le droit
 * d'y agir (le point reste visible : elle sait qu'il faut prévenir quelqu'un).
 */
import { hasRole, can, type AdminUser } from "../auth/access";
import { contentBadge } from "../maintenance/content/service";
import { glance } from "../maintenance/inspect";
import type { Translator } from "../i18n/dictionary";

export type HealthPoint = {
  id: "database" | "disk" | "update" | "instances" | "content" | "backup";
  /** `problem` : le site peut mal marcher ; `advice` : un conseil, rien d'urgent. */
  severity: "problem" | "advice";
  label: string;
  /** Où le régler (null : cette personne n'a pas d'écran pour cela). */
  href: string | null;
};
export type Health = { points: HealthPoint[]; ok: boolean; problems: number };

export type Glance = Awaited<ReturnType<typeof glance>>;
export type HealthFacts = { glance: Glance | null; contentLook: boolean };

/** Pur : les points de santé que CETTE personne a le droit de voir. */
export function healthPoints(user: AdminUser, facts: HealthFacts, t: Translator): HealthPoint[] {
  const out: HealthPoint[] = [];
  const g = facts.glance;
  const technical = can(user, "core:backup") || can(user, "core:updates");
  if (g && technical) {
    if (!g.databaseOk) out.push({ id: "database", severity: "problem", label: t("dash.health.database"), href: can(user, "core:backup") ? "/admin/backup" : null });
    if (g.disk === "critical" || g.disk === "low") out.push({ id: "disk", severity: "problem", label: t(g.disk === "critical" ? "dash.health.diskCritical" : "dash.health.diskLow"), href: null });
    if (g.updateFailed) out.push({ id: "update", severity: "problem", label: t("dash.health.update"), href: can(user, "core:updates") ? "/admin/updates" : null });
    if (!g.backup.recent && can(user, "core:backup")) out.push({ id: "backup", severity: "advice", label: t(g.backup.at ? "dash.health.backupOld" : "dash.health.backupNever"), href: "/admin/backup" });
  }
  if (g && hasRole(user, "admin") && g.instancesSetAside > 0) out.push({ id: "instances", severity: "problem", label: t("dash.health.instances", { n: g.instancesSetAside }), href: "/admin/extensions" });
  if (facts.contentLook && hasRole(user, "admin")) out.push({ id: "content", severity: "advice", label: t("dash.health.content"), href: "/admin/maintenance/content" });
  return out;
}

export function summarize(points: HealthPoint[]): Health {
  return { points, ok: points.length === 0, problems: points.filter((p) => p.severity === "problem").length };
}

/** Lit les faits (deux lectures locales, jamais d'exception) puis compose. */
export async function loadHealth(user: AdminUser, t: Translator): Promise<Health> {
  const needsGlance = can(user, "core:backup") || can(user, "core:updates") || hasRole(user, "admin");
  const [g, content] = await Promise.all([
    needsGlance ? glance().catch(() => null) : Promise.resolve(null),
    hasRole(user, "admin") ? contentBadge().catch(() => null) : Promise.resolve(null),
  ]);
  return summarize(healthPoints(user, { glance: g, contentLook: !!content?.look }, t));
}
