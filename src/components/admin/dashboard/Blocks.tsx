import { Suspense, type ReactNode } from "react";
import type { AdminUser } from "@/core/auth/access";
import { hasRole } from "@/core/auth/access";
import type { Translator } from "@/core/i18n/dictionary";
import { statsEnabled, statsSummary } from "@/core/stats";
import { ui } from "@/components/admin/ui";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { loadCoreTodo, mergeTodo, type TodoNavItem } from "@/core/dashboard/todo";
import { moduleActions, moduleCards, moduleTasks, type DashboardEnv } from "@/core/dashboard/modules";
import { coreQuickActions, mergeQuick } from "@/core/dashboard/quick";
import { recentActivity } from "@/core/dashboard/activity";
import { loadSetup } from "@/core/dashboard/setup";
import { loadHealth } from "@/core/dashboard/health";
import { topLinks, topPagesTitled, visitsOverview, type Comparison } from "@/core/dashboard/visits";
import { hideSetup, refreshStorage } from "@/app/admin/(panel)/dashboardActions";
import { canSeeStorage } from "@/core/storage/access";
import { storageInfo } from "@/core/storage/service";
import { presentStorage } from "@/core/storage/present";
import { PendingButton } from "@/components/admin/PendingButton";
import { Callout } from "@/components/admin/Page";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { APPEARANCE_HREF, AUDIT_HREF, SETTINGS_HREF, SOCIAL_HREF } from "@/core/adminLinks";

/**
 * Les blocs du tableau de bord : des composants serveur, chacun dans son `Suspense`. Un bloc lent (une extension qui tarde, une lecture de base) ne retient ni la page ni les autres blocs ;
 * un bloc qui échoue disparaît seul. Toute la logique est dans src/core/dashboard/ ; ici, seulement de la mise en page.
 */
export type BlockCtx = { t: Translator; locale: string; defaultLocale: string; advanced: boolean; user: AdminUser; nav: readonly TodoNavItem[]; contentIds: readonly string[]; newPageHref: string };

const ARROW = <span aria-hidden="true"> →</span>;
const row = "flex items-center justify-between gap-3 rounded-xl px-3 py-2 min-h-11 hover:bg-accent/10";

/** Emplacement qui garde la place pendant le chargement (aucun saut de mise en page). */
export function Slot({ children, label, height = "h-28" }: { children: ReactNode; label: string; height?: string }) {
  return (
    <Suspense fallback={<div role="status" aria-label={label} className={`${ui.card} ${height} animate-pulse`}><span className="sr-only">{label}</span></div>}>
      {children}
    </Suspense>
  );
}

const env = (c: BlockCtx): DashboardEnv => ({ viewer: c.user, locale: c.locale, defaultLocale: c.defaultLocale });

