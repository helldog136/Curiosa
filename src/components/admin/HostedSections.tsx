import { Suspense } from "react";
import { adminCtx } from "@/core/admin";
import { findPage } from "@/core/modules/places";
import { placeIndexFor } from "@/core/modules/placesLoad";
import { getActiveInstances } from "@/core/modules/registry";
import { sectionQuery, soleOnTab } from "@/core/modules/placeScope";
import { PlaceSectionCard, loadPlaceSection } from "./PlaceSection";

/**
 * (core 0.34.0) Sections that modules add to a CORE page (`site.general.privacy`, `site.appearance.colors`, `obs.pages.addresses`…), shown on the core page itself, under
 * its own content: the same card as on a place page (origin always shown, its own save, isolation of a failing module). `tabs` limits the places shown here (a core page that
 * has tabs puts each tab's sections in that tab; the rest of the page shows the others). Nothing when no module adds anything: the core page is exactly what it was.
 * `base` is the address of the core page, where the module's actions come back to.
 */
async function Hosted({ page, tabs, base, query = {}, wrap }: {
  page: string; tabs?: readonly string[]; base: string; query?: Record<string, string>;
  /** Wraps each tab's block (the settings page uses `data-tab` wrappers so its client tabs show them in the right tab). */
  wrap?: (tab: string, children: React.ReactNode) => React.ReactNode;
}) {
  const { user, t, locale, config, advanced } = await adminCtx("member");
  const [g, p] = page.split(".") as [string, string];
  const found = findPage(await placeIndexFor(user, advanced, locale, config.defaultLocale), g, p);
  if (!found) return null;
  const actives = await getActiveInstances();
  const blocks: React.ReactNode[] = [];
  for (const tab of found.tabs) {
    if (tabs && !tabs.includes(tab.id)) continue;
    const loaded = (await Promise.all(tab.sections.map(async (s) => {
      const active = actives.find((a) => a.instance.id === s.instanceId);
      return active ? loadPlaceSection(s, active, user, { locale, advanced, query: sectionQuery(query, s.instanceKey, soleOnTab(tab)) }) : null;
    }))).filter((x): x is NonNullable<typeof x> => x !== null);
    if (loaded.length === 0) continue;
    const inner = (
      <div className="space-y-6" data-testid="hosted-sections" data-place={`${page}.${tab.id}`}>
        {loaded.map((l) => <PlaceSectionCard key={l.section.anchor} loaded={l} t={t} locale={locale} config={config} advanced={advanced} showOrigin base={base} />)}
      </div>
    );
    blocks.push(wrap ? <div key={tab.id}>{wrap(tab.id, inner)}</div> : <section key={tab.id} aria-label={tab.title} className="space-y-3">{found.tabs.length > 1 && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{tab.title}</h2>}{inner}</section>);
  }
  return blocks.length ? <>{blocks}</> : null;
}

/** Streams in after the core page's own content, so a slow module never holds the page. */
export function HostedSections(props: Parameters<typeof Hosted>[0]) {
  return <Suspense fallback={null}><Hosted {...props} /></Suspense>;
}
