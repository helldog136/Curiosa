import { Suspense, type ReactNode } from "react";
import type { AdminUser } from "@/core/auth/access";
import { hasRole } from "@/core/auth/access";
import { canOpen, openable, type AccessContext } from "@/core/adminAccess";
import type { Translator } from "@/core/i18n/dictionary";
import { statsEnabled, statsSummary } from "@/core/stats";
import { ui } from "@/components/admin/ui";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { loadCoreTodo, mergeTodo, type TodoItem, type TodoNavItem } from "@/core/dashboard/todo";
import { moduleActions, moduleCards, moduleTasks, type DashboardEnv } from "@/core/dashboard/modules";
import { coreQuickActions, mergeQuick } from "@/core/dashboard/quick";
import { recentActivity } from "@/core/dashboard/activity";
import { loadSetup } from "@/core/dashboard/setup";
import { loadHealth } from "@/core/dashboard/health";
import { HelpTip } from "@/components/admin/HelpTip";
import { topLinks, topPagesTitled, visitsOverview, type Comparison } from "@/core/dashboard/visits";
import { hideSetup, refreshStorage } from "@/app/admin/(panel)/dashboardActions";
import { canSeeStorage } from "@/core/storage/access";
import { storageInfo } from "@/core/storage/service";
import { presentStorage } from "@/core/storage/present";
import { PendingButton } from "@/components/admin/PendingButton";
import { Callout } from "@/components/admin/Page";
import { AttentionCard, type AttentionTone } from "@/components/admin/AttentionCard";
import { ChecklistCard, type ChecklistStep } from "@/components/admin/ChecklistCard";
import { checklistLabels } from "@/components/admin/brickLabels";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { APPEARANCE_HREF, AUDIT_HREF, SETTINGS_HREF, SETUP_ASSISTANT_HREF, SOCIAL_HREF } from "@/core/adminLinks";

/**
 * Les blocs du tableau de bord : des composants serveur, chacun dans son `Suspense`. Un bloc lent (une extension qui tarde, une lecture de base) ne retient ni la page ni les autres blocs ;
 * un bloc qui échoue disparaît seul. Toute la logique est dans src/core/dashboard/ ; ici, seulement de la mise en page.
 */
export type BlockCtx = { t: Translator; locale: string; defaultLocale: string; advanced: boolean; user: AdminUser; nav: readonly TodoNavItem[]; contentIds: readonly string[]; newPageHref: string; /** Which module owns each instance: lets the access table answer for the page of an instance (R35). */ owners: AccessContext };

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
  const state = await loadSetup({ contentInstanceIds: c.contentIds, locale: c.locale, links: { settings: SETTINGS_HREF, appearance: APPEARANCE_HREF, social: SOCIAL_HREF, newPage: c.newPageHref, modules: EXTENSIONS_ADD_HREF, assistant: SETUP_ASSISTANT_HREF } }).catch(() => null);
  if (!state?.visible) return null;
  const { t } = c;
  // R8, R26: the checklist card draws the steps and the action of the NEXT one only; the list goes away on its own when every step is done.
  const steps: ChecklistStep[] = state.steps.map((s) => ({
    id: s.id,
    label: t(`dash.setup.${s.id}`),
    done: s.done,
    action: !s.done && canOpen(c.user, s.href, c.owners) ? <a href={s.href} className={`${ui.btn} min-h-11`} aria-label={`${t(`dash.setup.act.${s.id}`)} (${t(`dash.setup.${s.id}`)})`}>{t(`dash.setup.act.${s.id}`)}</a> : undefined,
  }));
  return (
    <section data-testid="dash-setup" className="space-y-2">
      <ChecklistCard title={t("dash.setup.title")} steps={steps} labels={checklistLabels(t)} level={2} testid="dash-setup-card" />
      <form action={hideSetup} className="flex justify-end"><button type="submit" className={`${ui.btn} min-h-11`}>{t("dash.setup.hide")}</button></form>
    </section>
  );
}

