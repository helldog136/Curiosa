import { adminCtx } from "@/core/admin";
import { pickName } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { listInstances } from "@/core/instances";
import { getMarketplace, moduleOrigin } from "@/core/modules/marketplace";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { effectiveType, hasPage } from "@/core/modules/manifest";
import { MODULE_TYPES } from "@/core/modules/types";
import { localized } from "@/core/modules/types";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { ui } from "@/components/admin/ui";
import { addInstance, checkUpdateAction, toggleModule, uninstallModuleAction, updateModuleAction } from "./actions";

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ update?: string; error?: string; module?: string; to?: string; level?: string }> }) {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = user.role === "owner";
  const { update, error, module: checked, to, level } = await searchParams;
  const rows = await listModuleRows();
  const mods = await Promise.all(rows.map(async (row) => ({ row, mod: await loadModule(row) })));
  const instances = await listInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const market = await getMarketplace().catch(() => []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.modules")}</h1>
        <p className="mt-1 text-sm text-muted">{advanced ? t("modules.intro") : t("modules.introSimple")}</p>
        {isOwner && <a href="/admin/marketplace" className={`${ui.btnPrimary} mt-3 inline-block`}>🛒 {t("modules.browseMarketplace")}</a>}
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") || error.startsWith("instances.error.") ? t(error) : t("error.generic")}</p>}
      {update && <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm">{update === "yes" ? (to ? t("modules.updateAvailableTo", { module: checked ?? "", version: to }) : t("modules.updateAvailable")) : t("modules.upToDate")}</p>}
      {update === "yes" && level === "major" && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.updateMajor")}</p>}

      {[...MODULE_TYPES, "broken" as const].map((type) => {
        const group = mods.filter(({ mod }) => (mod ? effectiveType(mod.manifest) : "broken") === type);
        if (group.length === 0) return null;
        return (
      <section key={type} className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{type === "broken" ? t("modules.broken") : t(`type.${type}`)}</h2>
      <ul className="space-y-4">
        {group.map(({ row, mod }) => {
          const mine = instances.filter((i) => i.moduleId === row.id);
          const canAdd = !!mod && row.enabled && (mod.manifest.instances === "multiple" || mine.length === 0);
          return (
            <li key={row.id} className={`${ui.card} space-y-3 ${row.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {mod?.manifest.icon ?? "🧩"} {mod ? localized(mod.manifest.name, locale, config.defaultLocale) : row.id}{" "}
                    {advanced && <span className="text-xs text-muted">v{row.version} · {row.source === "builtin" ? t("modules.builtin") : row.source === "bundled" ? t("modules.bundled") : "git"}</span>}
                    {row.source !== "builtin" && <span className={`ml-2 rounded px-2 py-0.5 text-xs ${moduleOrigin(row, market) === "custom" ? "bg-amber-500/20" : "bg-line"}`}>{t(`marketplace.origin.${moduleOrigin(row, market) === "custom" ? "custom" : "marketplace"}`)}</span>}
                  </p>
                  <p className="text-sm text-muted">{mod ? localized(mod.manifest.description, locale, config.defaultLocale) : t("modules.broken")}</p>
                  {advanced && mod && mod.manifest.permissions.length > 0 && <p className="mt-1 text-xs text-muted">{t("modules.permissions")} : {mod.manifest.permissions.join(", ")}</p>}
                  {advanced && row.repoUrl && <p className="mt-1 break-all font-mono text-xs text-muted">{row.repoUrl}{row.ref ? `#${row.ref}` : ""} @ {row.commit?.slice(0, 7)}</p>}
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    <form action={toggleModule.bind(null, row.id, !row.enabled)}>
                      <button className={ui.btn}>{row.enabled ? t("action.disable") : t("action.enable")}</button>
                    </form>
                    {advanced && row.source !== "builtin" && (
                      <>
                        <form action={checkUpdateAction.bind(null, row.id)}><button className={ui.btn}>{t("modules.checkUpdate")}</button></form>
                        <form action={updateModuleAction.bind(null, row.id)}><button className={ui.btn}>{t("modules.update")}</button></form>
                        <form action={uninstallModuleAction.bind(null, row.id)}><ConfirmButton message={t("modules.uninstallConfirm")}>{t("modules.uninstall")}</ConfirmButton></form>
                      </>
                    )}
                  </div>
                )}
              </div>

              {mine.length > 0 && (
                <ul className="divide-y divide-line rounded-lg border border-line bg-bg">
                  {mine.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <a href={`/admin/instances/${i.id}`} className="font-medium hover:text-accent">{labeler.label(i)}</a>
                      <span className="text-xs text-muted">
                        {advanced && <span className="font-mono">{i.key}{i.basePath !== null ? ` · /${i.basePath}` : ""}</span>}
                        {!i.enabled && <> {advanced ? "· " : ""}{t("instances.disabled")}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canAdd && mod && (
                <form action={addInstance.bind(null, row.id)} className="space-y-2">
                  {/* Dès la 2e instance, un surnom devient utile pour les distinguer : on le demande ici (et pour la 1re, si elle n'en a pas). */}
                  {mine.length > 0 && (
                    <>
                      {mine.filter((m) => !m.nickname).map((m) => (
                        <label key={m.id} className="block text-sm">
                          <span className={ui.label}>{t("instances.nicknameExisting", { name: pickName(m, locale, config.defaultLocale) })}</span>
                          <input name={`nickname_${m.id}`} required maxLength={40} defaultValue={pickName(m, locale, config.defaultLocale)} className={ui.input} />
                        </label>
                      ))}
                      <label className="block text-sm">
                        <span className={ui.label}>{t("instances.nicknameNew")}</span>
                        <input name="nickname" required maxLength={40} placeholder={t("instances.nicknamePlaceholder")} className={ui.input} />
                        <span className={ui.help}>{t("instances.nicknameHelp")}</span>
                      </label>
                    </>
                  )}
                  <button className={ui.btn}>+ {advanced ? (hasPage(mod.manifest) || mod.manifest.content ? t("instances.add") : t("instances.addPlain")) : t("instances.addSimple", { name: localized(mod.manifest.name, locale, config.defaultLocale) })}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      </section>
        );
      })}

    </div>
  );
}
