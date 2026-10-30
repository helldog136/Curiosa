import Link from "next/link";
import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { buildCatalog } from "@/core/overlays/catalog";
import { defaultOf } from "@/core/overlays/options";
import { catalogKey, MAX_ELEMENTS_PER_PAGE, MAX_SIDE, MIN_SIDE, RESOLUTIONS, testActive } from "@/core/overlays/model";
import { OPTIONS_FOLDED_AFTER } from "@/core/overlays/decl";
import { getPage } from "@/core/overlays/store";
import { localized } from "@/core/modules/types";
import { siteTimezone } from "@/core/siteTime";
import { floatingLabels } from "@/components/admin/floating";
import { ActionForm } from "@/components/admin/ActionForm";
import { OverlayEditor, type ClientElement, type EditorElement } from "@/components/admin/OverlayEditor";
import { PendingButton } from "@/components/admin/PendingButton";
import { Callout, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { savePageAction, testAction } from "../actions";

export const dynamic = "force-dynamic";

/** Les textes de l'éditeur (ovp.ed.<clé>) : envoyés tels quels au navigateur, qui n'a pas le dictionnaire. */
const STRINGS = [
  "name", "resolution", "resolutionOther", "resolutionHelp", "width", "height", "style", "styleHelp", "style.text", "style.text.light", "style.text.dark", "style.background", "style.background.transparent", "style.background.soft",
  "style.corners", "style.corners.round", "style.corners.square", "preview", "add", "backToEdit", "live", "liveHelp", "count", "full", "noneAvailable", "cancel", "canvasHelp", "hidden", "gone", "goneHelp", "elements", "empty",
  "visible", "panel", "field.x", "field.y", "field.w", "field.h", "anchor", "anchorHelp", "margin", "front", "back", "up", "down", "options", "moreOptions", "noStyle", "remove", "removed", "added",
  "fit.scale", "fit.ratio", "fit.fluid", "anchor.tl", "anchor.tc", "anchor.tr", "anchor.ml", "anchor.c", "anchor.mr", "anchor.bl", "anchor.bc", "anchor.br",
] as const;

/** Heure de fin du mode test, dans le fuseau du site : « 21 h 40 » (français), « 9:40 PM » (anglais). */
function endTime(at: number, locale: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return locale === "fr" ? `${String(h).padStart(2, "0")} h ${m}` : `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export default async function OverlayPageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale, config } = await adminCtx(OVERLAY_NEED);
  const { id } = await params;
  const page = await getPage(id);
  if (!page) notFound();
  const catalog = await buildCatalog(locale, config.defaultLocale);
  const tz = await siteTimezone();
  const now = Date.now();
  const testing = testActive(page.testUntil, now);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  const available: ClientElement[] = [...catalog.values()].sort((a, b) => a.instanceLabel.localeCompare(b.instanceLabel) || L(a.decl.label).localeCompare(L(b.decl.label))).map((c) => ({
    key: catalogKey(c.instance, c.decl.id), instance: c.instance, element: c.decl.id, group: c.instanceLabel, title: `${c.instanceLabel} · ${L(c.decl.label)}`, label: L(c.decl.label), description: L(c.decl.description),
    layout: { fit: c.decl.fit, size: c.decl.size, referenceHeight: c.decl.referenceHeight, ratios: c.decl.ratios, minSize: c.decl.minSize }, followsStyle: c.decl.followsStyle,
    options: c.decl.options.map((o) => ({
      id: o.id, type: o.type, label: L(o.label), help: L(o.help), example: o.example ?? "", default: defaultOf(o),
      choices: o.type === "choice" ? o.choices.map((x) => ({ value: x.value, label: L(x.label) })) : [],
    })),
  }));
  const initial: EditorElement[] = page.elements.map((e) => ({ ...e, ...(catalog.has(catalogKey(e.instance, e.element)) ? {} : { missing: true }) }));
  const strings = Object.fromEntries(STRINGS.map((k) => [`ed.${k}`, t(`ovp.ed.${k}`)]));

  return (
    <div className="space-y-6">
      <PageHeader title={page.name} intro={t("ovp.editIntro")}>
        <Link href="/admin/overlay-pages" className={ui.btn}>{t("ovp.back")}</Link>
      </PageHeader>

      <section aria-label={t("ovp.test")} className={`rounded-2xl border p-4 ${testing ? "border-amber-500/50 bg-amber-500/10" : "border-line bg-surface"}`} data-testid="test-mode">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">{t("ovp.test")}</h2>
          {testing ? (
            <>
              <p role="status" className="text-sm font-medium">{t("ovp.testOn", { time: endTime(page.testUntil!, locale, tz) })}</p>
              <form action={testAction.bind(null, page.id, "stop")}><PendingButton variant="btn">{t("ovp.testStop")}</PendingButton></form>
              <form action={testAction.bind(null, page.id, "extend")}><PendingButton variant="btn">{t("ovp.testExtend")}</PendingButton></form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">{t("ovp.testOff")}</p>
              <form action={testAction.bind(null, page.id, "start")}><PendingButton variant="btn">{t("ovp.testStart")}</PendingButton></form>
            </>
          )}
        </div>
        <p className={ui.help}>{t("ovp.testHelp")}</p>
      </section>

      {!page.active && <Callout tone="warn">{t("ovp.inactiveNote")}</Callout>}

      <ActionForm action={savePageAction.bind(null, page.id)} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-6">
        <OverlayEditor
          pageId={page.id}
          initial={{ name: page.name, width: page.width, height: page.height, style: page.style, elements: initial }}
          available={available}
          resolutions={RESOLUTIONS.map(([w, h]) => [w, h])}
          limits={{ elements: MAX_ELEMENTS_PER_PAGE, fold: OPTIONS_FOLDED_AFTER, minSide: MIN_SIDE, maxSide: MAX_SIDE }}
          previewSrc={`/admin/overlay-pages/${page.id}/preview`}
          strings={strings}
        />
      </ActionForm>
    </div>
  );
}