// ── Mise en route ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function SetupBlock({ c }: { c: BlockCtx }) {
  const state = await loadSetup({ contentInstanceIds: c.contentIds, locale: c.locale, links: { settings: SETTINGS_HREF, appearance: APPEARANCE_HREF, social: SOCIAL_HREF, newPage: c.newPageHref } }).catch(() => null);
  if (!state?.visible) return null;
  const { t } = c;
  return (
    <section aria-labelledby="dash-setup" data-testid="dash-setup" className={`${ui.card} space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dash-setup" className="text-lg font-semibold">{t("dash.setup.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("dash.setup.intro")}</p>
        </div>
        <form action={hideSetup}><button type="submit" className={`${ui.btn} min-h-11`}>{t("dash.setup.hide")}</button></form>
      </div>
      <div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.done} aria-label={t("dash.setup.progress", { done: state.done, total: state.total })} className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent" style={{ width: `${state.percent}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">{t("dash.setup.progress", { done: state.done, total: state.total })}</p>
      </div>
      <ul className="divide-y divide-line">
        {state.steps.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true">{s.done ? "✅" : "⬜"}</span><span className={s.done ? "text-muted line-through" : "font-medium"}>{t(`dash.setup.${s.id}`)}</span></span>
            {s.done ? <span className="text-xs text-muted">{t("dash.setup.done")}</span> : <a href={s.href} className={`${ui.btn} min-h-11`}>{t("dash.setup.go")}{ARROW}</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Santé ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function HealthPill({ c }: { c: BlockCtx }) {
  const h = await loadHealth(c.user, c.t).catch(() => null);
  if (!h) return null;
  const { t } = c;
  if (h.ok) return <p data-testid="dash-health" className={`${ui.chipOk} min-h-8`} role="status">✅ {t("dash.health.ok")}</p>;
  const label = t("dash.health.points", { n: h.points.length });
  return (
    <details data-testid="dash-health" className="group">
      <summary className={`${ui.chipWarn} min-h-11 cursor-pointer list-none px-3 py-2 text-sm`} aria-label={`${t("dash.health.label")} : ${label}`}>⚠️ {label}{ARROW}</summary>
      <ul className={`${ui.card} mt-2 space-y-1`}>
        {h.points.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{p.label}</span>
            {p.href && <a href={p.href} className={`${ui.btn} min-h-11`}>{t("dash.health.open")}{ARROW}</a>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Stockage ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Place prise par le site et place libre sur le serveur. La mesure est mise en mémoire et bornée ; si elle tarde, la carte le dit au lieu de retenir la page. */
export async function StorageBlock({ c }: { c: BlockCtx }) {
  if (!canSeeStorage(c.user)) return null;
  const { t, locale } = c;
  const info = await storageInfo({ waitMs: 2500 }).catch(() => null);
  if (!info) return null;
  const v = presentStorage(info, t, locale);
  const measured = info.measuredAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(info.measuredAt)) : null;
  return (
    <section id="storage" aria-labelledby="dash-storage" data-testid="dash-storage" className={`${ui.card} scroll-mt-20 space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dash-storage" className="text-lg font-semibold">{t("storage.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("storage.intro")}</p>
        </div>
        <form action={refreshStorage}><PendingButton pendingLabel={t("storage.measuring")} testid="storage-refresh">{t("storage.refresh")}</PendingButton></form>
      </div>
      {v.level === "unknown" ? (
        <p className="text-sm text-muted" data-testid="storage-unknown">{t("storage.unknown")}</p>
      ) : (
        <>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.usedShare)} aria-label={t("storage.barLabel", { used: String(Math.round(v.usedShare)) })} className="flex h-3 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${v.siteShare}%` }} />
            <div className="h-full bg-muted/50" style={{ width: `${v.otherShare}%` }} />
          </div>
          <p className="text-sm" data-testid="storage-sentence">
            <span aria-hidden="true">{v.icon} </span><span className="font-medium">{v.stateText}</span>
            {v.sentence && <span className="text-muted"> · {v.sentence}</span>}
          </p>
          {v.pending && <p className="text-sm text-muted" role="status" data-testid="storage-pending">{t("storage.pending")}</p>}
          {v.warning && <Callout tone={v.level === "critical" ? "danger" : "warn"} role="status" testid="storage-warning">{v.warning}</Callout>}
          <MoreOptions title={t("storage.details")} summary={v.categories ? undefined : t("storage.pendingShort")} defaultOpen={v.level !== "ok"}>
            {v.categories ? (
              <>
                <ul className="divide-y divide-line text-sm" data-testid="storage-categories">
                  {v.categories.map((cat) => <li key={cat.id} className="flex items-center justify-between gap-3 py-2"><span>{cat.label}</span><span className="text-muted">{cat.text}</span></li>)}
                </ul>
                {v.partial && <p className="text-sm text-muted">{t("storage.partial")}</p>}
                <p className="text-xs text-muted">{t("storage.disk", { free: v.freeText ?? "", total: v.totalText ?? "" })}{measured ? ` · ${t("storage.measuredAt", { when: measured })}` : ""}</p>
              </>
            ) : <p className="text-sm text-muted">{t("storage.pending")}</p>}
          </MoreOptions>
        </>
      )}
    </section>
  );
}

// ── À faire ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function TodoBlock({ c }: { c: BlockCtx }) {
  const { t } = c;
  const statuses = hasRole(c.user, "admin") ? await loadInstanceStatuses(c.locale, c.defaultLocale).catch(() => null) : null;
  const toSetUp = c.nav.flatMap((i) => { const s = statuses?.get(i.id); return s?.state === "setup" ? [{ id: i.id, name: i.name, icon: i.icon, summary: s.missing.slice(0, 3).join(", ") }] : []; });
  const [core, mods] = await Promise.all([
    loadCoreTodo({ user: c.user, t, locale: c.locale, defaultLocale: c.defaultLocale, nav: c.nav, toSetUp, skipDrafts: true }).catch(() => []),
    moduleTasks(env(c)).catch(() => []),
  ]);
  const items = mergeTodo(core, mods);
  return (
    <section aria-labelledby="dash-todo" data-testid="todo" className={`${ui.card} space-y-2`}>
      <h2 id="dash-todo" className="text-lg font-semibold">{t("dash.todo.title")}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="todo-none">✅ {t("dash.todo.none")}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id}>
              <a href={i.href} data-testid={i.kind === "setup" ? "todo-setup" : undefined} className={`${row} flex-wrap`}>
                <span className="min-w-0 flex-1 basis-56"><span aria-hidden="true">{i.icon} </span>{i.label}{i.detail && <span className="block text-xs text-muted">{i.detail}</span>}</span>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-accent">{i.count ? <span className="rounded-full bg-accent px-2 text-sm font-semibold text-accent-fg">{i.count}</span> : null}{t("dash.todo.open")}{ARROW}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Créer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function CreateBlock({ c }: { c: BlockCtx }) {
  const { t } = c;
  const declared = await moduleActions(env(c)).catch(() => []);
  const actions = mergeQuick(declared, coreQuickActions({ user: c.user, t, advanced: c.advanced, nav: c.nav, declared }));
  return (
    <section aria-labelledby="dash-create" data-testid="dash-create" className="space-y-3">
      <h2 id="dash-create" className="text-lg font-semibold">{t("dash.create.title")}</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted" data-testid="create-none">{t("dash.create.none")}{hasRole(c.user, "admin") && <> <a href={EXTENSIONS_ADD_HREF} className="underline hover:text-accent">{t("dash.create.add")}{ARROW}</a></>}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {actions.map((a) => <li key={a.id}><a href={a.href} className={`${ui.btn} min-h-11`}><span aria-hidden="true">{a.icon}</span>{a.label}</a></li>)}
        </ul>
      )}
    </section>
  );
}

// ── Ce qui s'est passé ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function ActivityBlock({ c }: { c: BlockCtx }) {
  const { t, locale } = c;
  const { lines, fullJournal } = await recentActivity(c.user, { t, locale, defaultLocale: c.defaultLocale, advanced: c.advanced });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-labelledby="dash-activity" data-testid="dash-activity" className={`${ui.card} space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dash-activity" className="text-lg font-semibold">{t("dash.activity.title")}</h2>
        {fullJournal && c.advanced && <a href={AUDIT_HREF} className="text-sm underline hover:text-accent">{t("dash.activity.all")}{ARROW}</a>}
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted" data-testid="activity-none">{t("dash.activity.none")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="min-w-0 flex-1 basis-56 break-words">{l.sentence}{l.target && <span className="text-muted"> · {l.target}</span>}</span>
              <span className="text-xs text-muted">{t("dash.activity.by", { who: l.who })} · <time dateTime={l.when.toISOString()}>{when.format(l.when)}</time></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Visites ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Change({ c, cmp }: { c: BlockCtx; cmp: Comparison }) {
  if (cmp.change === null) return <p className="text-xs text-muted">&nbsp;</p>;
  const key = cmp.change > 0 ? "dash.visits.more" : cmp.change < 0 ? "dash.visits.less" : "dash.visits.same";
  return <p className={`text-xs ${cmp.change > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted"}`}>{cmp.change > 0 ? "▲" : cmp.change < 0 ? "▼" : "="} {c.t(key, { n: Math.abs(cmp.change) })}</p>;
}

export async function VisitsBlock({ c }: { c: BlockCtx }) {
  if (!(await statsEnabled())) return null;
  const { t } = c;
  const [o, pages, links, stats] = await Promise.all([visitsOverview(), topPagesTitled({ t, locale: c.locale, defaultLocale: c.defaultLocale }).catch(() => []), topLinks().catch(() => ({ enabled: false, links: [] })), statsSummary()]);
  const peak = Math.max(1, ...o.days.map((d) => d.visitors));
  return (
    <section aria-labelledby="dash-visits" data-testid="visits" className={`${ui.card} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dash-visits" className="text-lg font-semibold">{t("dashboard.visits")}</h2>
        <p className="text-xs text-muted">{t("dashboard.visitsPrivacy")}</p>
      </div>
      {o.empty ? (
        <p className="text-sm text-muted">{t("dashboard.visitsEmpty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><p className="text-2xl font-bold">{o.today.visitors}</p><p className="text-xs text-muted">{t("dashboard.visits.today")}</p></div>
            <div><p className="text-2xl font-bold">{o.week.current.visitors}</p><p className="text-xs text-muted">{t("dash.visits.last7")}</p><Change c={c} cmp={o.week} /></div>
            <div><p className="text-2xl font-bold">{o.month.current.visitors}</p><p className="text-xs text-muted">{t("dash.visits.last30")}</p><Change c={c} cmp={o.month} /></div>
          </div>
          <div className="flex h-20 items-end gap-px" role="img" aria-label={t("dashboard.visitsChart")}>
            {o.days.map((d) => <div key={d.day} title={`${d.day} : ${d.visitors}`} className="min-h-px flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(2, (d.visitors / peak) * 100)}%`, opacity: d.visitors ? 1 : 0.25 }} />)}
          </div>
        </>
      )}
      <div data-testid="robots">
        <h3 className="mb-1 text-sm font-semibold">{t("dash.robots.title")}</h3>
        {stats.robots.last30.total === 0 ? (
          <p className="text-sm text-muted">{t("dash.robots.none")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-2xl font-bold">{stats.robots.last30.total}</p><p className="text-xs text-muted">{t("dash.robots.total")}</p></div>
            <div><p className="text-2xl font-bold">{stats.robots.last30.ai}</p><p className="text-xs text-muted">{t("dash.robots.ai")}</p></div>
          </div>
        )}
        <p className="mt-1 text-xs text-muted">{t("dash.robots.hint")}</p>
      </div>
      {(pages.length > 0 || links.links.length > 0 || stats.topSources.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {pages.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t("dashboard.topPages")}</h3>
              <ul className="space-y-0.5 text-sm">{pages.map((p) => <li key={p.path} className="flex justify-between gap-3"><a href={p.path} target="_blank" rel="noopener" className="truncate underline-offset-2 hover:text-accent hover:underline" title={p.path}>{p.title}</a><span className="text-muted">{p.views}</span></li>)}</ul>
            </div>
          )}
          {links.links.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t("dash.visits.links")}</h3>
              <ul className="space-y-0.5 text-sm">{links.links.map((l) => <li key={l.destination} className="flex justify-between gap-3"><span className="truncate" title={l.destination}>{l.destination.replace(/^https?:\/\/(www\.)?/, "")}<span className="text-muted"> · {l.shortLinks.slice(0, 2).join(", ")}</span></span><span className="text-muted">{t("dash.visits.clicks", { n: l.month })}</span></li>)}</ul>
            </div>
          )}
          {stats.topSources.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t("dashboard.topSources")}</h3>
              <ul className="space-y-0.5 text-sm">{stats.topSources.map((s) => <li key={s.host} className="flex justify-between gap-3"><span className="truncate">{s.host}</span><span className="text-muted">{s.views}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Cartes des extensions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function CardsBlock({ c, max }: { c: BlockCtx; max: number }) {
  const cards = (await moduleCards(env(c)).catch(() => [])).slice(0, max);
  if (cards.length === 0) return null;
  return (
    <section aria-label="Extensions" data-testid="dash-cards" className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const body = (
          <>
            <h2 className="text-sm font-semibold text-muted"><span aria-hidden="true">{card.icon} </span>{card.title}{card.href && ARROW}</h2>
            {card.data.type === "counter" ? (
              <><p className="mt-1 text-3xl font-bold">{card.data.value}</p>{card.data.detail && <p className="text-sm text-muted">{card.data.detail}</p>}</>
            ) : card.data.rows.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{card.empty ?? c.t("dash.cards.empty")}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {card.data.rows.map((r, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3">
                    {r.href ? <a href={r.href} className="truncate font-medium hover:text-accent hover:underline">{r.title}</a> : <span className="truncate font-medium">{r.title}</span>}
                    {r.detail && <span className="text-muted">{r.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        );
        const k = `${card.instanceId}-${card.id}`;
        return card.href && card.data.type === "counter"
          ? <a key={k} href={card.href} className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>{body}</a>
          : <div key={k} className={ui.card}>{body}</div>;
      })}
    </section>
  );
}

