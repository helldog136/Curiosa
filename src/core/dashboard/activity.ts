/**
 * TABLEAU DE BORD — « Ce qui s'est passé » : les derniers événements du Journal central, en phrases claires.
 *
 * Même source que la page « Journal d'audit » (table `AuditLog`, phrases de `describeRows`) ; rien n'est stocké en plus. Trois filtres, tous PURS et testés :
 *  1. DROITS (`eventNeed`) : une ligne n'est montrée qu'à qui peut ouvrir l'écran qu'elle concerne. Aucun droit n'est élargi : « Rédaction » voit ses contenus et ses liens courts,
 *     « Administration » les réglages, l'apparence et ses extensions (et l'historique des extensions dont elle a le droit `history`), « Coordination technique » et le propriétaire ce
 *     que leurs droits réservés ouvrent (sauvegardes, mises à jour, assistants, sécurité). Connexions, refus d'accès et gestion des comptes : sécurité (`core:security`) seulement.
 *  2. MODE SIMPLE (`isPlain`) : seulement ce qui parle à une personne qui n'est pas technique (contenus publiés, réglages, sauvegardes, mises à jour, extensions installées, événements
 *     non fréquents des extensions) ; les lignes d'assistants, de comptes, de connexion et les enregistrements répétés sont pour le mode avancé.
 *  3. DOUBLONS (`collapse`) : la même action de la même personne sur la même chose dans l'heure ne fait qu'une ligne.
 * Lecture bornée : 3 paquets de 50 lignes au plus (150 lignes) pour trouver les 10 lignes à montrer.
 */
import { prisma } from "../db";
import { accessGate, type AdminUser, type Need } from "../auth/access";
import { moduleRight, HISTORY } from "../auth/rights";
import type { AuditRow } from "../audit";
import { describeRows, type JournalLine } from "../journal/describe";
import { eventsOf } from "../journal/events";
import type { Translator } from "../i18n/dictionary";
import { getModule } from "../modules/registry";

export const ACTIVITY_LIMITS = { show: 10, batch: 50, batches: 3, collapseMs: 3600_000 } as const;

/** Ce qu'il faut pour voir une ligne du journal dans le tableau de bord. */
export function eventNeed(row: Pick<AuditRow, "action" | "module">): Need {
  if (row.module) return { right: moduleRight(row.module, HISTORY) ?? "core:security" };
  const a = row.action;
  if (/^(entry|redirect)\./.test(a)) return "editor";
  if (/^backup\./.test(a)) return { right: "core:backup" };
  if (/^update\./.test(a)) return { right: "core:updates" };
  if (/^mcp\.maintenance\./.test(a)) return { right: "core:mcp.tokens" };
  if (/^(home|navigation|appearance|skin|content\.check|settings\.update|module\.|instance\.|retired\.|core\.legacy)/.test(a)) return "admin";
  // Connexions, refus, comptes, rôles, double vérification, assistants (jetons) et tout ce qui n'est pas classé : sécurité.
  return { right: "core:security" };
}

export const canSeeEvent = (user: AdminUser, row: Pick<AuditRow, "action" | "module">): boolean => accessGate(user, eventNeed(row)) === "ok";

/** Lignes du cœur qui parlent à une personne non technique. */
const PLAIN_CORE = /^(entry\.(create|delete)|redirect\.(create|delete|managed\.create)|home\.update|navigation\.update|appearance\.update|skin\.(install|activate|update)|settings\.update|backup\.(create|restore)|update\.start|module\.(install|update|uninstall)|content\.check|mcp\.maintenance\.(approve|deny))$/;

/** Mode simple : la ligne est-elle assez claire ? `frequent` : l'événement est déclaré très fréquent par son module. */
export function isPlain(row: Pick<AuditRow, "action" | "module" | "level" | "actorKind">, info: { declared: boolean; frequent: boolean } | null): boolean {
  if (row.module) {
    if (row.level === "warn" || row.level === "error") return true;
    return !!info?.declared && !info.frequent && row.actorKind !== "assistant";
  }
  return PLAIN_CORE.test(row.action);
}

/** Une seule ligne pour la même action, de la même personne, sur la même chose, dans l'heure (l'ordre est du plus récent au plus ancien : on garde la plus récente). */
export function collapse<T extends { action: string; actor: string; target: string; module: string; createdAt: Date }>(rows: readonly T[], windowMs: number = ACTIVITY_LIMITS.collapseMs): T[] {
  const last = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    const key = `${r.module}|${r.action}|${r.actor}|${r.target}`;
    const seen = last.get(key);
    if (seen !== undefined && seen - r.createdAt.getTime() < windowMs) continue;
    last.set(key, r.createdAt.getTime());
    out.push(r);
  }
  return out;
}

export type ActivityOpts = { t: Translator; locale: string; defaultLocale: string; advanced: boolean; limit?: number };
export type Activity = { lines: JournalLine[]; /** Le Journal d'audit complet est ouvert à cette personne. */ fullJournal: boolean };

/** Les derniers événements que cette personne a le droit de voir, du plus récent au plus ancien. Ne lève jamais : sans base, une liste vide. */
export async function recentActivity(user: AdminUser, opts: ActivityOpts): Promise<Activity> {
  const limit = Math.max(1, Math.min(ACTIVITY_LIMITS.show, Math.trunc(opts.limit ?? ACTIVITY_LIMITS.show)));
  const fullJournal = accessGate(user, { right: "core:security" }) === "ok";
  const kept: AuditRow[] = [];
  const declared = new Map<string, ReturnType<typeof eventsOf>>();
  let before: { createdAt: Date; id: string } | null = null;
  try {
    for (let i = 0; i < ACTIVITY_LIMITS.batches && kept.length < limit; i++) {
      const rows: AuditRow[] = await prisma.auditLog.findMany({
        where: before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ACTIVITY_LIMITS.batch,
      });
      if (rows.length === 0) break;
      before = { createdAt: rows[rows.length - 1]!.createdAt, id: rows[rows.length - 1]!.id };
      for (const id of new Set(rows.map((r) => r.module).filter(Boolean))) if (!declared.has(id)) declared.set(id, eventsOf((await getModule(id).catch(() => null))?.manifest));
      const visible = rows.filter((r) => canSeeEvent(user, r)).filter((r) => {
        if (opts.advanced) return true;
        const decl = r.module ? declared.get(r.module)?.find((e) => e.key === r.action) : undefined;
        return isPlain(r, r.module ? { declared: !!decl, frequent: !!decl?.frequent } : null);
      });
      // Le dédoublonnage porte sur tout ce qui a été gardé : deux paquets contigus ne laissent pas passer un doublon.
      kept.splice(0, kept.length, ...collapse([...kept, ...visible]));
      if (rows.length < ACTIVITY_LIMITS.batch) break;
    }
  } catch {
    return { lines: [], fullJournal };
  }
  const lines = await describeRows(kept.slice(0, limit), { t: opts.t, locale: opts.locale, defaultLocale: opts.defaultLocale }).catch(() => []);
  return { lines, fullJournal };
}
