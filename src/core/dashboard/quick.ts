/**
 * TABLEAU DE BORD — « Créer » : des boutons d'action rapide, filtrés par droits et par extensions installées.
 *
 * Deux sources, jamais de nom d'extension écrit en dur : (1) celles que les extensions DÉCLARENT (`dashboard.quickActions` : « Écrire un article », « Programmer un stream »…, voir modules.ts) ;
 * (2) le cœur, pour ce qu'il sait faire seul : ajouter un contenu dans une extension à contenu qui n'a rien déclaré (« Ajouter dans Blog »), créer un lien court, et — en mode avancé — ajouter une extension.
 * Pur : ne lit rien, se teste seul.
 */
import { can, hasRole, type AdminUser } from "../auth/access";
import type { Translator } from "../i18n/dictionary";
import { EXTENSIONS_ADD_HREF } from "../modules/extensionsLinks";
import type { ModuleAction } from "./modules";
import type { TodoNavItem } from "./todo";
import { REDIRECTS_HREF, entryNewHref } from "@/core/adminLinks";

export type QuickAction = { id: string; icon: string; label: string; href: string; /** « core » ou l'identifiant de l'extension qui la propose. */ from: string };
export const QUICK_MAX = 6;

export function coreQuickActions(opts: { user: AdminUser; t: Translator; advanced: boolean; nav: readonly TodoNavItem[]; declared: readonly Pick<ModuleAction, "moduleId" | "instanceId">[] }): QuickAction[] {
  const { user, t } = opts;
  const out: QuickAction[] = [];
  if (can(user, "core:entries.edit")) {
    // Une extension à contenu qui a déclaré ses propres actions (avec les bons mots) n'a pas besoin de la nôtre.
    const handled = new Set(opts.declared.map((d) => d.instanceId));
    for (const i of opts.nav) {
      if (!i.content || i.error || handled.has(i.id)) continue;
      out.push({ id: `add-${i.id}`, icon: i.icon, label: t("dash.create.entry", { name: i.name }), href: entryNewHref(i.key), from: "core" });
    }
  }
  if (hasRole(user, "editor")) out.push({ id: "short-link", icon: "🔗", label: t("dash.create.link"), href: REDIRECTS_HREF, from: "core" });
  if (opts.advanced && hasRole(user, "admin")) out.push({ id: "extension", icon: "🧩", label: t("dash.create.extension"), href: EXTENSIONS_ADD_HREF, from: "core" });
  return out;
}

/** Les actions des extensions d'abord (leurs mots, leur ordre), puis celles du cœur ; 6 au plus, sans adresse en double. */
export function mergeQuick(declared: readonly ModuleAction[], core: readonly QuickAction[], max: number = QUICK_MAX): QuickAction[] {
  const seen = new Set<string>();
  const all: QuickAction[] = [...declared.map((d) => ({ id: `${d.moduleId}-${d.instanceId}-${d.id}`, icon: d.icon, label: d.label, href: d.href, from: d.moduleId })), ...core];
  const out: QuickAction[] = [];
  for (const a of all) {
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    out.push(a);
  }
  return out.slice(0, max);
}
