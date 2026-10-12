import type { Module } from "@prisma/client";
import { diagnoseModule, shortHash } from "@/core/modules/reinstall";
import { ReinstallButton } from "./ReinstallButton";
import { ui } from "./ui";

type T = (key: string, params?: Record<string, string | number>) => string;

/** Section « Maintenance » de la page d'un module (repliée) : diagnostic de la source et réinstallation. En mode simple, seul un lien discret « Problème avec ce module ? » la déplie. Propriétaire seulement (vérifié par la page et par les actions). */
export async function ModuleMaintenance({ row, name, advanced, t }: { row: Module; name: string; advanced: boolean; t: T }) {
  const d = await diagnoseModule(row.id, { compare: "local" });   // un dépôt ne se compare qu'à la demande (réseau)
  if (!d) return null;
  const from = d.repoUrl ? { url: d.repoUrl, ref: d.ref, subdir: d.subdir } : d.catalogue ? { url: d.catalogue.repoUrl, ref: d.catalogue.ref, subdir: d.catalogue.subdir } : null;
  const repo = from ? `${from.url}${from.ref || from.subdir ? `#${from.ref ?? ""}${from.subdir ? `:${from.subdir}` : ""}` : ""}` : "";
  const source = d.kind === "bundled" && !d.catalogue ? t("maintenance.source.bundled") : (d.kind === "git" || d.catalogue) ? t("maintenance.source.git", { repo }) : t("maintenance.source.none");
  const c = d.comparison;
  return (
    <details id="maintenance" data-testid="module-maintenance" className={advanced ? `${ui.card} group` : "group text-sm"}>
      <summary className={advanced ? "cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted" : "cursor-pointer text-xs text-muted hover:text-accent"}>
        {advanced ? t("maintenance.title") : t("maintenance.simpleLink")}
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted">{t("maintenance.help")}</p>
        {advanced && (
          <p data-testid="maintenance-diagnostic" className="break-all font-mono text-xs text-muted">
            {t("maintenance.version", { version: d.version })} · {source} · {d.installedHash ? t("maintenance.hash", { hash: shortHash(d.installedHash) }) : t("maintenance.hash", { hash: "?" })}
          </p>
        )}
        {c && c.state !== "unavailable" && (
          <p role="status" data-testid="maintenance-compare" className={`rounded-lg border px-3 py-2 text-sm ${c.state === "identical" ? "border-line bg-bg" : "border-amber-500/40 bg-amber-500/10"}`}>
            {c.state === "identical" ? t("maintenance.identical") : t("maintenance.different", { version: c.sourceVersion ?? "?" })}
          </p>
        )}
        {(d.kind === "git" || !!d.catalogue) && advanced && <p className="text-xs text-muted">{t("maintenance.compareNetwork")}</p>}
        {d.kind !== "none" && (
          <ReinstallButton id={row.id} canCompare={d.kind === "git" || !!d.catalogue} labels={{
            button: t("maintenance.button"), working: t("maintenance.working"), done: t("maintenance.done"), failed: t("maintenance.failed"),
            confirm: t("maintenance.confirm", { name }), compare: t("maintenance.compare"), comparing: t("maintenance.comparing"), compared: t("maintenance.compared"), compareFailed: t("maintenance.compareFailed"),
            identical: t("maintenance.identical"), different: t("maintenance.different"),
          }} />
        )}
        {d.kind === "none" && <p className="text-sm text-muted">{t("modules.error.reinstallNoSource")}</p>}
      </div>
    </details>
  );
}
