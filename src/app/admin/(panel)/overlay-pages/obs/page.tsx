import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { OVERLAY_PAGES_HREF, OVERLAYS_OBS_HREF, instanceHref, overlayPageHref } from "@/core/adminLinks";
import { searchText } from "@/core/adminkit/search";
import { getInstanceLabeler } from "@/core/modules/labels";
import { overlayUrl } from "@/core/modules/overlayUrl";
import { getActiveInstances } from "@/core/modules/registry";
import { listPages, readSecret } from "@/core/overlays/store";
import { Badge } from "@/components/admin/Badge";
import { CopyAddress } from "@/components/admin/CopyAddress";
import { HelpTip } from "@/components/admin/HelpTip";
import { LinkTabs } from "@/components/admin/LinkTabs";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

/**
 * (core 0.26.0) "OBS": every address to paste into a browser source of OBS, on one page: the overlay pages (their secret address, the size to set) and the overlays
 * of extensions. One table (R30): the kind is a column with a coloured AND written pill, filters above, live search (R15). Nothing is changed here.
 */
type Row = { id: string; kind: "page" | "extension"; name: string; size: string | null; active: boolean; address: string | null; settings: string };

export default async function ObsAddressesPage() {
  const { t, locale, config } = await adminCtx(OVERLAY_NEED);
  const rows: Row[] = [];
  for (const p of await listPages()) {
    const s = await readSecret(p.id);
    rows.push({ id: `p-${p.id}`, kind: "page", name: p.name, size: `${p.width}×${p.height}`, active: p.active, address: s ? `${siteUrl}/overlays/page/${s}` : null, settings: overlayPageHref(p.id) });
  }
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  for (const a of await getActiveInstances()) {
    if (typeof a.mod.def.overlay !== "function") continue;
    rows.push({ id: `i-${a.instance.id}`, kind: "extension", name: labeler.label(a.instance), size: null, active: true, address: overlayUrl(siteUrl, a.instance.key), settings: instanceHref(a.instance.id) });
  }
  const count = (k: Row["kind"]) => rows.filter((r) => r.kind === k).length;
  const tabs = [{ id: "pages", href: OVERLAY_PAGES_HREF, label: t("ovp.tab.pages") }, { id: "obs", href: OVERLAYS_OBS_HREF, label: t("ovp.obs.tab") }];

  return (
    <div className="space-y-6">
      <PageHeader title={t("ovp.obs.title")} intro={t("ovp.obs.intro")} />
      <LinkTabs tabs={tabs} current="obs" label={t("ovp.list.tabs")} />
      {rows.length === 0 ? (
        <EmptyState icon="🎬" title={t("ovp.obs.empty")}><Link href={OVERLAY_PAGES_HREF} className={ui.btn}>{t("ovp.obs.emptyAction")}</Link></EmptyState>
      ) : (
        <section className={`${ui.card} space-y-4`} data-testid="obs-addresses">
          <p className="flex items-center gap-1 text-sm text-muted">{t("ovp.obs.how")}<HelpTip help={t("ovp.obs.howHelp")} name={t("ovp.obs.title")} /></p>
          <LiveSearch scope="obs" placeholder={t("ovp.obs.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
            filters={[{ key: "kind", allLabel: t("ovp.obs.filter.all"), options: [{ value: "page", label: t("ovp.obs.kind.page"), count: count("page") }, { value: "extension", label: t("ovp.obs.kind.extension"), count: count("extension") }] }]} />
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} data-live-item="obs" data-live-kind={r.kind} data-search={searchText([r.name, r.size, t(`ovp.obs.kind.${r.kind}`), r.active ? "" : t("ovp.off")])} data-testid="obs-row"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex min-w-0 items-center gap-2">
                    <Link href={r.settings} className="truncate font-medium hover:text-accent hover:underline" title={r.name}>{r.name}</Link>
                    <Badge tone={r.kind === "page" ? "accent" : "info"}>{t(`ovp.obs.kind.${r.kind}`)}</Badge>
                    {!r.active && <Badge tone="neutral">{t("ovp.off")}</Badge>}
                  </p>
                  {r.size && <p className="text-sm text-muted">{t("ovp.obs.size", { size: r.size })}</p>}
                </div>
                {r.address ? <CopyAddress text={r.address} label={t("ovp.copy")} copied={t("ovp.copied")} manual={t("ovp.copyManual")} /> : <span className="text-sm text-amber-700">{t("ovp.addressLost")}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
