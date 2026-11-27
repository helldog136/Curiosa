import { PLAIN_INPUT } from "@/components/admin/managerHints";
import { HostedSections } from "@/components/admin/HostedSections";
import { plainQuery } from "@/core/modules/coreSections";
import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { MAX_ACTIVE_PAGES, MAX_PAGES, RESOLUTIONS, formatOf, nowMs, testActive } from "@/core/overlays/model";
import { listPages, readSecret } from "@/core/overlays/store";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { CopyAddress } from "@/components/admin/CopyAddress";
import { PendingButton } from "@/components/admin/PendingButton";
import { FormDialog } from "@/components/admin/FormDialog";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { RowMenu } from "@/components/admin/RowMenu";
import { Switch } from "@/components/admin/Switch";
import { searchText } from "@/core/adminkit/search";
import { Callout, EmptyState, PageHeader, Panel } from "@/components/admin/Page";
import { TextField, Select } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { createPageAction, deletePageAction, duplicatePageAction, renamePageAction, resetSecretAction, setPageActiveAction } from "./actions";
import { OVERLAY_PAGES_HREF, OVERLAYS_OBS_HREF, overlayPageHref } from "@/core/adminLinks";
import { LinkTabs } from "@/components/admin/LinkTabs";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

const ERRORS = new Set(["limitPages", "limitActive", "name", "resolution", "notFound"]);
const OKS = new Set(["duplicated", "renamed", "activated", "deactivated", "deleted", "secret"]);

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("ovp.title"));
}

