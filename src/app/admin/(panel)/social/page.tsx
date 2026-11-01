import { adminCtx } from "@/core/admin";
import { can as canDo } from "@/core/auth/access";
import { getCatalogue } from "@/core/modules/catalogue";
import { getInstanceLabeler } from "@/core/modules/labels";
import { localized } from "@/core/modules/types";
import { providersOf } from "@/core/services/topics";
import { loadSocialEntries, MAX_SOCIALS, orderedKeys, readSocialPrefs, socialOrigin, SOCIAL_TOPIC, type SocialEntry } from "@/core/social";
import { searchText } from "@/core/adminkit/search";
import { prisma } from "@/core/db";
import { EntryIcon } from "@/components/site/EntryIcon";
import { ui } from "@/components/admin/ui";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { SocialSwitch } from "@/components/admin/SocialSwitch";
import { PendingButton } from "@/components/admin/PendingButton";
import { SocialPaste, type SocialPasteLabels } from "@/components/admin/SocialPaste";
import { socialSourcesOf } from "@/core/socialRecognize";
import { resolveIcon } from "@/core/icons";
import { addNetwork, moveSocial } from "./actions";

export const dynamic = "force-dynamic";

const ORIGIN_CHIP = { network: ui.chip, channel: ui.chipOk, other: "inline-flex items-center gap-1 rounded-full bg-line/60 px-2.5 py-0.5 text-xs font-medium" } as const;

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const { error } = await searchParams;
  const providers = await providersOf(SOCIAL_TOPIC);
  const entries = await loadSocialEntries(locale);
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const prefs = await readSocialPrefs();
  const market = (await getCatalogue().catch(() => [])).filter((e) => e.compatible && e.provides?.includes(SOCIAL_TOPIC));
  const counts = new Map<string, number>();
  for (const row of await prisma.moduleInstance.groupBy({ by: ["moduleId"], _count: true })) counts.set(row.moduleId, row._count);
  const isOwner = canDo(user, "core:modules.install"); // peut installer des extensions

  // Une ligne par réseau actif, dans l'ordre choisi ; un réseau sans adresse valable est une ligne « À régler ».
  const byKey = new Map(providers.map((p) => [p.instance.key, p]));
  const keys = orderedKeys(providers.map((p) => p.instance.key).sort((a, b) => a.localeCompare(b)), prefs.order);
  const entriesOf = (key: string): SocialEntry[] => entries.filter((e) => e.link.instance === key);
  const shownCount = entries.filter((e) => e.status === "shown").length;
  const duplicates = entries.filter((e) => e.status === "duplicate").length;
  const beyond = entries.filter((e) => e.status === "limit").length;
  const rows = keys.map((key) => {
    const { instance, mod } = byKey.get(key)!;
    const mine = entriesOf(key);
    const on = !prefs.hidden.has(key);
    const state = mine.length === 0 ? "todo" : on ? "shown" : "hidden";
    const name = mine.length === 1 ? mine[0]!.link.label : mine.length > 1 ? `${labeler.label(instance)} (${mine.length})` : labeler.label(instance);
    const addresses = mine.map((e) => e.link.href);
    const origin = socialOrigin(mod.manifest);
    const note = mine.some((e) => e.status === "duplicate") ? "duplicate" : mine.some((e) => e.status === "limit") ? "limit" : null;
    return { key, id: instance.id, name, icon: mine[0]?.link.icon ?? null, fallbackIcon: mod.manifest.icon, addresses, origin, state, on, note, search: searchText([name, labeler.label(instance), ...addresses, t(`social.origin.${origin}`), t(`social.state.${state}`)]) };
  });
  const stateCounts = { shown: rows.filter((r) => r.state === "shown").length, hidden: rows.filter((r) => r.state === "hidden").length, todo: rows.filter((r) => r.state === "todo").length };

  // Le champ unique : les réseaux que le Catalogue sait reconnaître (bloc `social`) ; leurs icônes sont résolues ici pour que le navigateur n'embarque pas toute la bibliothèque.
  const sources = socialSourcesOf(market);
  const icons: Record<string, { svg?: string; text?: string } | null> = {};
  for (const src of sources) { const r = resolveIcon(src.spec.icon ?? null); icons[src.id] = r ? ("svg" in r ? { svg: r.svg } : { text: r.text }) : null; }
  const example = (() => { const first = sources[0]?.spec.example; return typeof first === "string" ? first : first?.[locale] ?? first?.fr ?? Object.values(first ?? {})[0] ?? ""; })();
  const paste: SocialPasteLabels = {
    label: t("social.paste.label"), help: t("social.paste.help"), example: example ? t("field.example", { example }) : "", placeholder: "",
    add: t("social.paste.add"), addOne: t("social.paste.addOne"), addMany: t("social.paste.addMany", { n: "{n}" }), running: t("social.paste.running", { name: "{name}", n: "{n}", total: "{total}" }),
    done: t("social.paste.done", { label: "{label}" }), doneMany: t("social.paste.doneMany", { n: "{n}" }), failed: t("social.failed"),
    ready: t("social.paste.ready"), have: t("social.paste.have"), dup: t("social.paste.dup"), choose: t("social.paste.choose"), choosePlaceholder: t("social.paste.choosePlaceholder"),
    unknown: t("social.paste.unknown"), ownerOnly: t("social.ownerOnly"), clear: t("search.clear"), limit: t("social.paste.limit", { max: "{max}", n: "{n}" }),
  };

  const available = market.map((e) => ({ id: e.id, icon: e.icon, name: localized(e.name, locale, config.defaultLocale), description: localized(e.description, locale, config.defaultLocale), installed: counts.get(e.id) ?? 0 }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>{t("social.title")}</h1>
        <p className={ui.pageIntro}>{t("social.intro")}</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error, { service: "" }) : t("error.generic")}</p>}

      {sources.length > 0 && (
        <section className={`${ui.card} space-y-3`} aria-labelledby="social-paste-title">
          <h2 id="social-paste-title" className="text-lg font-semibold">{t("social.paste.title")}</h2>
          <SocialPaste sources={sources} icons={icons} existing={entries.map((e) => e.link.href)} canInstall={isOwner} shown={shownCount} max={MAX_SOCIALS} labels={paste} />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="social-mine">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="social-mine" className="text-lg font-semibold">{t("social.active")}</h2>
          {rows.length > 0 && <p className={`text-sm ${shownCount > MAX_SOCIALS ? "font-medium text-amber-700" : "text-muted"}`} role="status" data-testid="social-count">{t("social.count", { shown: shownCount, max: MAX_SOCIALS })}</p>}
        </div>
        {rows.length === 0 ? (
          <div className={`${ui.card} space-y-3 text-[15px] leading-6`} data-testid="social-empty">
            <p className="font-medium">{t("social.none")}</p>
            <p className="text-muted">{t("social.noneHelp")}</p>
            <a href="#social-add" className={`${ui.btnPrimary} min-h-11`}>{t("social.addFirst")}</a>
          </div>
        ) : (
          <>
            {(duplicates > 0 || beyond > 0) && (
              <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="social-warning">
                {[duplicates > 0 ? t("social.warnDuplicate", { n: duplicates }) : "", beyond > 0 ? t("social.warnLimit", { max: MAX_SOCIALS, n: beyond }) : ""].filter(Boolean).join(" ")}
              </p>
            )}
            <LiveSearch scope="social" placeholder={t("social.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")}
              filters={[{ key: "state", allLabel: t("table.all"), options: [
                { value: "shown", label: t("social.state.shown"), count: stateCounts.shown }, { value: "hidden", label: t("social.state.hidden"), count: stateCounts.hidden },
                ...(stateCounts.todo > 0 ? [{ value: "todo", label: t("social.state.todo"), count: stateCounts.todo }] : [])] }]} />
            <div className="relative sm:overflow-x-auto">
              <table role="table" className="w-full text-left text-sm max-sm:block" data-testid="social-active">
                <thead role="rowgroup" className="text-muted max-sm:sr-only">
                  <tr role="row">
                    <th role="columnheader" className="px-3 py-2 font-medium">{t("social.col.network")}</th>
                    <th role="columnheader" className="px-3 py-2 font-medium">{t("social.col.address")}</th>
                    <th role="columnheader" className="px-3 py-2 font-medium">{t("social.col.origin")}</th>
                    <th role="columnheader" className="px-3 py-2 font-medium">{t("social.col.shown")}</th>
                    <th role="columnheader" className="px-3 py-2 font-medium">{t("social.col.order")}</th>
                    <th role="columnheader" className="px-3 py-2"><span className="sr-only">{t("table.actions")}</span></th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="max-sm:block">
                  {rows.map((r, i) => (
                    <tr key={r.key} role="row" data-live-item="social" data-search={r.search} data-live-state={r.state} data-testid="social-row"
                      className="border-t border-line align-middle max-sm:mb-3 max-sm:block max-sm:rounded-2xl max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-3">
                      <td role="cell" data-label={t("social.col.network")} className="px-3 py-2 font-medium max-sm:flex max-sm:items-center max-sm:gap-3 max-sm:px-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">{r.icon ? <EntryIcon icon={r.icon} className="h-5 w-5" /> : r.fallbackIcon}</span>
                          <span className="min-w-0 break-words">{r.name}</span>
                        </span>
                      </td>
                      <td role="cell" data-label={t("social.col.address")} className="max-w-[24ch] px-3 py-2 max-sm:flex max-sm:max-w-none max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1">
                        {r.addresses.length === 0 ? <span className="text-muted">{t("social.toSet")}</span> : <span className="block truncate max-sm:max-w-[60%]" title={r.addresses.join(" · ")}>{r.addresses.join(" · ")}</span>}
                      </td>
                      <td role="cell" data-label={t("social.col.origin")} className="px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1">
                        <span className={ORIGIN_CHIP[r.origin]}>{t(`social.origin.${r.origin}`)}</span>
                      </td>
                      <td role="cell" data-label={t("social.col.shown")} className="px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1">
                        <div className="flex flex-col">
                          <SocialSwitch instanceKey={r.key} label={t("social.switchLabel", { name: r.name })} shown={r.on} disabled={r.state === "todo"} onText={t("social.state.shown")} offText={t("social.state.hidden")} failedText={t("social.failed")} />
                          {r.note && <span className="text-xs text-amber-700">{t(r.note === "duplicate" ? "social.noteDuplicate" : "social.noteLimit")}</span>}
                        </div>
                      </td>
                      <td role="cell" data-label={t("social.col.order")} className="px-3 py-2 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:px-1">
                        <div className="flex items-center gap-1">
                          {(["up", "down"] as const).map((dir) => (
                            <form key={dir} action={moveSocial.bind(null, r.key, dir)}>
                              <button type="submit" disabled={dir === "up" ? i === 0 : i === rows.length - 1} aria-label={t(dir === "up" ? "social.up" : "social.down", { name: r.name })} title={t(dir === "up" ? "social.up" : "social.down", { name: r.name })}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-lg transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"><span aria-hidden="true">{dir === "up" ? "↑" : "↓"}</span></button>
                            </form>
                          ))}
                        </div>
                      </td>
                      <td role="cell" className="whitespace-nowrap px-3 py-2 max-sm:flex max-sm:justify-end max-sm:px-1 max-sm:pt-2">
                        <a href={`/admin/instances/${r.id}`} className={`${ui.btn} min-h-11`}>{t("social.edit")}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={ui.help}>{t("social.headerHint", { page: advanced ? t("nav.settings") : t("nav.settings.simple") })}</p>
          </>
        )}
      </section>

      <section className="space-y-3" id="social-add" aria-labelledby="social-add-title">
        <div>
          <h2 id="social-add-title" className="text-lg font-semibold">{t("social.add")}</h2>
          {available.length > 0 && <p className={ui.help}>{t("social.addHelp")}</p>}
        </div>
        {available.length === 0 ? <p className={ui.help}>{t("social.noneAvailable")}</p> : (
          <>
            <LiveSearch scope="social-add" placeholder={t("social.searchAdd")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="social-available">
              {available.map((e) => (
                <li key={e.id} data-live-item="social-add" data-search={searchText([e.name, e.description])} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2" title={e.description}>
                    <p className="min-w-0 flex-1 break-words font-medium"><span aria-hidden="true">{e.icon}</span> {e.name}</p>
                    {isOwner ? (
                      <form action={addNetwork.bind(null, e.id)}>
                        <PendingButton>{e.installed > 0 ? t("social.addAnother") : t("social.addButton")}</PendingButton>
                      </form>
                    ) : <p className={ui.help}>{t("social.ownerOnly")}</p>}
                  </div>
                  {advanced && <p className={ui.help}>{e.description}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
