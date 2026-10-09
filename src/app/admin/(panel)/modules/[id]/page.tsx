import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { listInstances, pickName } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { getCatalogue, moduleOrigin } from "@/core/modules/catalogue";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { hasPage } from "@/core/modules/manifest";
import { localized } from "@/core/modules/types";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Callout, DangerZone } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { ModuleUpdateButton } from "@/components/admin/ModuleUpdateButton";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { addInstance, toggleModule, uninstallModuleAction } from "../actions";

export const dynamic = "force-dynamic";

/** Page d'un module : tout ce qu'on peut en faire (activer, mettre à jour, instances, désinstaller). Les messages des actions arrivent ici. */
export default async function ModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ update?: string; error?: string; detail?: string; module?: string; to?: string; level?: string }> }) {
  const { id } = await params;
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = user.role === "owner";
  const { update, error, detail, to, level } = await searchParams;
  const row = (await listModuleRows()).find((r) => r.id === decodeURIComponent(id));
  if (!row) notFound();
  const mod = await loadModule(row);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const mine = (await listInstances()).filter((i) => i.moduleId === row.id);
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const market = advanced ? await getCatalogue().catch(() => []) : [];
  const behind = isOwner ? peekModulesReport()?.outdated.find((o) => o.id === row.id) : undefined;   // sans réseau
  const canAdd = !!mod && row.enabled && (mod.manifest.instances === "multiple" || mine.length === 0);
  const name = mod ? L(mod.manifest.name) : row.id;
  const listTitle = advanced ? t("nav.modules") : t("nav.modules.simple");

  return (
    <div className="space-y-6">
      <a href="/admin/modules" className="inline-block text-sm text-muted hover:text-accent">← {listTitle}</a>
      <header className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-3xl" aria-hidden>{mod?.manifest.icon ?? "🧩"}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={row.enabled ? ui.chipOk : ui.chip}>{row.enabled ? t("modules.on") : t("modules.off")}</span>
            {behind && <span className={ui.chipWarn}>⬆ {t("modules.updateBadge")}</span>}
            {advanced && <span>v{row.version}{row.source === "git" ? " · git" : ""}</span>}
            {advanced && <span className={`rounded px-2 py-0.5 text-xs ${moduleOrigin(row, market) === "custom" ? "bg-amber-500/20" : "bg-line"}`}>{t(`catalogue.origin.${moduleOrigin(row, market)}`)}</span>}
          </p>
        </div>
      </header>

      {error && <Callout tone="danger">{error.startsWith("modules.error.") || error.startsWith("instances.error.") ? t(error, { services: detail ?? "", modules: detail ?? "" }) : t("error.generic")}</Callout>}
      {update && <Callout role="status">{update === "yes" ? (to ? t("modules.updateAvailableTo", { module: name, version: to }) : t("modules.updateAvailable")) : t("modules.upToDate")}</Callout>}
      {update === "yes" && level === "major" && <Callout tone="warn" role="alert">{t("modules.updateMajor")}</Callout>}

      <section className={`${ui.card} space-y-3 ${row.enabled ? "" : "bg-bg"}`}>
        <p className="text-sm">{mod ? L(mod.manifest.description) : t("modules.broken")}</p>
        {mod && (mod.manifest.requires ?? []).length > 0 && <p className="text-xs text-muted">{t("modules.requires")} : {(mod.manifest.requires ?? []).map((r) => (r.label ? L(r.label) : r.service)).join(", ")}</p>}
        {advanced && mod && (mod.manifest.offers ?? []).length > 0 && <p className="text-xs text-muted">{t("modules.offers")} : {(mod.manifest.offers ?? []).map((o) => (o.label ? L(o.label) : o.service)).join(", ")}</p>}
        {advanced && mod && mod.manifest.permissions.length > 0 && <p className="text-xs text-muted">{t("modules.permissions")} : {mod.manifest.permissions.join(", ")}</p>}
        {advanced && row.repoUrl && <p className="break-all font-mono text-xs text-muted">{row.repoUrl}{row.ref || row.subdir ? `#${row.ref ?? ""}${row.subdir ? `:${row.subdir}` : ""}` : ""} @ {row.commit?.slice(0, 7)}</p>}
        {isOwner && (
          <div className="flex flex-wrap gap-2 pt-1">
            <form action={toggleModule.bind(null, row.id, !row.enabled)}>
              <button className={row.enabled ? ui.btn : ui.btnPrimary}>{row.enabled ? t("action.disable") : t("action.enable")}</button>
            </form>
            <ModuleUpdateButton id={row.id} kind="check" labels={{ idle: t("modules.checkUpdate"), working: t("modules.checking"), done: t("modules.checked"), failed: t("modules.updateFailed") }} />
            <ModuleUpdateButton id={row.id} kind="update" labels={{ idle: t("modules.update"), working: t("modules.updating"), done: t("modules.updated"), failed: t("modules.updateFailed") }} />
          </div>
        )}
      </section>

      {(mine.length > 0 || canAdd) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("modules.instancesTitle")}</h2>
          {mine.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {mine.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
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
              <button className={ui.btn}>+ {advanced ? (hasPage(mod.manifest) || mod.manifest.content ? t("instances.add") : t("instances.addPlain")) : t("instances.addSimple", { name: L(mod.manifest.name) })}</button>
            </form>
          )}
        </section>
      )}

      {isOwner && (
        <DangerZone title={t("modules.dangerTitle")} help={t("modules.uninstallHelp")}>
          <form action={uninstallModuleAction.bind(null, row.id)}><ConfirmButton message={t("modules.uninstallConfirm")}>{t("modules.uninstall")}</ConfirmButton></form>
        </DangerZone>
      )}
    </div>
  );
}
