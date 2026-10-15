import { adminCtx } from "@/core/admin";
import { CatalogueSearch } from "@/components/admin/CatalogueSearch";
import { ExtensionCard } from "@/components/admin/ExtensionCard";
import { ExtensionsHeader } from "@/components/admin/ExtensionsHeader";
import { ExtensionsNotices, type NoticeQuery } from "@/components/admin/ExtensionsNotices";
import { FamilyFilter } from "@/components/admin/FamilyFilter";
import { EmptyState } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { parseFamily } from "@/core/modules/extensionFamilies";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { loadInstalled } from "./loadInstalled";

export const dynamic = "force-dynamic";

/** Extensions > Installées : tout ce qui est installé sur le site, par famille (Contenu, Communauté, Réseaux et connexions, Overlays), avec son état, ses réglages et « épingler au menu ». */
export default async function ExtensionsPage({ searchParams }: { searchParams: Promise<NoticeQuery & { family?: string }> }) {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = user.role === "owner";
  const query = await searchParams;
  const family = parseFamily(query.family);
  const { total, present, groups } = await loadInstalled({ t, locale, defaultLocale: config.defaultLocale, advanced, isOwner, family });

  return (
    <div className="space-y-8">
      <ExtensionsHeader t={t} advanced={advanced} isOwner={isOwner} current="installed" intro={advanced ? t("extensions.intro") : t("extensions.introSimple")} />
      <ExtensionsNotices t={t} locale={locale} defaultLocale={config.defaultLocale} isOwner={isOwner} query={query} />
      {total === 0 && (
        <EmptyState icon="🧩" title={t("modules.emptyTitle")} action={<a href={EXTENSIONS_ADD_HREF} className={ui.btnPrimary}>{t("modules.emptyAction")}</a>}>{t("modules.emptyHelp")}</EmptyState>
      )}
      {total > 0 && (
        <>
          <CatalogueSearch placeholder={t("extensions.search")} noneLabel={`${t("catalogue.searchNone")} ${t("modules.searchEmptyHint")}`} clearLabel={t("catalogue.searchClear")} />
          <FamilyFilter t={t} present={present} current={family} />
        </>
      )}
      {total > 0 && groups.length === 0 && (
        <EmptyState icon="🧩" title={t("extensions.familyEmptyTitle")} action={<a href={EXTENSIONS_HREF} className={ui.btn}>{t("extensions.familyAll")}</a>}>{t("extensions.familyEmptyHelp")}</EmptyState>
      )}
      {groups.map((g) => (
        <section key={g.type} data-catalogue-section aria-labelledby={`family-title-${g.type}`} className="space-y-3" data-testid={`family-section-${g.type}`}>
          <div>
            <h2 id={`family-title-${g.type}`} className="text-sm font-semibold uppercase tracking-wide text-muted">{g.type === "broken" ? t("modules.broken") : t(`family.${g.type}`)}</h2>
            {g.type !== "broken" && <p className="mt-1 text-sm text-muted">{t(`family.${g.type}.help`)}</p>}
          </div>
          <ul className="grid gap-4 lg:grid-cols-2">
            {g.items.map((m) => <ExtensionCard key={m.id} t={t} m={m} advanced={advanced} isOwner={isOwner} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
