import { siteUrl } from "@/core/config";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getSiteConfig } from "@/core/settings";
import { deps } from "./deps";
import { getNotifyMode } from "./settings";

/**
 * AVERTIR LE PROPRIÉTAIRE. « Dans l'admin » est toujours actif (pastille, encadré du tableau de bord, page « Maintenance par IA » : voir summary.ts).
 * « Dans l'admin et par e-mail » ajoute un message via le service e-mail du cœur (le même que celui des modules), au propriétaire du site, quand une demande
 * attend et quand une action de niveau 2 ou 3 vient de s'exécuter. Le message ne contient AUCUN secret : le nom du jeton (celui que l'administrateur lui a donné),
 * l'action en toutes lettres, le résultat (réussi ou non) et l'adresse de la page d'admin. Ne lève jamais : un e-mail qui ne part pas ne bloque rien.
 */
export type MaintenanceEvent =
  | { kind: "pending"; tokenName: string; actionKey: string; detail: string }
  | { kind: "executed"; tokenName: string; actionKey: string; detail: string; ok: boolean };

export async function notifyOwner(event: MaintenanceEvent): Promise<"sent" | "skipped" | "failed"> {
  try {
    if ((await getNotifyMode()) !== "email") return "skipped";
    const t = makeTranslator((await getSiteConfig()).defaultLocale);
    const action = t(`aim.action.${event.actionKey}`);
    const vars = { token: event.tokenName, action, detail: event.detail, url: `${siteUrl}/admin/maintenance-ia` };
    const subject = event.kind === "pending" ? t("aim.mail.pending.subject") : t(event.ok ? "aim.mail.done.subject" : "aim.mail.failed.subject");
    const text = event.kind === "pending" ? t("aim.mail.pending.body", vars) : t(event.ok ? "aim.mail.done.body" : "aim.mail.failed.body", vars);
    return (await deps.mail(subject, text)).ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
