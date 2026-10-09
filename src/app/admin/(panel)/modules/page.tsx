import { adminCtx } from "@/core/admin";
import { redirect } from "next/navigation";
import { CatalogueSearch } from "@/components/admin/CatalogueSearch";
import { buildModuleGroups, moduleSearchText } from "@/core/modules/installedList";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { getInstanceLabeler } from "@/core/modules/labels";
import { listInstances } from "@/core/instances";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { effectiveType } from "@/core/modules/manifest";
import { MODULE_TYPES } from "@/core/modules/types";
import { localized } from "@/core/modules/types";
import { FeatureTabs } from "@/components/admin/FeatureTabs";
import { Callout, EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { duplicateServices } from "@/core/modules/dependencies";
import { ServiceRouter } from "@/components/admin/ServiceRouter";
import { addInstance, saveServiceRouting, toggleModule } from "./actions";

export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ update?: string; error?: string; detail?: string; notice?: string; module?: string; to?: string; level?: string }> }) {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = user.role === "owner";
  const { update, error, detail, notice, module: checked, to, level } = await searchParams;
  // Anciens liens (résultat d'une recherche de mise à jour) : le message s'affiche sur la page du module concerné.
  const rows = await listModuleRows();
  if (checked && update && rows.some((r) => r.id === checked)) redirect(`/admin/modules/${encodeURIComponent(checked)}?${new URLSearchParams(Object.entries({ update, module: checked, to, level }).filter((e): e is [string, string] => !!e[1]))}`);
  const mods = await Promise.all(rows.map(async (row) => ({ row, mod: await loadModule(row) })));
  const instances = await listInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  // Sans réseau : le dernier rapport connu (le même que la pastille du menu) ; réservé au propriétaire comme elle.
  const behind = new Map((isOwner ? peekModulesReport()?.outdated ?? [] : []).map((o) => [o.id, o]));
  const duplicates = isOwner ? await duplicateServices() : [];

  const items = mods.map(({ row, mod }) => {
    const mine = instances.filter((i) => i.moduleId === row.id);
    const modName = mod ? localized(mod.manifest.name, locale, config.defaultLocale) : row.id;
    const type = mod ? effectiveType(mod.manifest) : "broken";
    const description = mod ? localized(mod.manifest.description, locale, config.defaultLocale) : t("modules.broken");
    return {
      id: row.id, type, enabled: row.enabled, version: row.version, loaded: !!mod, icon: mod?.manifest.icon ?? "🧩", description,
      // Mode simple, une seule instance : la carte porte le nom que l'admin lui a donné (comme le menu de gauche).
      name: !advanced && mine.length === 1 ? labeler.label(mine[0]!) : modName,
      count: mine.length, firstInstanceId: mine[0]?.id ?? null, update: behind.has(row.id),
      search: moduleSearchText([modName, description, row.id, type === "broken" ? null : t(`type.${type}`), type, ...mine.flatMap((i) => [labeler.label(i), i.nickname, i.key])]),
    };
  });
  const groups = buildModuleGroups(items, MODULE_TYPES);

  return (
    <div className="space-y-8">
      <PageHeader title={advanced ? t("nav.modules") : t("nav.modules.simple")} intro={advanced ? t("modules.intro") : t("modules.introSimple")} />
      <FeatureTabs current="installed" labels={{ installed: advanced ? t("nav.modules") : t("nav.modules.simple"), add: advanced ? t("nav.catalogue") : t("nav.catalogue.simple") }} />
      {error && <Callout tone="danger">{error.startsWith("modules.error.") || error.startsWith("instances.error.") ? t(error, { services: detail ?? "", modules: detail ?? "" }) : t("error.generic")}</Callout>}
      {notice === "services" && <Callout tone="warn" role="alert">{t("services.notice")}</Callout>}
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
      {mods.length === 0 && (
        <EmptyState icon="🧩" title={t("modules.emptyTitle")} action={<a href="/admin/catalogue" className={ui.btnPrimary}>{t("modules.emptyAction")}</a>}>{t("modules.emptyHelp")}</EmptyState>
      )}

      {mods.length > 0 && <CatalogueSearch placeholder={t("catalogue.search")} noneLabel={`${t("catalogue.searchNone")} ${t("modules.searchEmptyHint")}`} clearLabel={t("catalogue.searchClear")} />}

      {groups.map((g) => (
        <section key={g.type} data-catalogue-section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{g.type === "broken" ? t("modules.broken") : t(`type.${g.type}`)}</h2>
          <ul className={advanced ? "space-y-2" : "grid gap-4 sm:grid-cols-2"}>
            {g.items.map((m) => advanced ? (
              <li key={m.id} data-catalogue-item data-search={m.search}>
                <a href={`/admin/modules/${encodeURIComponent(m.id)}`} aria-label={t("modules.openModule", { name: m.name })}
                  className={`${ui.card} flex items-center gap-4 !p-3 transition hover:border-accent sm:!p-4 ${m.enabled ? "" : "bg-bg opacity-70 shadow-none"}`}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-2xl" aria-hidden>{m.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{m.name}</span>
                      <span className="text-xs text-muted">v{m.version}</span>
                      <span className={m.enabled ? ui.chipOk : ui.chip}>{m.enabled ? t("modules.on") : t("modules.off")}</span>
                      {m.update && <span className={ui.chipWarn} data-testid={`module-behind-${m.id}`}>⬆ {t("modules.updateBadge")}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{m.description}</span>
                  </span>
                  <span className="hidden shrink-0 text-sm text-muted sm:block">{m.count === 0 ? t("modules.instanceCountNone") : m.count === 1 ? t("modules.instanceCountOne") : t("modules.instanceCountMany", { count: m.count })}</span>
                  <span aria-hidden className="shrink-0 text-muted">›</span>
                </a>
              </li>
            ) : (
              <li key={m.id} data-catalogue-item data-search={m.search} className={`${ui.card} flex flex-col gap-4 ${m.enabled ? "" : "bg-bg shadow-none"}`}>
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{m.icon}</span>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-tight">{m.name}</p>
                    <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted">{m.description}</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  {isOwner && m.loaded ? (
                    <form action={toggleModule.bind(null, m.id, !m.enabled)}>
                      <input type="hidden" name="from" value="list" />
                      <button className="inline-flex items-center gap-2.5 rounded-full py-1 pr-2 text-sm font-medium" aria-pressed={m.enabled}>
                        <span className={`relative h-6 w-11 rounded-full transition-colors ${m.enabled ? "bg-accent" : "bg-line"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${m.enabled ? "left-[22px]" : "left-0.5"}`} /></span>
                        {m.enabled ? t("modules.on") : t("modules.off")}
                      </button>
                    </form>
                  ) : <span className={m.enabled ? ui.chipOk : ui.chip}>{m.enabled ? t("modules.on") : t("modules.off")}</span>}
                  <span className="flex flex-wrap items-center gap-2">
                    {m.enabled && m.firstInstanceId && <a href={`/admin/instances/${m.firstInstanceId}`} className={ui.btn}>⚙️ {t("modules.adjust")}</a>}
                    {m.enabled && !m.firstInstanceId && m.loaded && (
                      <form action={addInstance.bind(null, m.id)}><button className={ui.btnPrimary}>{t("modules.setUp")}</button></form>
                    )}
                    <a href={`/admin/modules/${encodeURIComponent(m.id)}`} className="text-sm text-muted hover:text-accent">{t("modules.moreOptions")}</a>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

    </div>
  );
}
