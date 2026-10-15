import type { Translator } from "@/core/i18n/dictionary";
import type { MaintenanceRequest } from "@/core/maintenance/requests";

/** Ce que la demande va faire, en langage simple. */
export function describeRequest(r: MaintenanceRequest, t: Translator, name: (id: string) => string): string {
  const p = r.plan;
  if (r.action === "core_update") return t("aim.req.core_update", { from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "module_update") return t("aim.req.module_update", { name: name(p.module ?? ""), from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "modules_update_all") return t("aim.req.modules_update_all", { n: p.modules?.length ?? 0, list: (p.modules ?? []).map((m) => `${name(m.id)} (${m.from} → ${m.to})`).join(", ") });
  return t(p.keepData === false ? "aim.req.module_uninstall_erase" : "aim.req.module_uninstall", { name: name(p.module ?? "") });
}
