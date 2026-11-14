import { prisma } from "../db";
import { audit, hasRole, type AdminUser } from "../permissions";
import { getSiteConfig } from "../settings";
import { ensureDefaultInstance } from "./defaultInstance";
import { getModule, listModuleRows } from "./registry";
import { normalizeNeeds, offerVersionOf, satisfiesVersion } from "./serviceVersions";
import { localized } from "./types";

/**
 * « METTRE EN PLACE » UN MODULE INSTALLÉ DEPUIS UN AUTRE MODULE (`ctx.api.instances.pending` / `ctx.api.instances.setUp`, cœur 0.15.0, permission `instances.setup`).
 *
 * Le besoin : un module dit « il me manque une instance d'Overlay alertes » et la personne qui administre veut le régler d'UN clic, pas en allant sur la page des extensions.
 * Ce que cela ouvre, et rien de plus :
 *   - DÉCLARÉ : le module demande la permission `instances.setup` (la personne la lit avant d'installer) ET déclare le service dans `requires` (facultatif ou non) ;
 *   - LIMITÉ : seul un module DÉJÀ INSTALLÉ, qui offre un service que l'appelant déclare, et qui n'a AUCUNE instance (donc ne fournit rien) peut être mis en place ; une seule
 *     instance, par défaut (les mêmes fonctions que le bouton « Mettre en place » de la page des extensions, ou que l'installation d'une dépendance : `ensureDefaultInstance`) ;
 *   - PERMISSIONNÉ : seulement depuis une `adminAction` déclenchée par une personne de rôle administrateur (jamais un panneau, une route, une tâche, un service ni le MCP) ;
 *   - JOURNALISÉ : `instance.setup`, cible « <module> <état> », rattaché à l'instance appelante ; la personne est celle qui a cliqué ;
 *   - JAMAIS : installer ou mettre à jour du code (c'est un geste du propriétaire : bloc `suggestInstall`, page des extensions), créer une deuxième instance, supprimer quoi que ce soit.
 * Le cœur n'importe aucun module : il ne connaît que des manifestes.
 */
export type SetUpOffer = { module: string; name: string; /** The services you declare in `requires` that this module offers (version high enough). */ services: string[] };
export type SetUpResult =
  | { ok: true; state: "created" | "restored" | "present" }
  | { ok: false; reason: "no-permission" | "no-person" | "denied" | "undeclared" | "not-installed" | "failed" };

export const MAX_SETUP_OFFERS = 10;

/** Modules installés, sans instance, qui offrent un service que `consumerModuleId` déclare dans `requires` (version ≥ `min`). Lecture seule ; ne lève jamais. */
export async function pendingSetUps(consumerModuleId: string, locale: string): Promise<SetUpOffer[]> {
  try {
    const consumer = await getModule(consumerModuleId);
    if (!consumer) return [];
    const needs = normalizeNeeds(consumer.manifest.requires);
    if (!needs.length) return [];
    const { defaultLocale } = await getSiteConfig();
    const out: SetUpOffer[] = [];
    for (const row of await listModuleRows()) {
      if (row.id === consumerModuleId) continue;
      const mod = await getModule(row.id).catch(() => null);
      if (!mod) continue;
      const services = needs.filter((n) => satisfiesVersion(offerVersionOf(mod.manifest.offers, n.service), n.min)).map((n) => n.service);
      if (!services.length) continue;
      if ((await prisma.moduleInstance.count({ where: { moduleId: row.id } })) > 0) continue;
      out.push({ module: row.id, name: localized(mod.manifest.name, locale, defaultLocale) || row.id, services });
      if (out.length >= MAX_SETUP_OFFERS) break;
    }
    return out;
  } catch (error) {
    console.error("[modules] pending set-ups failed:", (error as Error)?.message);
    return [];
  }
}

/** Met en place `moduleId` pour le compte de l'instance appelante. `person` : celle de l'`adminAction` en cours (null partout ailleurs). */
export async function setUpFor(caller: { moduleId: string; instanceKey: string }, person: AdminUser | null, moduleId: unknown): Promise<SetUpResult> {
  if (!person) return { ok: false, reason: "no-person" };
  if (!hasRole(person, "admin")) return { ok: false, reason: "denied" };
  if (typeof moduleId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(moduleId)) return { ok: false, reason: "undeclared" };
  try {
    const row = await prisma.module.findUnique({ where: { id: moduleId }, select: { id: true } });
    if (!row) return { ok: false, reason: "not-installed" };
    const consumer = await getModule(caller.moduleId);
    const target = await getModule(moduleId);
    const needs = normalizeNeeds(consumer?.manifest.requires);
    if (!consumer || !target || moduleId === caller.moduleId || !needs.some((n) => satisfiesVersion(offerVersionOf(target.manifest.offers, n.service), n.min))) return { ok: false, reason: "undeclared" };
    const outcome = await ensureDefaultInstance(moduleId);
    if (!outcome) return { ok: false, reason: "failed" };
    const state = outcome.kind === "restored" ? "restored" : outcome.kind;
    await audit(person.email, "instance.setup", `${moduleId} ${state}`, { module: caller.moduleId, instance: caller.instanceKey });
    return { ok: true, state };
  } catch (error) {
    console.error("[modules] set-up failed:", (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
}
