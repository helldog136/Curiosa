import type { Translator } from "@/core/i18n/dictionary";
import { level3Def } from "@/core/maintenance/level3Registry";
import type { MaintenanceRequest } from "@/core/maintenance/requests";

/** Ce que la demande va faire, en langage simple : la phrase est écrite par la définition de l'action (core/maintenance/level3.ts, `summarize`). */
export function describeRequest(r: MaintenanceRequest, t: Translator, name: (id: string) => string): string {
  return level3Def(r.action).summarize(r.plan, t, name);
}
