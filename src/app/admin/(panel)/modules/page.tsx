import { adminCtx } from "@/core/admin";
import { getCatalogue } from "@/core/modules/catalogue";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { checkUpdateAction, installFromCatalogue, installModuleAction, toggleModule, uninstallModuleAction, updateModuleAction } from "./actions";

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ update?: string; error?: string }> }) {
  const { t, locale, config } = await adminCtx("admin");
  const { update, error } = await searchParams;
  const rows = await listModuleRows();
  const mods = await Promise.all(rows.map(async (row) => ({ row, mod: await loadModule(row) })));
  const catalogue = (await getCatalogue()).filter((c) => !rows.some((r) => r.id === c.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.modules")}</h1>
        <p className="mt-1 text-sm text-muted">{t("modules.intro")}</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error) : t("error.generic")}</p>}
      {update && <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm">{update === "yes" ? t("modules.updateAvailable") : t("modules.upToDate")}</p>}

      <ul className="space-y-3">
        {mods.map(({ row, mod }) => (
          <li key={row.id} className={`${ui.card} flex flex-wrap items-center justify-between gap-4`}>
            <div className="min-w-0">
              <p className="font-medium">
                {mod?.manifest.icon ?? "🧩"} {mod ? localized(mod.manifest.name, locale, config.defaultLocale) : row.id}{" "}
                <span className="text-xs text-muted">v{row.version} · {row.source === "builtin" ? t("modules.builtin") : "git"}</span>
              </p>
              <p className="text-sm text-muted">{mod ? localized(mod.manifest.description, locale, config.defaultLocale) : t("modules.broken")}</p>
              {row.repoUrl && <p className="mt-1 break-all font-mono text-xs text-muted">{row.repoUrl}{row.ref ? `#${row.ref}` : ""} @ {row.commit?.slice(0, 7)}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/admin/modules/${row.id}`} className={ui.btn}>{t("modules.configure")}</a>
              <form action={toggleModule.bind(null, row.id, !row.enabled)}>
                <button className={row.enabled ? ui.btn : ui.btnPrimary}>{row.enabled ? t("action.disable") : t("action.enable")}</button>
              </form>
              {row.source === "git" && (
                <>
                  <form action={checkUpdateAction.bind(null, row.id)}><button className={ui.btn}>{t("modules.checkUpdate")}</button></form>
                  <form action={updateModuleAction.bind(null, row.id)}><button className={ui.btn}>{t("modules.update")}</button></form>
                  <form action={uninstallModuleAction.bind(null, row.id)}><ConfirmButton message={t("modules.uninstallConfirm")}>{t("modules.uninstall")}</ConfirmButton></form>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{t("modules.install")}</h2>
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.warning")}</p>
        <ActionForm action={installModuleAction} submitLabel={t("modules.installButton")}>
          <TextField name="repo" type="url" label={t("modules.repoUrl")} placeholder="https://github.com/owner/vitrine-module-example" required help={t("modules.repoHelp")} />
        </ActionForm>
      </section>

      {catalogue.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("modules.catalogue")}</h2>
          {catalogue.map((c) => (
            <div key={c.id} className={`${ui.card} flex items-center justify-between gap-4`}>
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted">{c.description}</p>
              </div>
              <form action={installFromCatalogue.bind(null, c.repo)}><button className={ui.btnPrimary}>{t("modules.installButton")}</button></form>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
