import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { MAX_ACTIVE_PAGES, MAX_PAGES, RESOLUTIONS, testActive } from "@/core/overlays/model";
import { listPages, readSecret } from "@/core/overlays/store";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { CopyAddress } from "@/components/admin/CopyAddress";
import { PendingButton } from "@/components/admin/PendingButton";
import { Callout, EmptyState, PageHeader, Panel } from "@/components/admin/Page";
import { TextField, Select } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { createPageAction, deletePageAction, duplicatePageAction, renamePageAction, resetSecretAction, toggleActiveAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS = new Set(["limitPages", "limitActive", "name", "resolution", "notFound"]);
const OKS = new Set(["duplicated", "renamed", "activated", "deactivated", "deleted", "secret"]);

export default async function OverlayPagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await adminCtx(OVERLAY_NEED);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const e = one(sp.e), ok = one(sp.ok);
  const pages = await listPages();
  const activeCount = pages.filter((p) => p.active).length;
  const now = Date.now();
  const addresses = new Map<string, string | null>();
  for (const p of pages) { const s = await readSecret(p.id); addresses.set(p.id, s ? `${siteUrl}/overlays/page/${s}` : null); }

  return (
    <div className="space-y-6">
      <PageHeader title={t("ovp.title")} intro={t("ovp.intro")} />
      {ERRORS.has(e) && <Callout tone="danger">{t(`ovp.flash.${e}`, { pages: MAX_PAGES, active: MAX_ACTIVE_PAGES })}</Callout>}
      {OKS.has(ok) && <Callout tone="ok" role="status">{t(`ovp.flash.${ok}`)}</Callout>}

      <Panel title={t("ovp.new")} help={t("ovp.newHelp")}>
        <form action={createPageAction} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <TextField name="name" label={t("ovp.name")} required />
          <Select name="resolution" label={t("ovp.resolution")} defaultValue="1920x1080" options={RESOLUTIONS.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w}×${h}` }))} />
          <PendingButton variant="primary" pendingLabel={t("progress.creating")} disabled={pages.length >= MAX_PAGES}>{t("ovp.newButton")}</PendingButton>
        </form>
        <p className={ui.help}>{t("ovp.counts", { pages: pages.length, maxPages: MAX_PAGES, active: activeCount, maxActive: MAX_ACTIVE_PAGES })}</p>
      </Panel>

      {pages.length === 0 ? (
        <EmptyState icon="🎬" title={t("ovp.empty")}>{t("ovp.emptyHelp")}</EmptyState>
      ) : (
        <ul className="space-y-4">
          {pages.map((p) => {
            const address = addresses.get(p.id) ?? null;
            const testing = testActive(p.testUntil, now);
            return (
              <li key={p.id} className={`${ui.card} space-y-4`} data-testid="overlay-page">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold [overflow-wrap:anywhere]"><Link href={`/admin/overlay-pages/${p.id}`} className="hover:text-accent hover:underline">{p.name}</Link></h2>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span>{p.width}×{p.height}</span><span aria-hidden>·</span>
                      <span>{t("ovp.elementCount", { n: p.elements.length })}</span>
                      <span className={p.active ? ui.chipOk : ui.chip}>{p.active ? t("ovp.on") : t("ovp.off")}</span>
                      {testing && <span className={ui.chipWarn}>{t("ovp.testChip")}</span>}
                    </p>
                  </div>
                  <Link href={`/admin/overlay-pages/${p.id}`} className={ui.btnPrimary}>{t("ovp.edit")}</Link>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {address ? <CopyAddress text={address} label={t("ovp.copy")} copied={t("ovp.copied")} manual={t("ovp.copyManual")} /> : <span className="text-sm text-amber-700">{t("ovp.addressLost")}</span>}
                  <form action={toggleActiveAction.bind(null, p.id, !p.active)}><PendingButton variant="btn">{p.active ? t("ovp.turnOff") : t("ovp.turnOn")}</PendingButton></form>
                  <form action={duplicatePageAction.bind(null, p.id, t("ovp.copySuffix"))}><PendingButton variant="btn">{t("ovp.duplicate")}</PendingButton></form>
                </div>
                <details className="rounded-xl border border-line">
                  <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">{t("ovp.more")}</summary>
                  <div className="space-y-4 border-t border-line px-4 py-3">
                    <form action={renamePageAction.bind(null, p.id)} className="flex flex-wrap items-end gap-3">
                      <div className="min-w-56 flex-1">
                        <label htmlFor={`rename-${p.id}`} className={ui.label}>{t("ovp.renameLabel")}</label>
                        <input id={`rename-${p.id}`} name="name" defaultValue={p.name} maxLength={60} required className={ui.input} />
                      </div>
                      <PendingButton variant="btn">{t("ovp.rename")}</PendingButton>
                    </form>
                    <div className="flex flex-wrap items-start gap-3">
                      <form action={resetSecretAction.bind(null, p.id)}><ConfirmButton danger={false} message={t("ovp.resetConfirm")} confirmLabel={t("ovp.resetYes")} pendingLabel={t("ovp.resetting")}>{t("ovp.reset")}</ConfirmButton></form>
                      <form action={deletePageAction.bind(null, p.id)}><ConfirmButton message={t("ovp.deleteConfirm", { name: p.name })} pendingLabel={t("ovp.deleting")}>{t("ovp.delete")}</ConfirmButton></form>
                    </div>
                    <p className={ui.help}>{t("ovp.resetHelp")}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
