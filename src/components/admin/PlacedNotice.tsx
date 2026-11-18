import type { Translator } from "@/core/i18n/dictionary";
import { addedInList, groupStatus, isCorePage, pageId, placeBreadcrumb, placeHref, sectionAnchor, type PlaceSection } from "@/core/modules/places";
import { currentVocabulary } from "@/core/modules/placesLoad";
import { getModule } from "@/core/modules/registry";
import { moduleSections } from "@/core/modules/places";
import { Callout } from "./Page";

/**
 * (core 0.31.0) After an install: « Réglages ajoutés dans : En direct › Alertes, En direct › Récompenses → ». Built from the manifest, so it is true before any
 * page is drawn. Nothing when the module declares no place (it keeps its own page, as before).
 */
export async function PlacedNotice({ t, locale, moduleId }: { t: Translator; locale: string; moduleId: string }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(moduleId)) return null;
  const mod = await getModule(moduleId).catch(() => null);
  if (!mod) return null;
  const vocab = currentVocabulary();
  const { items, more } = addedInList(moduleSections(mod.manifest, vocab.aliases), vocab, locale);
  if (!items.length) return null;
  return (
    <Callout tone="ok" role="status" testid="placed-notice">
      {t("places.addedIn")}{" "}
      {items.map((x, i) => <span key={x.href}>{i > 0 ? ", " : ""}<a href={x.href} className="font-medium underline">{x.label} →</a></span>)}
      {more > 0 && <> {t("places.andMore", { n: more })}</>}
    </Callout>
  );
}

/**
 * (core 0.31.0) Per-module view, part 1: where this module's settings and lists are now, one line per place with a direct link (VS Code's grouping by extension,
 * Home Assistant's "what this integration provides"). Shown at the top of the module page when the module declares places.
 */
export function WhereSettings({ t, locale, sections, instanceKey }: { t: Translator; locale: string; sections: PlaceSection[]; instanceKey: string }) {
  const vocab = currentVocabulary();
  // R33: shown only when it tells the person something to act on, i.e. the module has settings or lists on other pages; one compact line of links, no frame.
  const shown = sections.filter((s) => groupStatus(s.place.group, vocab) !== "reserved" && (s.settings.length > 0 || s.panelTabs.length > 0 || s.blocks));
  if (!shown.length) return null;
  const lines = [...new Map(shown.map((s) => [`${pageId(s.place)}.${s.place.tab ?? ""}`, s])).values()];
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" data-testid="where-settings">
      <span className="text-muted">{t("places.where")}</span>
      {lines.map((s, i) => {
        const core = isCorePage(s.place, vocab);
        const href = core ? `${vocab.pages.find((p) => p.id === pageId(s.place))!.href!}#${sectionAnchor(instanceKey, s.id)}` : `${placeHref(s.place.group, s.place.page, s.place.tab)}#${sectionAnchor(instanceKey, s.id)}`;
        return <span key={`${pageId(s.place)}.${s.place.tab ?? ""}`}>{i > 0 && <span aria-hidden className="mr-2 text-muted">·</span>}<a href={href} className="inline-flex min-h-8 items-center underline hover:text-accent">{placeBreadcrumb(s.place, vocab, locale)} →</a></span>;
      })}
    </p>
  );
}
