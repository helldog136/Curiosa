import type { Translator } from "@/core/i18n/dictionary";
import type { MaintenanceRequest } from "@/core/maintenance/requests";

/** Ce que la demande va faire, en langage simple. */
export function describeRequest(r: MaintenanceRequest, t: Translator, name: (id: string) => string): string {
  const p = r.plan;
  if (r.action === "core_update") return t("aim.req.core_update", { from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "module_update") return t("aim.req.module_update", { name: name(p.module ?? ""), from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "modules_update_all") return t("aim.req.modules_update_all", { n: p.modules?.length ?? 0, list: (p.modules ?? []).map((m) => `${name(m.id)} (${m.from} → ${m.to})`).join(", ") });
  if (r.action === "module_install" && p.bundle) {
    // One request for several features: the owner reads every one of them, with what comes along and what it asks for.
    const lines = p.bundle.map((b) => {
      const also = (b.adds ?? []).map((a) => a.name ?? name(a.id));
      const perms = (b.permissions ?? []).map((x) => t(`perm.${x}`)).filter((x, i) => x !== `perm.${(b.permissions ?? [])[i]}`);
      return `${t("aim.req.bundle.item", { name: b.name ?? name(b.module ?? ""), version: b.to ?? "?" })}${also.length ? ` ${t("aim.req.module_install.also", { list: also.join(", ") })}` : ""}${perms.length ? ` ${t("aim.req.module_install.perms", { list: perms.join(" · ") })}` : ""}`;
    });
    return `${t("aim.req.bundle", { n: p.bundle.length })} ${lines.join(" ")}`;
  }
  if (r.action === "entry_publish" || r.action === "entry_unpublish") {
    const items = p.entry?.items ?? [];
    return t(`aim.req.${r.action}`, { n: items.length, list: items.map((i) => `“${i.title || i.id}”`).join(", "), instance: p.entry?.instance ?? "?" });
  }
  if (r.action === "instance_add") return t("aim.req.instance_add", { name: name(p.module ?? ""), nickname: p.newInstance?.nickname ?? "?" });
  if (r.action === "skin_set_options") {
    const colors = p.options ? `${Object.entries(p.options.colors).map(([f, v]) => `${t(`aim.req.color.${f}`)} ${v || t("aim.req.color.reset")}`).join(", ")}${p.options.mode ? ` (${t(`aim.req.mode.${p.options.mode}`)})` : ""}` : "";
    return t("aim.req.skin_set_options", { list: [colors, p.fonts?.names].filter(Boolean).join("; ") || "?" });
  }
  if (r.action === "site_settings_set") return t("aim.req.site_settings_set", { list: p.site?.names ?? "?" });
  if (r.action === "module_install") {
    const also = (p.adds ?? []).map((a) => a.name ?? name(a.id));
    const perms = (p.permissions ?? []).map((x) => t(`perm.${x}`)).filter((x, i) => x !== `perm.${(p.permissions ?? [])[i]}`);
    return t("aim.req.module_install", { name: p.name ?? name(p.module ?? ""), version: p.to ?? "?" }) + (also.length ? ` ${t("aim.req.module_install.also", { list: also.join(", ") })}` : "") + (perms.length ? ` ${t("aim.req.module_install.perms", { list: perms.join(" · ") })}` : "");
  }
  if (r.action === "skin_install" || r.action === "skin_activate" || r.action === "skin_remove") return t(`aim.req.${r.action}`, { name: p.name ?? p.skin ?? "?", version: p.to ?? "?" });
  if (r.action === "font_set") return t("aim.req.font_set", { list: p.fonts?.names ?? "?" });
  return t(p.keepData === false ? "aim.req.module_uninstall_erase" : "aim.req.module_uninstall", { name: name(p.module ?? "") });
}
