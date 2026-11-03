import { adminCtx } from "@/core/admin";
import { legacyReport, legacyStatus, type LegacyReport } from "@/core/modules/legacyReport";
import { upkeepRows, upkeepSummary, type UpkeepGroup, type UpkeepId, type UpkeepRow } from "@/core/modules/legacyUpkeep";
import { ActionForm } from "@/components/admin/ActionForm";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { Badge } from "@/components/admin/Badge";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { EXTENSIONS_UPDATES_HREF } from "@/core/modules/extensionsLinks";
import { RemoveChoices } from "@/components/admin/RemoveSection";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { searchText } from "@/core/adminkit/search";
import type { Translator } from "@/core/i18n/dictionary";
import type { BadgeTone } from "@/core/blocks";
import { keepLegacyRowAction, removeLegacyRowAction, rerunLegacySweep, undoKeepLegacyRowAction } from "./actions";
import { PendingButton } from "@/components/admin/PendingButton";

export const dynamic = "force-dynamic";

/**
 * Entretien : ce qui reste d'une ancienne version du site, en trois états lisibles (À faire, Gardé par prudence, Terminé). Le classement est dans
 * src/core/modules/legacyUpkeep.ts (le menu et l'outil MCP disent la même chose). Une copie de sécurité n'est jamais « à faire ». Jamais la valeur d'un
 * réglage : des nombres et des noms. Les noms techniques (nom d'une collection) ne se montrent qu'en mode avancé.
 */
const GROUPS: { id: UpkeepGroup; tone: BadgeTone }[] = [{ id: "todo", tone: "warn" }, { id: "kept", tone: "info" }, { id: "done", tone: "ok" }];
const SHOWN_NAMES = 8;

/** Les petits repères d'une ligne : quoi exactement (des noms, jamais des valeurs). */
function chipsOf(row: UpkeepRow, r: LegacyReport, t: Translator, advanced: boolean): string[] {
  switch (row.id) {
    case "sourceRows": return r.sourceRows.filter((m) => m.state !== "absent").map((m) => `${m.id} ${m.version}`);
    case "behind": return r.behind.map((i) => `${i.key} (${i.from} → ${i.to})`);
    case "newer": return r.newer.map((i) => `${i.key} (${i.from} > ${i.to})`);
    case "failed": return r.failed.map((i) => `${i.key} · ${t(`legacy.reason.${i.reason}`)}`);
    case "collections": {
      if (advanced) return r.collections.map((c) => `${c.key} · ${c.collection} (${c.count})`);
      const per = new Map<string, number>();
      for (const c of r.collections) per.set(c.key, (per.get(c.key) ?? 0) + c.count);
      return [...per].map(([key, n]) => `${key} · ${t("upkeep.items", { n })}`);
    }
    case "legacyValues": return advanced ? r.legacyValues.map((i) => `${i.key} · ${i.settings.join(", ")}`) : row.names;
    case "orphans": return advanced ? r.orphans.map((i) => `${i.key} · ${i.settings.join(", ")}`) : row.names;
    case "absent": case "keptRows": case "finish": return [];
    default: return row.names;
  }
}