export default async function OverlayPagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await adminCtx(OVERLAY_NEED);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const e = one(sp.e), ok = one(sp.ok);
  const pages = await listPages();
  const activeCount = pages.filter((p) => p.active).length;
  const now = nowMs();
  const addresses = new Map<string, string | null>();
  for (const p of pages) { const s = await readSecret(p.id); addresses.set(p.id, s ? `${siteUrl}/overlays/page/${s}` : null); }

  return (
    <div className="space-y-6">
      <PageHeader title={t("ovp.title")} intro={t("ovp.intro")} />
      <LinkTabs tabs={[{ id: "pages", href: OVERLAY_PAGES_HREF, label: t("ovp.tab.pages") }, { id: "obs", href: OVERLAYS_OBS_HREF, label: t("ovp.obs.tab") }]} current="pages" label={t("ovp.list.tabs")} />
      {ERRORS.has(e) && <Callout tone="danger">{t(`ovp.flash.${e}`, { pages: MAX_PAGES, active: MAX_ACTIVE_PAGES })}</Callout>}
      {OKS.has(ok) && <Callout tone="ok" role="status">{t(`ovp.flash.${ok}`)}</Callout>}

      <Panel title={t("ovp.new")} help={`${t("ovp.newHelp")} ${t("ovp.counts", { pages: pages.length, maxPages: MAX_PAGES, active: activeCount, maxActive: MAX_ACTIVE_PAGES })}`}>
        <form action={createPageAction} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <TextField name="name" label={t("ovp.name")} required />
          <Select name="resolution" label={t("ovp.resolution")} defaultValue="1920x1080" options={RESOLUTIONS.map(([w, h]) => { const f = formatOf(w, h); return { value: `${w}x${h}`, label: f ? `${w}×${h} · ${t(`ovp.format.${f}`)}` : `${w}×${h}` }; })} />
          <PendingButton variant="primary" pendingLabel={t("progress.creating")} disabled={pages.length >= MAX_PAGES}>{t("ovp.newButton")}</PendingButton>
        </form>
      </Panel>

      {pages.length === 0 ? (
        <EmptyState icon="🎬" title={t("ovp.empty")}>{t("ovp.emptyHelp")}</EmptyState>
      ) : (
        <section className="space-y-3" data-testid="overlay-pages-list">
          {/* Live search from the first page on (R15); the state pills only appear when a page is turned off (the state then matters). */}
          <LiveSearch scope="overlay-pages" placeholder={t("ovp.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
            filters={activeCount < pages.length ? [{ key: "state", allLabel: t("table.all"), options: [{ value: "on", label: t("ovp.on"), count: activeCount }, { value: "off", label: t("ovp.off"), count: pages.length - activeCount }] }] : []} />
          <ul className="space-y-3">
            {pages.map((p) => {
              const address = addresses.get(p.id) ?? null;
              const testing = testActive(p.testUntil, now);
              const size = `${p.width}×${p.height}`;
              return (
                <li key={p.id} className={`${ui.card} !p-4`} data-testid="overlay-page" data-live-item="overlay-pages" data-live-state={p.active ? "on" : "off"} data-search={searchText([p.name, size, p.active ? "" : t("ovp.off"), testing ? t("ovp.testChip") : ""])}>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 basis-full space-y-1 sm:flex-1 sm:basis-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={overlayPageHref(p.id)} className="text-[15px] font-semibold [overflow-wrap:anywhere] hover:text-accent hover:underline">{p.name}</Link>
                        {/* Only what sets a row apart (R14, R37): a page that is turned off, a page in test mode. */}
                        {!p.active && <span className={ui.chip}>{t("ovp.off")}</span>}
                        {testing && <span className={ui.chipWarn}>{t("ovp.testChip")}</span>}
                      </p>
                      <p className="text-sm text-muted">{size} · {t("ovp.elementCount", { n: p.elements.length })}</p>
                      {!address && <p className="text-sm text-amber-700">{t("ovp.addressLost")}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch quiet label={t("ovp.switch.label", { name: p.name })} checked={p.active} onText={t("ovp.on")} offText={t("ovp.off")} failedText={t("switch.failed")} onToggle={setPageActiveAction.bind(null, p.id)} testid="overlay-page-switch" />
                      {address && <CopyAddress text={address} label={t("ovp.copy")} copied={t("ovp.copied")} manual={t("ovp.copyManual")} />}
                      <Link href={overlayPageHref(p.id)} className={`${ui.btn} min-h-11`}>{t("ovp.edit")}</Link>
                      <RowMenu label={t("ovp.rowMenu", { name: p.name })}>
                        <form action={duplicatePageAction.bind(null, p.id, t("ovp.copySuffix"))}><PendingButton variant="menu">{t("ovp.duplicate")}</PendingButton></form>
                        <FormDialog menu trigger={t("ovp.rename")} triggerLabel={t("ovp.renameFor", { name: p.name })} title={t("ovp.rename")} closeLabel={t("roles.close")} testid="overlay-page-rename">
                          <form action={renamePageAction.bind(null, p.id)} className="flex flex-wrap items-end gap-3">
                            <div className="min-w-56 flex-1">
                              <label htmlFor={`rename-${p.id}`} className={ui.label}>{t("ovp.renameLabel")}</label>
                              <input {...PLAIN_INPUT} id={`rename-${p.id}`} name="name" defaultValue={p.name} maxLength={60} required className={ui.input} />
                            </div>
                            <PendingButton variant="primary" pendingLabel={t("progress.saving")}>{t("ovp.renameButton")}</PendingButton>
                          </form>
                        </FormDialog>
                        <form action={resetSecretAction.bind(null, p.id)}><ConfirmButton menu danger={false} message={t("ovp.resetConfirm")} confirmLabel={t("ovp.resetYes")} pendingLabel={t("ovp.resetting")}>{t("ovp.reset")}</ConfirmButton></form>
                        <div className="mt-1 border-t border-line pt-1"><form action={deletePageAction.bind(null, p.id)}><ConfirmButton menu message={t("ovp.deleteConfirm", { name: p.name, n: p.elements.length })} confirmLabel={t("ovp.delete")} dangerConfirm pendingLabel={t("ovp.deleting")}>{t("ovp.delete")}</ConfirmButton></form></div>
                      </RowMenu>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {/* (0.34.0) Sections that modules add to this core page (docs/PLACES.md). */}
      <HostedSections page="obs.pages" base={OVERLAY_PAGES_HREF} tabs={["main", "skins"]} query={plainQuery(sp as Record<string, string | string[] | undefined>)} />
    </div>
  );
}
