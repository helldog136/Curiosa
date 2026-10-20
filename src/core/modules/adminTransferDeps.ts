import { revalidatePath } from "next/cache";
import { getAdminTranslator, resolveAdminLocale } from "@/core/i18n/request";
import { makeTranslator } from "@/core/i18n/dictionary";
import { audit, auditDenied, currentUser } from "@/core/permissions";
import { buildContext, forViewer } from "./context";
import { getActiveInstances } from "./registry";
import type { TransferDeps } from "./adminTransferHandlers";

/** Les vraies dépendances des routes `/api/admin/modules/…` (session, registre des modules, journal d'audit). */
export const realTransferDeps: TransferDeps = {
  user: () => currentUser(),
  async resolve(instanceId) {
    const active = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
    if (!active) return undefined;
    return {
      key: active.instance.key, moduleId: active.mod.manifest.id, def: active.mod.def,
      // Le contexte d'une personne qui regarde l'administration : `ctx.can` vérifie les droits de CETTE personne (relue en base à cette requête).
      ctx: async (user) => forViewer(await buildContext(active.mod, active.instance, await resolveAdminLocale(user.locale)), user),
    };
  },
  audit,
  auditDenied,
  async t(user) {
    try { return user ? (await getAdminTranslator(user.locale)).t : (await getAdminTranslator(null)).t; } catch { return makeTranslator("en"); }
  },
  refresh: () => { try { revalidatePath("/admin", "layout"); } catch { /* hors requête : rien à rafraîchir */ } },
};