export default async function LegacyPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { t, locale, advanced } = await adminCtx({ right: "core:updates" });
  const { done } = await searchParams;
  const r = await legacyReport();
  const status = legacyStatus(r);
  const rows = upkeepRows(r);
  const sum = upkeepSummary(rows);
  const byGroup = (g: UpkeepGroup) => rows.filter((row) => row.group === g);
  const needsRerun = rows.some((row) => row.group === "todo" && (["finish", "switchedOff", "behind", "failed"] as UpkeepId[]).includes(row.id));
  const titleOf = (row: UpkeepRow) => (row.id === "absent" && row.moduleId ? t("upkeep.row.absent.named", { name: row.moduleId }) : t(`upkeep.row.${row.id}`));
  const textOf = (row: UpkeepRow) => (row.id === "finish" ? t(`legacy.${status === "done" ? "pending" : status}`) : t(`upkeep.row.${row.id}.text`));
  const versionOf = (id: string) => r.sourceRows.find((m) => m.id === id)?.version ?? "";

  const renderRow = (row: UpkeepRow) => {
    const chips = row.group === "done" ? [] : chipsOf(row, r, t, advanced);
    const shownChips = chips.slice(0, SHOWN_NAMES);
    const title = titleOf(row);
    const toUpdates = row.group === "todo" && (row.id === "sourceRows" || row.id === "newer");
    return (
      <li key={`${row.id}-${row.moduleId ?? ""}`} data-live-item="upkeep" data-live-state={row.group} data-search={searchText([title, row.group === "done" ? "" : textOf(row), ...chips])} data-testid={`upkeep-row-${row.id}`} className="space-y-1.5 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-words font-medium">{title}</span>
          {row.group !== "done" && row.n > 0 && !["finish", "absent", "keptRows"].includes(row.id) && <span className="text-sm text-muted" data-testid={`upkeep-count-${row.id}`}>{t("upkeep.count", { n: row.n })}</span>}
        </div>
        {row.group !== "done" && row.id !== "absent" && (
          <>
            <p className="text-sm leading-6 text-muted">{textOf(row)}</p>
            {shownChips.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {shownChips.map((c) => <li key={c} className="max-w-full break-all rounded-md bg-accent/5 px-2 py-0.5 text-xs">{c}</li>)}
                {chips.length > shownChips.length && <li className="text-xs text-muted">{t("upkeep.more", { n: chips.length - shownChips.length })}</li>}
              </ul>
            )}
            {toUpdates && <a href={EXTENSIONS_UPDATES_HREF} className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-2">{t("upkeep.action.updates")}</a>}
          </>
        )}
        {row.id === "absent" && row.moduleId && row.group === "todo" && (
          <div className="space-y-3 pt-1" data-testid={`legacy-absent-${row.moduleId}`}>
            <p className="text-sm leading-6 text-muted">{t("legacy.absent.row", { name: row.moduleId, version: versionOf(row.moduleId) })} {t("legacy.absent.choose")}</p>
            <RemoveChoices t={t} name={row.moduleId} keep={removeLegacyRowAction.bind(null, row.moduleId, true)} erase={removeLegacyRowAction.bind(null, row.moduleId, false)} />
            <form action={keepLegacyRowAction.bind(null, row.moduleId)} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 [&>button]:w-full">
              <ConfirmButton danger={false} confirmLabel={t("legacy.absent.keepYes")} message={t("legacy.absent.keepConfirm", { name: row.moduleId })}>{t("legacy.absent.keep")}</ConfirmButton>
              <p className="text-sm leading-5 text-muted">{t("legacy.absent.keepHelp")}</p>
            </form>
          </div>
        )}
        {row.id === "keptRows" && row.group === "kept" && (
          <ul className="divide-y divide-line" data-testid="legacy-kept">
            {r.keptRows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-1">
                <span className="break-all text-sm">{m.id} {m.version}</span>
                <form action={undoKeepLegacyRowAction.bind(null, m.id)}><PendingButton variant="link" className="!text-accent underline">{t("legacy.kept.undo")}</PendingButton></form>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const counts: Record<UpkeepGroup, number> = { todo: sum.todo, kept: sum.kept, done: byGroup("done").length };
  return (
    <div className="space-y-6">
      <PageHeader title={t("legacy.title")} intro={t("upkeep.intro")} />
      {done && <Callout tone={done === "refused" ? "warn" : "ok"} role="status" testid="legacy-result">{t(`legacy.result.${done === "kept" || done === "removed" || done === "erased" ? done : "refused"}`)}</Callout>}
      {/* Un seul message, dit sans alarme : le site public fonctionne dans tous les cas. */}
      <Callout tone={sum.state === "todo" ? "warn" : "ok"} role="status" testid={`upkeep-status-${sum.state}`}>
        {sum.state === "todo" ? t("upkeep.status.todo", { n: sum.todo }) : sum.state === "kept" ? t("upkeep.status.kept") : t("upkeep.status.clean")}
      </Callout>

      <LiveSearch scope="upkeep" placeholder={t("upkeep.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
        filters={[{ key: "state", allLabel: t("upkeep.filter.all"), options: GROUPS.map((g) => ({ value: g.id, label: t(`upkeep.group.${g.id}`), count: counts[g.id] })) }]} />

      {GROUPS.map(({ id, tone }) => {
        const list = byGroup(id);
        if (list.length === 0) return null;
        const body = <ul className="divide-y divide-line" data-testid={`upkeep-list-${id}`}>{list.map(renderRow)}</ul>;
        return (
          <section key={id} data-live-group="upkeep" data-testid={`upkeep-group-${id}`}>
            {id === "done" ? (
              <details className="rounded-2xl border border-line bg-surface">
                <summary className="flex min-h-11 cursor-pointer select-none flex-wrap items-center gap-2 px-5 py-3 text-lg font-semibold">
                  <span>{t(`upkeep.group.${id}`)}</span><Badge tone={tone}>{list.length}</Badge>
                </summary>
                <div className="space-y-3 border-t border-line px-5 py-3">
                  {r.marker && <p className="text-sm text-muted" data-testid="legacy-done">{t("legacy.done", { date: new Date(r.marker.at).toLocaleString(locale), version: r.marker.version })}</p>}
                  {body}
                </div>
              </details>
            ) : (
              <Panel testid={`upkeep-panel-${id}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{t(`upkeep.group.${id}`)}</h2><Badge tone={tone} testid={`upkeep-badge-${id}`}>{list.length}</Badge></div>
                  <p className="mt-1 text-sm leading-6 text-muted">{t(`upkeep.group.${id}.help`)}</p>
                </div>
                {body}
                {id === "todo" && needsRerun && (
                  <ActionForm action={rerunLegacySweep} submitLabel={t("legacy.rerun.button")} pendingLabel={t("progress.checking")} className="space-y-2">
                    <p className="text-sm leading-6 text-muted">{t("legacy.rerun.help")}</p>
                  </ActionForm>
                )}
              </Panel>
            )}
          </section>
        );
      })}

      {/* En mode avancé, le même balayage reste à portée même quand rien n'est à faire (vérifier après une restauration par exemple). */}
      {advanced && !needsRerun && (
        <Panel title={t("legacy.rerun")} help={t("legacy.rerun.help")}>
          <ActionForm action={rerunLegacySweep} submitLabel={t("legacy.rerun.button")} pendingLabel={t("progress.checking")} secondary className="space-y-2">{null}</ActionForm>
        </Panel>
      )}
    </div>
  );
}
