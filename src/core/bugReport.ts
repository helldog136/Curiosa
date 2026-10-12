import { bugReportUrl } from "@/core/credit";
import type { Translator } from "@/core/i18n/dictionary";
import { getUpdateChannel, readVersion } from "@/core/updates/service";

/**
 * Adresse du signalement d'un défaut, prête à mettre dans un lien. Elle ne contient QUE : la version de Curiosa, celle de Node, le système et le canal de mise à jour.
 * Jamais d'adresse du site, de nom, d'e-mail, de réglage ni de donnée (voir `bugReportUrl` dans credit.ts, qui n'accepte rien d'autre).
 */
export async function adminBugReportUrl(t: Translator): Promise<string> {
  return bugReportUrl(
    { version: readVersion(), node: process.version, system: `${process.platform}-${process.arch}`, channel: await getUpdateChannel() },
    { title: t("bugReport.issueTitle"), intro: t("bugReport.intro"), did: t("bugReport.did"), expected: t("bugReport.expected"), happened: t("bugReport.happened"), environment: t("bugReport.environment"), version: t("bugReport.version"), node: t("bugReport.node"), system: t("bugReport.system"), channel: t("bugReport.channel") },
  );
}
