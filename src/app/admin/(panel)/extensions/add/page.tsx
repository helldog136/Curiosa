import { adminCtx } from "@/core/admin";
import { EXTENSIONS_ADD_DETAILS_HREF, withQuery } from "@/core/adminLinks";
import { can as canDo } from "@/core/auth/access";
import { getCatalogue, getCatalogueSource } from "@/core/modules/catalogue";
import { getCoreVersion } from "@/core/modules/compat";
import { getInstalledModules, listModuleRows } from "@/core/modules/registry";
import { entryTopics, facetList, filterByTopic } from "@/core/modules/catalogueFacets";
import { currentVocabulary } from "@/core/modules/placesLoad";
import { parseTopic, topicTitle } from "@/core/modules/places";
import { TopicPicker } from "@/components/admin/TopicPicker";
import { relativeAge } from "@/core/relativeTime";
import { listRetired } from "@/core/modules/retired";
import { groupByModule } from "@/core/modules/retiredPlan";
import { eraseRetiredAction } from "../../modules/actions";
import { localized } from "@/core/modules/types";
import { TextField } from "@/components/admin/Field";
import { ExtensionsHeader } from "@/components/admin/ExtensionsHeader";
import { ui } from "@/components/admin/ui";
import Link from "next/link";
import { CatalogueDetailsLink } from "@/components/admin/CatalogueDetailsLink";
import { CatalogueSearch } from "@/components/admin/CatalogueSearch";
import { OriginFilter } from "@/components/admin/OriginFilter";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { discoverModules, isTruncated, listSources, sourceAddress, type SourceModule } from "@/core/modules/sources";
import { buildNames, viewPlan, type PlanView } from "@/core/modules/dependencyView";
import { DependencyPlanBox } from "@/components/admin/DependencyPlanBox";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { addSourceAction, refreshCatalogueAction, refreshSourcesAction, removeSourceAction } from "./actions";
import { HelpTip } from "@/components/admin/HelpTip";
import { PendingButton } from "@/components/admin/PendingButton";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => `${t("nav.extensions")} \u00b7 ${t("hub.tab.catalogue")}`);
}

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ error?: string; topic?: string; origin?: string }> }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const { error, topic: rawTopic, origin: rawOrigin } = await searchParams;
  const topic = parseTopic(rawTopic);
  const isOwner = canDo(user, "core:modules.install"); // peut installer des extensions
  // (0.47.0) The entries of personal catalogues are shown only to those who may install (the names of a private repository are not for everyone).
  const entries = (await getCatalogue()).filter((e) => isOwner || !e.personal);
  const source = await getCatalogueSource();
  const installed = new Set((await listModuleRows()).map((r) => r.id));
  // Données gardées d'extensions retirées : on le dit sur leur carte, et on les liste (pour les effacer ou réinstaller) tant que l'extension n'est pas revenue.
  const keptGroups = groupByModule(await listRetired()).filter((g) => !installed.has(g.moduleId));
  const keptIds = new Set(keptGroups.map((g) => g.moduleId));
  const sources = isOwner && advanced ? await listSources() : [];
  const found = await Promise.all(sources.map(async (s) => ({ s, modules: await discoverModules(s).catch((): SourceModule[] | null => null) })));
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  // « Installe aussi : … » sur chaque carte dont le module dépend d'un autre (ce que l'index ou le manifeste annonce).
  const names = await buildNames(locale, config.defaultLocale, entries);
  const plans = new Map<string, PlanView>();
  for (const e of entries) if (!installed.has(e.id) && e.compatible && (e.needs?.length ?? 0) > 0) plans.set(e.id, await viewPlan(e.id, e.needs!, names, entries));
  // (0.34.0) Topics as facets: what each module adds settings to (index, or the manifest when installed), and the filter by topic.
  const vocab = currentVocabulary();
  const manifests = new Map((await getInstalledModules()).map((m) => [m.manifest.id, m.manifest] as const));
  const topicsByEntry = new Map(entries.map((e) => [e.id, entryTopics(e, manifests.get(e.id), vocab.aliases)] as const));
  const facets = facetList(topicsByEntry, vocab, locale);
  // (0.47.0) Personal catalogues: one table of cards, a quick filter by origin (only when there is something personal to tell apart).
  const hasPersonal = entries.some((e) => e.personal);
  const origin = hasPersonal && (rawOrigin === "personal" || rawOrigin === "official") ? rawOrigin : null;
  const shown = filterByTopic(entries, topic, topicsByEntry).filter((e) => !origin || (origin === "personal") === !!e.personal);
  const originHref = (o: "personal" | "official" | null) => withQuery(EXTENSIONS_ADD_HREF, { ...(topic ? { topic } : {}), ...(o ? { origin: o } : {}) });
  const personalCount = new Set(entries.filter((e) => e.personal).map((e) => e.personal!.id)).size;
  const groups = [{ id: "recognized", title: advanced ? t("catalogue.community") : t("catalogue.community.simple"), list: shown }];
  // Sans réseau ni dernière copie reçue, la liste est vide : on le dit (jamais une copie locale), et « Actualiser » réessaie.
  const unreachable = source.source === "none" && entries.length === 0;

  return (
    <div className="space-y-8">
      <ExtensionsHeader t={t} advanced={advanced} isOwner={isOwner} current="add" intro={t("catalogue.intro.short")} tip={advanced ? t("catalogue.intro") : t("catalogue.intro.simple")} />
      {/* R2: the task is finding an extension, so the search and the one compact filter come first; the freshness of the list is one small line (exact time in the tooltip). */}
      <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-64"><CatalogueSearch placeholder={t("catalogue.search")} noneLabel={t("catalogue.searchNone")} clearLabel={t("catalogue.searchClear")} /></div>
        <TopicPicker options={facets.map((f) => ({ ...f, href: `${EXTENSIONS_ADD_HREF}?topic=${f.id}` }))} current={topic} allHref={EXTENSIONS_ADD_HREF}
          labels={{ label: t("catalogue.addsTo"), search: t("catalogue.topicSearch"), none: t("catalogue.topicNoMatch"), all: t("catalogue.topicAll"), remove: t("catalogue.topicRemove", { name: "{name}" }), list: t("catalogue.addsTo") }} />
      </div>
      {hasPersonal && <OriginFilter t={t} current={origin} href={originHref} counts={{ all: entries.length, official: entries.filter((e) => !e.personal).length, personal: entries.filter((e) => e.personal).length }} />}
      {advanced && source.source !== "none" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" data-testid="catalogue-freshness">
          <span title={new Date(source.fetchedAt ?? 0).toLocaleString(locale)}>{t(source.source === "cache" ? "catalogue.source.cache" : "catalogue.updatedAgo", { when: relativeAge(source.fetchedAt, locale) })}</span>
          {isOwner && <form action={refreshCatalogueAction}><PendingButton variant="link" pendingLabel={t("progress.checking")} className="underline">{t("catalogue.refresh")}</PendingButton></form>}
        </div>
      )}
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error) : t("error.generic")}</p>}

      {groups.map((g) => g.list.length > 0 && (
        <section key={g.id} data-catalogue-section className="space-y-4">
          <h2 className="sr-only">{g.title}</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {g.list.map((e) => (
              <li key={e.id} data-catalogue-item data-search={fold(`${L(e.name)} ${L(e.description)} ${e.id} ${(topicsByEntry.get(e.id) ?? []).map((x) => topicTitle(x, vocab, locale)).join(" ")}`)} className={`${ui.card} flex flex-col gap-4`}>
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{e.icon ?? "🧩"}</span>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-tight">{L(e.name)}{advanced && e.version && <span className="ml-2 text-xs font-normal text-muted">v{e.version}</span>}</p>
                    <p className="mt-1 line-clamp-4 text-sm leading-5 text-muted">{L(e.description)}</p>
                    {advanced && e.repo && e.origin === "extra" && <p className="mt-1 break-all font-mono text-xs text-muted">{e.repo}{e.ref ? `#${e.ref}` : ""}</p>}
                  </div>
                </div>
                {(topicsByEntry.get(e.id) ?? []).length > 0 && (
                  <p className="text-sm text-muted" data-testid={`topics-${e.id}`}>
                    {t("catalogue.addsTo")}{" "}
                    {(topicsByEntry.get(e.id) ?? []).map((x, i) => <span key={x}>{i > 0 ? ", " : ""}<a href={`${EXTENSIONS_ADD_HREF}?topic=${x}`} className="underline hover:text-accent">{topicTitle(x, vocab, locale)}</a></span>)}
                  </p>
                )}
                {keptIds.has(e.id) && <p className="rounded-xl bg-accent/10 px-3 py-2 text-sm" data-testid={`kept-card-${e.id}`}>🗂 {t("kept.cardNote", { name: L(e.name) })}</p>}
                {plans.get(e.id) && <DependencyPlanBox view={plans.get(e.id)!} t={t} names={names} compact />}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-2">{e.personal ? <span className={ui.chipWarn} data-testid={`origin-${e.id}`}>⚠ {t(personalCount > 1 ? "catalogue.pill.personalNamed" : "catalogue.pill.personal", { name: e.personal.name })}</span> : e.origin === "extra" && <span className={ui.chipWarn}>⚠ {t("catalogue.origin.extra")}</span>}{e.suggested && <span className={ui.chipOk}>⭐ {t("catalogue.suggested")}</span>}</span>
                  {installed.has(e.id) ? (
                    <a href={EXTENSIONS_HREF} className="text-sm font-medium text-accent hover:underline">{t("catalogue.installed")}</a>
                  ) : !e.compatible ? (
                    <span className="text-sm text-muted">{t("catalogue.incompatible")}</span>
                  ) : e.needsNewerCore ? (
                    <span className="text-sm text-muted">{t("modules.core.badge", { version: e.needsNewerCore, current: getCoreVersion() })}</span>
                  ) : (
                    <CatalogueDetailsLink href={withQuery(EXTENSIONS_ADD_DETAILS_HREF, { id: e.id })} query={`id=${encodeURIComponent(e.id)}`} className={ui.btnPrimary} pendingLabel={t("progress.opening")}>{advanced ? t("catalogue.details") : t("catalogue.details.simple")}</CatalogueDetailsLink>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {keptGroups.length > 0 && (
        <section className="space-y-3" data-testid="kept-groups">
          <div>
            <h2 className="flex items-center gap-1 text-lg font-semibold">{t("kept.addTitle")} <HelpTip always help={t("kept.addHelp")} name={t("kept.addTitle")} /></h2>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {keptGroups.map((g) => {
              const entry = entries.find((e) => e.id === g.moduleId);
              const name = entry ? L(entry.name) : g.moduleName;
              const href = entry && entry.compatible && !entry.needsNewerCore ? withQuery(EXTENSIONS_ADD_DETAILS_HREF, { id: g.moduleId }) : g.repoUrl && advanced ? withQuery(EXTENSIONS_ADD_DETAILS_HREF, { repo: `${g.repoUrl}${g.ref || g.subdir ? `#${g.ref ?? ""}${g.subdir ? `:${g.subdir}` : ""}` : ""}` }) : null;
              return (
                <li key={g.moduleId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-testid={`kept-group-${g.moduleId}`}>
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block break-words font-medium">{name}</span>
                    <span className="block text-xs text-muted">{t("kept.counts", { entries: g.entryCount, records: g.recordCount })} · {g.retiredAt.toLocaleDateString(locale)}{!href && ` · ${t("kept.noSource")}`}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {href && <Link href={href} scroll={false} className={ui.btn}>{t("kept.reinstall")}</Link>}
                    {isOwner && <form action={eraseRetiredAction.bind(null, { moduleId: g.moduleId })}><ConfirmButton confirmLabel={t("remove.eraseYes")} dangerConfirm message={t("kept.eraseConfirm", { name })}>{t("kept.erase")}</ConfirmButton></form>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {unreachable && (
        <div role="alert" data-testid="catalogue-unreachable" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <span>{t("catalogue.unreachable")}</span>
          {isOwner && <form action={refreshCatalogueAction}><PendingButton variant="link" pendingLabel={t("progress.checking")} className="underline">{t("catalogue.refresh")}</PendingButton></form>}
        </div>
      )}
      {topic && shown.length === 0 && entries.length > 0 && <p className="text-muted" data-testid="topic-none">{t("catalogue.topicNone")} <a href={EXTENSIONS_ADD_HREF} className="underline hover:text-accent">{t("catalogue.topicClear")}</a></p>}
      {entries.length === 0 && !unreachable && <p className="text-muted">{t("catalogue.empty")}</p>}

      {isOwner && advanced && (
        <section className={`${ui.card} space-y-4`}>
          <h2 className="flex items-center gap-1 text-lg font-semibold">{t("catalogue.sources")} <HelpTip always help={t("catalogue.sources.intro")} name={t("catalogue.sources")} /></h2>
          {found.map(({ s, modules }) => (
            <div key={`${s.url}#${s.ref ?? ""}`} className="space-y-3 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="break-all font-mono text-xs">{s.url}{s.ref ? `#${s.ref}` : ""}</p>
                <form action={removeSourceAction.bind(null, s.url)}><ConfirmButton message={t("catalogue.sources.removeConfirm")}>{t("catalogue.sources.remove")}</ConfirmButton></form>
              </div>
              {modules === null ? <p className="text-sm text-muted">{t("catalogue.sources.unreachable")}</p>
                : modules.length === 0 ? <p className="text-sm text-muted">{t("catalogue.sources.none")}</p>
                : (
                  <>
                  {isTruncated(modules) && <p className="text-sm text-amber-700 dark:text-amber-300" role="status">{t("catalogue.sources.truncated", { count: String(modules.length) })}</p>}
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {modules.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-bg p-3">
                        <span className="min-w-0 flex-1 basis-40"><span className="block break-words font-medium">{m.icon ?? "🧩"} {L(m.name)} <span className="text-xs font-normal text-muted">v{m.version}</span></span><span className="line-clamp-2 text-xs text-muted">{L(m.description)}</span></span>
                        {installed.has(m.id) ? <a href={EXTENSIONS_HREF} className="shrink-0 text-sm text-accent hover:underline">{t("catalogue.installed")}</a>
                          : !m.compatible ? <span className="shrink-0 text-sm text-muted">{t("catalogue.incompatible")}</span>
                          : <a href={withQuery(EXTENSIONS_ADD_DETAILS_HREF, { repo: sourceAddress(s, m) })} className={`${ui.btn} shrink-0`}>{t("catalogue.details")}</a>}
                      </li>
                    ))}
                  </ul>
                  </>
                )}
            </div>
          ))}
          <ActionForm action={addSourceAction} submitLabel={t("catalogue.sources.add")} pendingLabel={t("progress.checking")}>
            <TextField name="repo" type="url" label={t("modules.repoUrl")} placeholder="https://github.com/jeanmi/mes-modules-curiosa" required help={t("modules.repoHelp")} />
          </ActionForm>
          {sources.length > 0 && <form action={refreshSourcesAction}><PendingButton variant="link" pendingLabel={t("progress.checking")} className="!text-xs underline">{t("catalogue.sources.refresh")}</PendingButton></form>}
        </section>
      )}

      {isOwner && advanced && (
        <details className={`${ui.card} space-y-4`}>
          <summary className="cursor-pointer text-lg font-semibold">{t("catalogue.custom")}</summary>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("catalogue.customWarning")}</p>
          <form action={EXTENSIONS_ADD_DETAILS_HREF} method="get" className="space-y-3">
            <TextField name="repo" type="url" label={t("modules.repoUrl")} placeholder="https://github.com/owner/curiosa-module-example" required help={t("modules.repoHelp")} />
            <button className={ui.btnPrimary}>{t("catalogue.preview")}</button>
          </form>
        </details>
      )}
    </div>
  );
}