// ── Santé ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function HealthPill({ c }: { c: BlockCtx }) {
  const h = await loadHealth(c.user, c.t, c.locale).catch(() => null);
  if (!h) return null;
  const { t } = c;
  // R33: when everything is fine, nothing is shown (no chip, no sentence that says it is fine).
  if (h.ok) return null;
  const label = t("dash.health.points", { n: h.points.length });
  return (
    <details data-testid="dash-health" className="group">
      <summary className={`${ui.chipWarn} min-h-11 cursor-pointer list-none px-3 py-2 text-sm`} aria-label={`${t("dash.health.label")} : ${label}`}>⚠️ {label}{ARROW}</summary>
      <ul className={`${ui.card} mt-2 space-y-1`}>
        {h.points.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{p.label}{p.help && <> <HelpTip help={p.help} name={p.label} always /></>}</span>
            {p.href && canOpen(c.user, p.href, c.owners) && <a href={p.href} className={`${ui.btn} min-h-11`}>{t("dash.health.open")}{ARROW}</a>}
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
  // Folded to one line (the state in words) while all is well; open as soon as the disk needs a look, which is where the health points lead (#storage).
  return (
    <div data-testid="dash-storage" className="scroll-mt-20">
      <MoreOptions id="storage" title={t("storage.title")} summary={v.level === "unknown" ? undefined : v.stateText} defaultOpen={v.level !== "ok" && v.level !== "unknown"}>
        <div className="flex items-center justify-end gap-2">
          <HelpTip help={t("storage.intro")} name={t("storage.title")} always />
          <form action={refreshStorage}><PendingButton pendingLabel={t("storage.measuring")} testid="storage-refresh">{t("storage.refresh")}</PendingButton></form>
        </div>
        {v.level === "unknown" ? (
          <p className="text-sm text-muted" data-testid="storage-unknown">{t("storage.unknown")}</p>
        ) : (
          <>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.usedShare)} aria-label={t("storage.barLabel", { used: String(Math.round(v.usedShare)) })} className="flex h-3 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent" style={{ width: `${v.barSite}%` }} />
              <div className="h-full bg-muted/50" style={{ width: `${v.barOther}%` }} />
            </div>
            {v.legend && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="storage-legend">
                {v.legend.map((l) => (
                  <li key={l.id} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${l.id === "site" ? "bg-accent" : l.id === "other" ? "bg-muted/50" : "border border-line bg-line"}`} />
                    <span className="text-muted">{l.label}</span> <span className="font-medium">{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm" data-testid="storage-sentence">
              <span aria-hidden="true">{v.icon} </span><span className="font-medium">{v.stateText}</span>
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
      </MoreOptions>
    </div>
  );
}

// ── À faire ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How serious each kind of line is: a missing backup or a module to set up blocks something; an update can wait (the tone is also a shape, never colour alone). */
const TODO_TONE: Record<TodoItem["kind"], AttentionTone> = { ai: "warn", setup: "warn", backup: "warn", drafts: "info", "update-core": "info", "update-modules": "info", "update-skins": "info", badge: "info", module: "info" };
/** Lines shown at once; the rest is one fold away (R33: the first screen holds what matters most). */
export const TODO_VISIBLE = 5;

export async function TodoBlock({ c }: { c: BlockCtx }) {
  const { t } = c;
  const statuses = hasRole(c.user, "admin") ? await loadInstanceStatuses(c.locale, c.defaultLocale).catch(() => null) : null;
  const toSetUp = c.nav.flatMap((i) => { const s = statuses?.get(i.id); return s?.state === "setup" ? [{ id: i.id, name: i.name, icon: i.icon, summary: s.missing.slice(0, 3).join(", ") }] : []; });
  const [core, mods] = await Promise.all([
    loadCoreTodo({ user: c.user, t, locale: c.locale, defaultLocale: c.defaultLocale, nav: c.nav, toSetUp, skipDrafts: true }).catch(() => []),
    moduleTasks(env(c)).catch(() => []),
  ]);
  // R35: a line that opens a page this person cannot open is not shown (the page keeps its own check).
  const items = openable(c.user, mergeTodo(core, mods), c.owners);
  // R33: an empty "to do" card shows nothing.
  if (items.length === 0) return null;
  // One card per line, each with its own verb (R3); a card without an action draws nothing, so a line always leads somewhere.
  const card = (i: TodoItem) => {
    const go = t(`dash.todo.go.${i.kind}`);
    return (
      <AttentionCard key={i.id} tone={TODO_TONE[i.kind]} title={i.label} reason={i.detail}
        action={<a href={i.href} data-testid={i.kind === "setup" ? "todo-setup" : undefined} className={`${ui.btn} min-h-11`} aria-label={`${go} (${i.label})`}>{go}</a>} />
    );
  };
  const shown = items.slice(0, TODO_VISIBLE), rest = items.slice(TODO_VISIBLE);
  return (
    <section id="todo" aria-labelledby="dash-todo" data-testid="todo" className="scroll-mt-20 space-y-3">
      <h2 id="dash-todo" className="text-lg font-semibold">{t("dash.todo.title")}</h2>
      <div className="space-y-3">{shown.map(card)}</div>
      {rest.length > 0 && <MoreOptions title={t("dash.todo.more", { n: rest.length })}><div className="space-y-3">{rest.map(card)}</div></MoreOptions>}
    </section>
  );
}

// ── Créer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function CreateBlock({ c }: { c: BlockCtx }) {
  const { t } = c;
  const declared = await moduleActions(env(c)).catch(() => []);
  const actions = openable(c.user, mergeQuick(declared, coreQuickActions({ user: c.user, t, advanced: c.advanced, nav: c.nav, declared })), c.owners);
  // R33 / R18: with no creation button there is only one thing to do, and only an administrator can do it: the link. Other people see nothing.
  if (actions.length === 0 && !hasRole(c.user, "admin")) return null;
  return (
    <section aria-labelledby="dash-create" data-testid="dash-create" className="space-y-3">
      <h2 id="dash-create" className="text-lg font-semibold">{t("dash.create.title")}</h2>
      {actions.length === 0 ? (
        <p data-testid="create-none"><a href={EXTENSIONS_ADD_HREF} className={`${ui.btn} min-h-11`}>{t("dash.create.add")}</a></p>
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
  // R33: no recent activity, nothing to show. The last block, folded to one line that counts the events.
  if (lines.length === 0) return null;
  return (
    <div data-testid="dash-activity">
      <MoreOptions title={t("dash.activity.title")} summary={t("dash.activity.count", { n: lines.length })}>
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="min-w-0 flex-1 basis-56 break-words">{l.sentence}{l.similar > 0 ? <span className="text-muted"> · {t("dash.activity.similar", { count: l.similar })}</span> : l.target && <span className="text-muted"> · {l.target}</span>}</span>
              <span className="text-xs text-muted">{t("dash.activity.by", { who: l.who })} · <time dateTime={l.when.toISOString()}>{when.format(l.when)}</time></span>
            </li>
          ))}
        </ul>
        {fullJournal && c.advanced && <a href={AUDIT_HREF} className="inline-block text-sm underline hover:text-accent">{t("dash.activity.all")}{ARROW}</a>}
      </MoreOptions>
    </div>
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
  const hasRobots = stats.robots.last30.total > 0;
  // R33: with no visit, no robot and no list there is nothing to read or act on: the block is not drawn.
  if (o.empty && !hasRobots && pages.length === 0 && links.links.length === 0 && stats.topSources.length === 0) return null;
  return (
    <div data-testid="visits">
      <MoreOptions title={t("dashboard.visits")} summary={o.empty ? t("dashboard.visitsEmpty") : t("dash.visits.summary", { n: o.month.current.visitors })}>
        {!o.empty && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted">{t("dash.visits.visitors")}<HelpTip help={t("dashboard.visitsPrivacy")} name={t("dashboard.visits")} always /></div>
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
        {hasRobots && (
          <div data-testid="robots">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">{t("dash.robots.title")}<HelpTip help={t("dash.robots.hint")} name={t("dash.robots.title")} always /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-2xl font-bold">{stats.robots.last30.total}</p><p className="text-xs text-muted">{t("dash.robots.total")}</p></div>
              <div><p className="text-2xl font-bold">{stats.robots.last30.ai}</p><p className="text-xs text-muted">{t("dash.robots.ai")}</p></div>
            </div>
          </div>
        )}
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
      </MoreOptions>
    </div>
  );
}

// ── Cartes des extensions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function CardsBlock({ c, max }: { c: BlockCtx; max: number }) {
  // R33: a list card with no row and no sentence of its own is already left out by `moduleCards`; an empty card always has the module's own sentence.
  const cards = (await moduleCards(env(c)).catch(() => [])).slice(0, max);
  if (cards.length === 0) return null;
  return (
    <section aria-label={c.t("dashboard.modules")} data-testid="dash-cards" className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const body = (
          <>
            <h2 className="text-sm font-semibold text-muted"><span aria-hidden="true">{card.icon} </span>{card.title}{card.href && ARROW}</h2>
            {card.data.type === "counter" ? (
              <><p className="mt-1 text-3xl font-bold">{card.data.value}</p>{card.data.detail && <p className="text-sm text-muted">{card.data.detail}</p>}</>
            ) : card.data.rows.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{card.empty}</p>
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

