import Link from "next/link";
import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { OVERLAY_PAGES_HREF, overlayPageHref, overlayPageSkinHref, overlaySkinPreviewHref, overlaySkinSampleHref } from "@/core/adminLinks";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { listContexts, type AvailableContext } from "@/core/overlays/context";
import { searchText } from "@/core/adminkit/search";
import { listOverlaySkins } from "@/core/overlays/skinLoad";
import { getPage } from "@/core/overlays/store";
import { listCatalogue } from "@/core/skins/service";
import { Badge } from "@/components/admin/Badge";
import { DialogLink } from "@/components/admin/EditDialog";
import { LinkTabs } from "@/components/admin/LinkTabs";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { RuleDialog, ScaledFrame } from "@/components/admin/OverlaySkin";
import { Callout, EmptyState, PageHeader, Panel } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { Switch } from "@/components/admin/Switch";
import { ui } from "@/components/admin/ui";
import { chooseContextAction, installOverlaySkinAction, removeRuleAction, saveRuleAction, searchValuesAction, setPageSkinAction, toggleByContextAction } from "./actions";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function OverlayPageSkin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale, config } = await adminCtx(OVERLAY_NEED);
  const { id } = await params;
  const q = await searchParams;
  const page = await getPage(id);
  if (!page) notFound();
  const [skins, contexts] = await Promise.all([listOverlaySkins(), listContexts(locale, config.defaultLocale)]);
  const usable = skins.filter((s) => s.status === "ok");
  const name = (s: { name: { fr: string; en: string } }) => (locale === "fr" ? s.name.fr : s.name.en);
  const desc = (s: { description: { fr: string; en: string } }) => (locale === "fr" ? s.description.fr : s.description.en);
  const look = page.look;
  const chosen: AvailableContext | undefined = contexts.find((c) => c.instance === look.byContext.instance && c.context === look.byContext.context) ?? (contexts.length === 1 ? contexts[0] : undefined);
  const known = new Map(usable.map((s) => [s.id, name(s)]));
  const catalogue = await listCatalogue({ kind: "overlay" }).catch(() => null);
  const toGet = (catalogue?.items ?? []).filter((c) => !c.installed && c.compatible && !c.needsNewerCore);
  const installedCount = (catalogue?.items ?? []).filter((c) => c.installed).length;
  const editing = first(q.edit);
  const rule = editing && editing !== "new" ? look.byContext.rules.find((r) => r.value === editing) ?? null : null;
  const back = overlayPageSkinHref(id);
  const ok = first(q.ok), err = first(q.e);

  const tabs = [
    { id: "layout", href: overlayPageHref(id), label: t("ovp.tab.layout") },
    { id: "skin", href: overlayPageSkinHref(id), label: t("ovp.tab.skin") },
  ];

  return (
    <div className="space-y-6">
      <div className="max-w-4xl space-y-6">
        <PageHeader title={page.name} intro={t("ovp.skin.intro")}>
          <Link href={OVERLAY_PAGES_HREF} className={ui.btn}>{t("ovp.back")}</Link>
        </PageHeader>
        <LinkTabs tabs={tabs} current="skin" label={t("ovp.tab.label")} />
        {ok && <Callout tone="info" role="status">{ok === "removed" ? t("ovp.skin.ok.removed") : ok === "installed" ? t("ovp.skin.ok.installed") : t("ovp.skin.ok.skin")}</Callout>}
        {err && <Callout tone="warn" role="alert">{t(err === "install" ? "ovp.skin.err.install" : "ovp.skin.err.generic")}</Callout>}
      </div>

      <Panel title={t("ovp.skin.gallery")} help={t("ovp.skin.galleryHelp")} testid="skin-gallery">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[{ id: "", label: t("ovp.skin.common"), text: t("ovp.skin.commonHelp") }, ...usable.map((s) => ({ id: s.id, label: name(s), text: desc(s) }))].map((s) => {
            const on = (look.skin ?? "") === s.id;
            return (
              <li key={s.id || "common"} className={`min-w-0 space-y-3 rounded-2xl border p-3 ${on ? "border-accent" : "border-line"}`} data-testid="skin-card" data-card={s.id || "common"}>
                <ScaledFrame src={`${overlaySkinSampleHref(s.id || "common")}?lang=${locale}`} title={t("ovp.skin.sampleOf", { name: s.label })} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{s.label}{on && <Badge tone="ok">{t("ovp.skin.inUse")}</Badge>}</p>
                  <p className="truncate text-sm text-muted" title={s.text}>{s.text}</p>
                </div>
                {!on && <form action={setPageSkinAction.bind(null, id, s.id)}><PendingButton variant="btn">{s.id ? t("ovp.skin.use") : t("ovp.skin.useCommon")}</PendingButton></form>}
              </li>
            );
          })}
        </ul>
        {usable.length === 0 && <p className={`${ui.help} mt-3`}>{t("ovp.skin.none")}</p>}
        <section className="mt-6 space-y-3" aria-labelledby="skin-get-title" data-testid="skin-get">
          <h3 id="skin-get-title" className="text-base font-semibold">{t("ovp.skin.get")}</h3>
          {catalogue?.unreachable && <p role="status" className={ui.help}>{t("skins.error.catalogue")}</p>}
          {!catalogue?.unreachable && toGet.length === 0 && <p className={ui.help}>{t("ovp.skin.getNone")}</p>}
          {toGet.length > 0 && (
            <>
              <LiveSearch scope="skin-get" placeholder={t("ovp.skin.getSearch")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
              {installedCount > 0 && <p className={ui.help}>{t("ovp.skin.getInstalled", { n: installedCount })}</p>}
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {toGet.map((c) => {
                  const cname = locale === "fr" ? c.name.fr : c.name.en, cdesc = locale === "fr" ? c.description.fr : c.description.en;
                  return (
                    <li key={c.id} data-live-item="skin-get" data-search={searchText([cname, cdesc, c.tags.join(" ")])} data-testid="skin-get-card" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={overlaySkinPreviewHref(c.id)} alt={t("ovp.skin.previewOf", { name: cname })} width={640} height={360} loading="lazy" decoding="async" className="aspect-[16/9] w-full rounded-lg border border-line bg-black object-cover" />
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={cname}>{cname}</p>
                        <p className="truncate text-sm text-muted" title={cdesc}>{cdesc}</p>
                      </div>
                      <form className="mt-auto" action={installOverlaySkinAction.bind(null, id, c.id)}><PendingButton variant="btn" className="min-h-11">{t("ovp.skin.install")}</PendingButton></form>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </Panel>

      <Panel title={t("ovp.skin.ctx.title")} help={contexts.length === 0 ? t("ovp.skin.ctx.none") : t("ovp.skin.ctx.help")} testid="skin-context">
        {chosen && (
          <div className="space-y-4">
            <Switch label={chosen.switchLabel} checked={look.byContext.enabled && look.byContext.instance === chosen.instance && look.byContext.context === chosen.context}
              onToggle={toggleByContextAction.bind(null, id, chosen.instance, chosen.context)} onText={t("ovp.skin.ctx.on")} offText={t("ovp.skin.ctx.off")} failedText={t("ovp.skin.err.generic")} testid="skin-context-switch" />
            {contexts.length > 1 && (
              <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t("ovp.skin.ctx.more")}</summary>
                <div className="flex flex-wrap gap-2">
                  {contexts.map((c) => (
                    <form key={`${c.instance}:${c.context}`} action={chooseContextAction.bind(null, id, c.instance, c.context)}>
                      <button type="submit" aria-pressed={c === chosen} className={`${ui.btn} min-h-11 ${c === chosen ? "border-accent text-accent" : ""}`}>{c.switchLabel}</button>
                    </form>
                  ))}
                </div></details>
            )}
            {look.byContext.enabled && look.byContext.instance === chosen.instance && look.byContext.context === chosen.context && (
              <div className="space-y-3" data-testid="skin-rules">
                {look.byContext.rules.length === 0 ? (
                  <EmptyState icon="🎨" title={t("ovp.skin.empty")}
                    action={usable.length ? <DialogLink href={overlayPageSkinHref(id, { edit: "new" })} className={ui.btnPrimary}>{t("ovp.skin.add")}</DialogLink> : undefined}>
                    {chosen.example ? t("ovp.skin.emptyExample", { example: chosen.example }) : t("ovp.skin.emptyHelp")}
                  </EmptyState>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[14rem] flex-1"><LiveSearch scope="skin-rules" placeholder={t("ovp.skin.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} /></div>
                      {usable.length > 0 && <DialogLink href={overlayPageSkinHref(id, { edit: "new" })} className={ui.btnPrimary}>{t("ovp.skin.add")}</DialogLink>}
                    </div>
                    <div className="relative sm:overflow-x-auto"><table role="table" className="w-full text-left text-sm max-sm:block" data-testid="skin-rules-table">
                      <thead role="rowgroup" className="text-muted max-sm:sr-only"><tr role="row"><th role="columnheader" className="px-3 py-2 font-medium">{chosen.label}</th><th role="columnheader" className="px-3 py-2 font-medium">{t("ovp.skin.col.skin")}</th><th role="columnheader" className="px-3 py-2"><span className="sr-only">{t("table.actions")}</span></th></tr></thead>
                      <tbody role="rowgroup" className="max-sm:block">
                        {look.byContext.rules.map((r) => (
                          <tr key={r.value} role="row" data-live-item="skin-rules" data-search={searchText([r.label, known.get(r.skin) ?? r.skin])} className="border-t border-line max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:p-3">
                            <td role="cell" className="max-w-[28ch] px-3 py-2 font-medium max-sm:max-w-none max-sm:px-1"><span className="block truncate" title={r.label}>{r.label}</span></td>
                            <td role="cell" className="px-3 py-2 max-sm:px-1">{known.get(r.skin) ?? <Badge tone="warn">{t("ovp.skin.missing")}</Badge>}</td>
                            <td role="cell" className="whitespace-nowrap px-3 py-2 text-right max-sm:px-1 max-sm:pt-2 max-sm:text-left"><DialogLink href={overlayPageSkinHref(id, { edit: r.value })} className={`${ui.btn} min-h-11`}>{t("ovp.skin.edit")}</DialogLink></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </>
                )}
                <p className={ui.help}>{t("ovp.skin.fallback", { skin: look.skin ? (known.get(look.skin) ?? look.skin) : t("ovp.skin.common") })}</p>
              </div>
            )}
          </div>
        )}
      </Panel>

      {chosen && editing && (editing === "new" || rule) && usable.length > 0 && (
        <RuleDialog pageId={id} closeHref={back} skins={usable.map((s) => ({ id: s.id, name: name(s) }))} current={rule}
          previousValue={rule?.value ?? ""} sampleBase={overlaySkinSampleHref("").replace(/\/$/, "")}
          saveAction={saveRuleAction.bind(null, id, rule?.value ?? "")} removeAction={rule ? removeRuleAction.bind(null, id, rule.value) : undefined} searchAction={searchValuesAction.bind(null, id)}
          labels={{
            title: rule ? t("ovp.skin.rule.edit") : t("ovp.skin.rule.new"), close: t("ovp.skin.rule.close"), cancel: t("ovp.skin.rule.cancel"), save: t("ovp.skin.rule.save"), remove: t("ovp.skin.rule.remove"),
            removeConfirm: t("ovp.skin.rule.removeConfirm"), discard: { message: t("ovp.skin.rule.discard"), discard: t("ovp.skin.rule.discardYes"), keep: t("ovp.skin.rule.discardNo") },
            valueLabel: chosen.label, search: t("ovp.skin.rule.search"), picked: t("ovp.skin.rule.picked"), change: t("ovp.skin.rule.change"), none: t("ovp.skin.rule.none"), searching: t("ovp.skin.rule.searching"),
            skinLabel: t("ovp.skin.col.skin"), preview: t("ovp.skin.rule.preview"), saved: t("ovp.skin.saved"),
          }} />
      )}
    </div>
  );
}
