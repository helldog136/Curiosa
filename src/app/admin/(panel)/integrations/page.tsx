import { adminCtx } from "@/core/admin";
import { getAdminNav } from "@/core/modules/adminNav";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { getInstanceLabeler } from "@/core/modules/labels";
import { moduleSearchText } from "@/core/modules/installedList";
import { type IntegrationState } from "@/core/modules/menuPlacement";
import { platformLabel, splitByPlatform } from "@/core/modules/platform";
import { CatalogueSearch } from "@/components/admin/CatalogueSearch";
import { InstanceState } from "@/components/admin/InstanceState";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { setPlacementAction, toggleInstanceAction } from "./actions";

export const dynamic = "force-dynamic";

/** À regarder d'abord : ce qui est en erreur, puis ce qui reste à configurer. */
const ORDER: Record<IntegrationState, number> = { error: 0, setup: 1, on: 2, off: 3 };

/** Intégrations : les fonctionnalités que l'on règle une fois (réseaux sociaux, chaînes, overlays, annonces…), une carte chacune, au lieu d'une ligne chacune dans le menu. */
export default async function IntegrationsPage() {
  const { t, locale, config } = await adminCtx("admin");
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const statuses = await loadInstanceStatuses();
  const cards = (await getAdminNav(locale, config.defaultLocale))
    .filter((i) => i.placement === "integrations")
    .map((i) => {
      const status = statuses.get(i.id);
      const state: IntegrationState = status?.state ?? "off";
      const moduleName = labeler.moduleName(i.moduleId);
      return { ...i, state, moduleName, search: moduleSearchText([i.name, moduleName, i.key, t(`integrations.state.${state}`), t(`type.${i.type}`), i.type, i.platform ? platformLabel(i.platform) : null]) };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

  // Une section par plateforme dès que 2 instances au moins la partagent ; le reste par type (réseaux sociaux, autres). Sans plateforme partagée : une seule grille, sans titre, comme avant.
  const split = splitByPlatform(cards);
  const sections: { id: string; title: string | null; items: typeof cards }[] = split.platforms.map((p) => ({ id: p.platform, title: platformLabel(p.platform), items: p.items }));
  if (split.platforms.length === 0) sections.push({ id: "all", title: null, items: cards });
  else {
    const social = split.rest.filter((c) => c.type === "social");
    if (social.length > 0) sections.push({ id: "social", title: t("type.social"), items: social });
    const other = split.rest.filter((c) => c.type !== "social");
    if (other.length > 0) sections.push({ id: "other", title: t("integrations.sectionOther"), items: other });
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("integrations.title")} icon="🔌" intro={t("integrations.intro")} />
      {cards.length === 0 && (
        <EmptyState icon="🔌" title={t("integrations.emptyTitle")} action={<a href="/admin/catalogue" className={ui.btnPrimary}>{t("integrations.emptyAction")}</a>}>{t("integrations.emptyHelp")}</EmptyState>
      )}
      {cards.length > 0 && <CatalogueSearch placeholder={t("integrations.search")} noneLabel={`${t("integrations.searchNone")} ${t("modules.searchEmptyHint")}`} clearLabel={t("catalogue.searchClear")} />}
      {sections.map((sec) => (
        <section key={sec.id} data-catalogue-section className="space-y-3">
          {sec.title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted" data-testid={`integrations-section-${sec.id}`}>{sec.title}</h2>}
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="integrations-list">
            {sec.items.map((c) => (
              <li key={c.id} data-catalogue-item data-search={c.search} data-state={c.state} className={`${ui.card} flex flex-col gap-3 !p-4 ${c.enabled ? "" : "bg-bg shadow-none"}`}>
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-lg font-semibold leading-tight">{c.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <InstanceState t={t} state={c.state} />
                      {c.moduleName !== c.name && <span className="truncate">{c.moduleName}</span>}
                      {c.badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{c.badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
                    </p>
                    {c.state === "error" && <p className="mt-1 text-sm text-red-600" role="status">{t("integrations.errorHint")}</p>}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <form action={toggleInstanceAction.bind(null, c.id, !c.enabled)}>
                    <button className="inline-flex items-center gap-2.5 rounded-full py-1 pr-2 text-sm font-medium" aria-pressed={c.enabled} aria-label={t(c.enabled ? "integrations.disable" : "integrations.enable", { name: c.name })}>
                      <span className={`relative h-6 w-11 rounded-full transition-colors ${c.enabled ? "bg-accent" : "bg-line"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${c.enabled ? "left-[22px]" : "left-0.5"}`} /></span>
                      {c.enabled ? t("integrations.state.on") : t("integrations.state.off")}
                    </button>
                  </form>
                  <span className="flex flex-wrap items-center gap-2">
                    {c.content && <a href={`/admin/entries?c=${c.key}`} className={ui.btn}>{t("integrations.items")}</a>}
                    <a href={`/admin/instances/${c.id}`} className={ui.btn}>⚙️ {t("integrations.settings")}</a>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <form action={setPlacementAction.bind(null, c.id, "menu")}>
                    <button className="text-[13px] text-muted hover:text-accent">📌 {t("placement.pin")}</button>
                  </form>
                  {c.placements.includes("overlays") && (
                    <form action={setPlacementAction.bind(null, c.id, "overlays")}>
                      <button className="text-[13px] text-muted hover:text-accent">🎬 {t("placement.parkOverlays")}</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
