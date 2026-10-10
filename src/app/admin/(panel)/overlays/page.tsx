import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { getAdminNav } from "@/core/modules/adminNav";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { getInstanceLabeler } from "@/core/modules/labels";
import { moduleSearchText } from "@/core/modules/installedList";
import { overlayUrl } from "@/core/modules/overlayUrl";
import { type IntegrationState } from "@/core/modules/menuPlacement";
import { CatalogueSearch } from "@/components/admin/CatalogueSearch";
import { InstanceState } from "@/components/admin/InstanceState";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { CopyText } from "@/components/site/CopyText";
import { setPlacementAction, toggleInstanceAction } from "../integrations/actions";

export const dynamic = "force-dynamic";

/** À regarder d'abord : ce qui est en erreur, puis ce qui reste à configurer (même ordre que les Intégrations). */
const ORDER: Record<IntegrationState, number> = { error: 0, setup: 1, on: 2, off: 3 };

/** Overlays : les sources navigateur pour OBS (alertes, labyrinthe, bandeaux…), une carte chacune, avec l'adresse à coller dans OBS. */
export default async function OverlaysPage() {
  const { t, locale, config } = await adminCtx("admin");
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const statuses = await loadInstanceStatuses();
  const cards = (await getAdminNav(locale, config.defaultLocale))
    .filter((i) => i.placement === "overlays")
    .map((i) => {
      const state: IntegrationState = statuses.get(i.id)?.state ?? "off";
      const moduleName = labeler.moduleName(i.moduleId);
      return { ...i, state, moduleName, url: i.overlay ? overlayUrl(siteUrl, i.key) : null, search: moduleSearchText([i.name, moduleName, i.key, t(`integrations.state.${state}`), "obs", "overlay"]) };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

  return (
    <div className="space-y-8">
      <PageHeader title={t("overlays.title")} icon="🎬" intro={t("overlays.intro")} />
      {cards.length === 0 && (
        <EmptyState icon="🎬" title={t("overlays.emptyTitle")} action={<a href="/admin/catalogue" className={ui.btnPrimary}>{t("integrations.emptyAction")}</a>}>{t("overlays.emptyHelp")}</EmptyState>
      )}
      {cards.length > 0 && <CatalogueSearch placeholder={t("overlays.search")} noneLabel={`${t("overlays.searchNone")} ${t("modules.searchEmptyHint")}`} clearLabel={t("catalogue.searchClear")} />}
      <section data-catalogue-section>
        <ul className="grid gap-4" data-testid="overlays-list">
          {cards.map((c) => (
            <li key={c.id} data-catalogue-item data-search={c.search} data-state={c.state} className={`${ui.card} flex flex-col gap-3 !p-4 ${c.enabled ? "" : "bg-bg shadow-none"}`}>
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-lg font-semibold leading-tight">{c.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <InstanceState t={t} state={c.state} />
                    {c.moduleName !== c.name && <span className="truncate">{c.moduleName}</span>}
                  </p>
                  {c.state === "error" && <p className="mt-1 text-sm text-red-600" role="status">{t("integrations.errorHint")}</p>}
                </div>
              </div>
              {c.url && (
                <div className="rounded-xl border border-line bg-bg p-3">
                  <p className="text-xs font-medium text-muted">{t("overlays.obsAddress")}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <code data-testid="overlay-url" className="min-w-0 flex-1 break-all font-mono text-sm">{c.url}</code>
                    <CopyText text={c.url} copyLabel={t("overlays.copy")} copiedLabel={t("overlays.copied")} />
                  </div>
                  <p className="mt-2 text-xs text-muted">{c.enabled ? t("overlays.obsHelp") : t("overlays.obsOff")}</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <form action={toggleInstanceAction.bind(null, c.id, !c.enabled)}>
                  <button className="inline-flex items-center gap-2.5 rounded-full py-1 pr-2 text-sm font-medium" aria-pressed={c.enabled} aria-label={t(c.enabled ? "integrations.disable" : "integrations.enable", { name: c.name })}>
                    <span className={`relative h-6 w-11 rounded-full transition-colors ${c.enabled ? "bg-accent" : "bg-line"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.enabled ? "left-[22px]" : "left-0.5"}`} /></span>
                    {c.enabled ? t("integrations.state.on") : t("integrations.state.off")}
                  </button>
                </form>
                <a href={`/admin/instances/${c.id}`} className={ui.btn}>⚙️ {t("integrations.settings")}</a>
              </div>
              <form action={setPlacementAction.bind(null, c.id, "menu")}>
                <button className="text-[13px] text-muted hover:text-accent">📌 {t("placement.pin")}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
