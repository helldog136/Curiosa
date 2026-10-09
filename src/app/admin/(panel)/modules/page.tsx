import { adminCtx } from "@/core/admin";
import { pickName } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { listInstances } from "@/core/instances";
import { getCatalogue, moduleOrigin } from "@/core/modules/catalogue";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { effectiveType, hasPage } from "@/core/modules/manifest";
import { MODULE_TYPES } from "@/core/modules/types";
import { localized } from "@/core/modules/types";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { FeatureTabs } from "@/components/admin/FeatureTabs";
import { ui } from "@/components/admin/ui";
import { duplicateServices } from "@/core/modules/dependencies";
import { ServiceRouter } from "@/components/admin/ServiceRouter";
import { addInstance, checkUpdateAction, saveServiceRouting, toggleModule, uninstallModuleAction, updateModuleAction } from "./actions";

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ update?: string; error?: string; detail?: string; notice?: string; module?: string; to?: string; level?: string }> }) {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = user.role === "owner";
  const { update, error, detail, notice, module: checked, to, level } = await searchParams;
  const rows = await listModuleRows();
  const mods = await Promise.all(rows.map(async (row) => ({ row, mod: await loadModule(row) })));
  const instances = await listInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const market = await getCatalogue().catch(() => []);
  const duplicates = isOwner ? await duplicateServices() : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>{advanced ? t("nav.modules") : t("nav.modules.simple")}</h1>
        <p className={ui.pageIntro}>{advanced ? t("modules.intro") : t("modules.introSimple")}</p>
      </div>
      <FeatureTabs current="installed" labels={{ installed: advanced ? t("nav.modules") : t("nav.modules.simple"), add: advanced ? t("nav.catalogue") : t("nav.catalogue.simple") }} />
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") || error.startsWith("instances.error.") ? t(error, { services: detail ?? "", modules: detail ?? "" }) : t("error.generic")}</p>}
      {notice === "services" && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("services.notice")}</p>}
      {duplicates.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{t("services.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("services.intro")}</p>
          </div>
          {duplicates.map((d) => {
            const node = (p: (typeof d.providers)[number]) => ({ key: p.instance.key, name: labeler.label(p.instance), icon: p.mod.manifest.icon ?? "🧩", sub: localized(p.mod.manifest.name, locale, config.defaultLocale) });
            const consumers = d.consumers.map((c) => ({ key: c.instance.key, name: labeler.label(c.instance), icon: c.mod.manifest.icon ?? "🧩", sub: localized(c.mod.manifest.name, locale, config.defaultLocale) }));
            return (
              <ServiceRouter key={d.service} service={d.service} consumers={consumers} providers={d.providers.map(node)}
                master={(d.routing && d.providers.some((p) => p.instance.key === d.routing!.master) ? d.routing.master : d.providers[0]!.instance.key)}
                replicas={d.routing?.replicas ?? []} action={saveServiceRouting.bind(null, d.service)}
                labels={{ consumers: t("services.consumers"), providers: t("services.providers"), master: t("services.master"), replica: t("services.replica"), promote: t("services.promote"), remove: t("services.remove"), hint: t("services.hint"), list: t("services.list"), save: t("services.save"), pending: d.resolved ? null : t("services.pending") }} />
            );
          })}
        </section>
      )}
      {update && <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm">{update === "yes" ? (to ? t("modules.updateAvailableTo", { module: checked ?? "", version: to }) : t("modules.updateAvailable")) : t("modules.upToDate")}</p>}
      {update === "yes" && level === "major" && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("modules.updateMajor")}</p>}

      {!advanced && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {mods.map(({ row, mod }) => {
            const mine = instances.filter((i) => i.moduleId === row.id);
            // Une seule instance : la carte porte le nom que l'admin lui a donné (comme le menu de gauche).
            const name = mine.length === 1 ? labeler.label(mine[0]!) : mod ? localized(mod.manifest.name, locale, config.defaultLocale) : row.id;
            const toggle = row.enabled ? "bg-accent" : "bg-line";
            return (
              <li key={row.id} className={`${ui.card} flex flex-col gap-4 ${row.enabled ? "" : "bg-bg shadow-none"}`}>
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{mod?.manifest.icon ?? "🧩"}</span>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-tight">{name}</p>
                    <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted">{mod ? localized(mod.manifest.description, locale, config.defaultLocale) : t("modules.broken")}</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  {isOwner && mod ? (
                    <form action={toggleModule.bind(null, row.id, !row.enabled)}>
                      <button className="inline-flex items-center gap-2.5 rounded-full py-1 pr-2 text-sm font-medium" aria-pressed={row.enabled}>
                        <span className={`relative h-6 w-11 rounded-full transition-colors ${toggle}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${row.enabled ? "left-[22px]" : "left-0.5"}`} /></span>
                        {row.enabled ? t("modules.on") : t("modules.off")}
                      </button>
                    </form>
                  ) : <span className={row.enabled ? ui.chipOk : ui.chip}>{row.enabled ? t("modules.on") : t("modules.off")}</span>}
                  {row.enabled && mine.length > 0 && <a href={`/admin/instances/${mine[0]!.id}`} className={ui.btn}>⚙️ {t("modules.adjust")}</a>}
                  {row.enabled && mine.length === 0 && mod && (
                    <form action={addInstance.bind(null, row.id)}><button className={ui.btnPrimary}>{t("modules.setUp")}</button></form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {advanced && (
        <>
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
                    {advanced && <span className="text-xs text-muted">v{row.version}{row.source === "git" ? " · git" : ""}</span>}
                    <span className={`ml-2 rounded px-2 py-0.5 text-xs ${moduleOrigin(row, market) === "custom" ? "bg-amber-500/20" : "bg-line"}`}>{t(`catalogue.origin.${moduleOrigin(row, market)}`)}</span>
                  </p>
                  <p className="text-sm text-muted">{mod ? localized(mod.manifest.description, locale, config.defaultLocale) : t("modules.broken")}</p>
                  {mod && (mod.manifest.requires ?? []).length > 0 && <p className="mt-1 text-xs text-muted">{t("modules.requires")} : {(mod.manifest.requires ?? []).map((r) => (r.label ? localized(r.label, locale, config.defaultLocale) : r.service)).join(", ")}</p>}
                  {advanced && mod && (mod.manifest.offers ?? []).length > 0 && <p className="mt-1 text-xs text-muted">{t("modules.offers")} : {(mod.manifest.offers ?? []).map((o) => (o.label ? localized(o.label, locale, config.defaultLocale) : o.service)).join(", ")}</p>}
                  {advanced && mod && mod.manifest.permissions.length > 0 && <p className="mt-1 text-xs text-muted">{t("modules.permissions")} : {mod.manifest.permissions.join(", ")}</p>}
                  {advanced && row.repoUrl && <p className="mt-1 break-all font-mono text-xs text-muted">{row.repoUrl}{row.ref || row.subdir ? `#${row.ref ?? ""}${row.subdir ? `:${row.subdir}` : ""}` : ""} @ {row.commit?.slice(0, 7)}</p>}
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    <form action={toggleModule.bind(null, row.id, !row.enabled)}>
                      <button className={ui.btn}>{row.enabled ? t("action.disable") : t("action.enable")}</button>
                    </form>
                    {advanced && (
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
        </>
      )}

    </div>
  );
}
