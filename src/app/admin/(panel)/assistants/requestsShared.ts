import type { Translator } from "@/core/i18n/dictionary";
import type { MaintenanceRequest } from "@/core/maintenance/requests";

/** Ce que la demande va faire, en langage simple. */
export function describeRequest(r: MaintenanceRequest, t: Translator, name: (id: string) => string): string {
  const p = r.plan;
  if (r.action === "core_update") return t("aim.req.core_update", { from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "module_update") return t("aim.req.module_update", { name: name(p.module ?? ""), from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "modules_update_all") return t("aim.req.modules_update_all", { n: p.modules?.length ?? 0, list: (p.modules ?? []).map((m) => `${name(m.id)} (${m.from} → ${m.to})`).join(", ") });
  if (r.action === "module_install") {
    const also = (p.adds ?? []).map((a) => a.name ?? name(a.id));
    const perms = (p.permissions ?? []).map((x) => t(`perm.${x}`)).filter((x, i) => x !== `perm.${(p.permissions ?? [])[i]}`);
    return t("aim.req.module_install", { name: p.name ?? name(p.module ?? ""), version: p.to ?? "?" }) + (also.length ? ` ${t("aim.req.module_install.also", { list: also.join(", ") })}` : "") + (perms.length ? ` ${t("aim.req.module_install.perms", { list: perms.join(" · ") })}` : "");
  }
  if (r.action === "skin_install" || r.action === "skin_activate" || r.action === "skin_remove") return t(`aim.req.${r.action}`, { name: p.name ?? p.skin ?? "?", version: p.to ?? "?" });
  return t(p.keepData === false ? "aim.req.module_uninstall_erase" : "aim.req.module_uninstall", { name: name(p.module ?? "") });
}
