import { notFound, redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { instanceHref } from "@/core/adminLinks";
import { findPage, pageId, parsePlace, placeHref, placeId, resolveAlias, type IndexedPage } from "@/core/modules/places";
import { coreSectionHref } from "@/core/modules/coreSections";
import { sectionQuery, soleOnTab } from "@/core/modules/placeScope";
import { currentVocabulary, placeIndexFor } from "@/core/modules/placesLoad";
import { getActiveInstances } from "@/core/modules/registry";
import { LinkTabs } from "@/components/admin/LinkTabs";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { PlaceSectionCard, loadPlaceSection } from "@/components/admin/PlaceSection";
import { classifySections, EDIT_PARAM } from "@/components/admin/connectionsLoad";
import { ConnectionsTable } from "@/components/admin/ConnectionsTable";
import { AccountEditor } from "@/components/admin/AccountEditor";
import { connectionsLabels } from "@/components/admin/connectionRows";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

type Params = { group: string; page: string; tab?: string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { group, page, tab: rest } = await params;
  return adminTitle(async ({ user, locale, config }) => {
    const asked = parsePlace(`${group}.${page}${rest?.[0] ? `.${rest[0]}` : ""}`);
    if (!asked || !user) return "";
    const { place } = resolveAlias(asked, currentVocabulary().aliases);
    return findPage(await placeIndexFor(user, user.advanced, locale, config.defaultLocale), place.group, place.page)?.title ?? "";
  }, { need: "member" });
}

/**
 * A PLACE PAGE (core 0.31.0): `/admin/<group>/<page>[/<tab>]`, built from what the installed modules declare (docs/PLACES.md). No contributor, no page (404).
 * Link tabs (one address per tab, only the open tab is rendered); on a phone the tabs become a list of rows with the open one unfolded (accordion).
 * Sections in order, each isolated (time budget, "unavailable" line), each with its own save; one floating Save bar for the whole tab.
 */
export default async function PlacePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { group, page, tab: rest } = await params;
  if ((rest?.length ?? 0) > 1) notFound();
  const asked = parsePlace(`${group}.${page}${rest?.[0] ? `.${rest[0]}` : ""}`);
  if (!asked) notFound();
  const { user, t, locale, config, advanced } = await adminCtx("member");
  const vocab = currentVocabulary();
  // A renamed place (alias) keeps working: its old address leads to the new one.
  const { place, aliased } = resolveAlias(asked, vocab.aliases);
  const sp = await searchParams;
  // The parameters of the old address are kept (a bookmark with `?acme.edit=3` still opens the same window); the fragment is kept by the browser.
  const carried = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : []))).toString();
  if (aliased) redirect(`${placeHref(place.group, place.page, place.tab)}${carried ? `?${carried}` : ""}`);
  const index = await placeIndexFor(user, advanced, locale, config.defaultLocale);
  const found = findPage(index, place.group, place.page);
  if (!found) notFound();
  // A core page keeps its own address (bookmarks, mails): its place id leads there.
  if (found.core) redirect(`${coreSectionHref(place.tab ? placeId(place) : pageId(place)) ?? found.href}`);
  const current = place.tab ? found.tabs.find((x) => x.id === place.tab) : found.tabs[0];
  if (!current) redirect(placeHref(place.group, place.page));
  const query = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const actives = await getActiveInstances();
  // Sections load side by side, each within its own time budget: a slow or broken module never holds the page.
  const loaded = (await Promise.all(current.sections.map(async (s) => {
    const active = actives.find((a) => a.instance.id === s.instanceId);
    // (0.34.0) Each module reads its own namespaced parameters only (docs/PLACES.md, « Parameters »).
    return active ? loadPlaceSection(s, active, user, { locale, advanced, query: sectionQuery(query, s.instanceKey, soleOnTab(current)) }) : null;
  }))).filter((x): x is NonNullable<typeof x> => x !== null);
  const showOrigin = (p: IndexedPage, siblings: boolean) => p.modules.length > 1 || siblings || p.inline;
  const tabHref = (id: string, i: number) => (i === 0 ? placeHref(place.group, place.page) : placeHref(place.group, place.page, id));

  // (C5c) A page whose vocabulary says `layout: "table"`: its single-address sections are the rows of ONE table; the other sections stay cards.
  const here = tabHref(current.id, found.tabs.indexOf(current));
  const grouped = found.layout === "table" ? await classifySections(loaded, { t, locale, defaultLocale: config.defaultLocale, locales: config.locales, advanced, pageHref: () => here, editBase: () => here }) : null;
  const cards = grouped ? grouped.rest : loaded;
  const editAsked = query[EDIT_PARAM];
  const editing = grouped && editAsked ? grouped.addresses.get(editAsked) : undefined;
  const body = loaded.length > 0 ? (
    <div className="space-y-6">
      {grouped && grouped.rows.length > 0 && <ConnectionsTable rows={grouped.rows} labels={connectionsLabels(t)} />}
      {editing && <AccountEditor loaded={editing} closeHref={here} t={t} locale={locale} config={config} advanced={advanced} />}
      {cards.map((l) => <PlaceSectionCard key={l.section.anchor} loaded={l} t={t} locale={locale} config={config} advanced={advanced} showOrigin={showOrigin(found, l.section.siblings)} base={tabHref(current.id, found.tabs.indexOf(current))} />)}
      {seeAlso(found, current.sections.flatMap((s) => s.section.seeAlso), index, t)}
    </div>
  ) : (
    <EmptyState icon="🗂️" title={t("places.empty.title")}>
      {[...new Map(current.sections.map((s) => [s.instanceId, s])).values()].map((s, i) => (
        <span key={s.instanceId}>{i > 0 ? " · " : ""}<a href={instanceHref(s.instanceId)} className="underline hover:text-accent">{s.siblings ? s.instanceLabel : s.moduleName} →</a></span>
      ))}
    </EmptyState>
  );

  const tabs = found.tabs.map((x, i) => ({ id: x.id, href: tabHref(x.id, i), label: x.title }));
  const currentIndex = found.tabs.indexOf(current);
  return (
    <div className="space-y-6" data-testid="place-page" data-place={found.id}>
      <PageHeader title={found.title} intro={found.intro ?? undefined} />
      {tabs.length > 1 ? (
        <>
          <div className="hidden md:block"><LinkTabs tabs={tabs} current={current.id} label={t("places.tabs", { page: found.title })} testid="place-tabs" /></div>
          {/* Phone: the tabs as accordion rows; only the open one shows its sections (each row keeps its own address). */}
          <nav aria-label={t("places.tabs", { page: found.title })} className="space-y-2 md:hidden" data-testid="place-accordion">
            {tabs.slice(0, currentIndex).map((x) => <AccordionRow key={x.id} href={x.href} label={x.label} />)}
            <AccordionRow href={tabs[currentIndex]!.href} label={tabs[currentIndex]!.label} open />
          </nav>
          {body}
          <nav aria-label={t("places.tabsMore")} className="space-y-2 md:hidden">
            {tabs.slice(currentIndex + 1).map((x) => <AccordionRow key={x.id} href={x.href} label={x.label} />)}
          </nav>
        </>
      ) : body}
    </div>
  );
}

function AccordionRow({ href, label, open = false }: { href: string; label: string; open?: boolean }) {
  return (
    <a href={href} aria-current={open ? "page" : undefined}
      className={`flex min-h-11 items-center justify-between rounded-xl border px-4 py-2 text-[15px] font-medium ${open ? "border-accent text-accent" : "border-line text-fg hover:border-accent/50"}`}>
      {label}<span aria-hidden className={`text-sm text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
    </a>
  );
}

/** "See also" links (R25): only to places this person can open, never an outside address. */
function seeAlso(here: IndexedPage, ids: string[], index: Awaited<ReturnType<typeof placeIndexFor>>, t: Awaited<ReturnType<typeof adminCtx>>["t"]) {
  const pages = [...new Set(ids)].flatMap((id) => { const p = parsePlace(id); const f = p ? findPage(index, p.group, p.page) : null; return f && f.id !== here.id ? [f] : []; });
  if (!pages.length) return null;
  return (
    <p className="text-sm" data-testid="place-see-also">
      {t("places.seeAlso")}{" "}
      {pages.map((p, i) => <span key={p.id}>{i > 0 ? " · " : ""}<a href={p.href} className="underline hover:text-accent">{p.title} →</a></span>)}
    </p>
  );
}
