import type { ReactNode } from "react";
import { RowMenu } from "./RowMenu";
import { RowActionButton, RowMenuItem } from "./AdminBlocks";
import { DialogLink } from "./EditDialog";
import { Badge } from "./Badge";
import { ui } from "./ui";
import { STATE_TONE, sinceText, type ConnectionState, type ConnectionView } from "@/core/adminkit/connection";
import { safeHref } from "@/core/url";

export type ConnectionLabels = { state: Record<ConnectionState, string>; edit: string; since: string; menu: string; rows: string };

const DOT: Record<ConnectionState, string> = { configured: "bg-success", degraded: "bg-warning", notConfigured: "bg-line" };

/**
 * The card of a `connection` block (R33): the title and ONE chip (the three states are written by the core), what is configured on one line, the reason and the fix when
 * there is a problem, ONE "Edit" button that opens the module's form window, and the rare actions in a "⋯" menu. The setup blocks (`setup`) come already rendered and
 * exist only while the state is "not configured" (the view empties them otherwise). Server component: the buttons are the client components of the admin kit.
 */
export function ConnectionCard({ view, instanceId, labels, locale, setup }: { view: ConnectionView; instanceId: string; labels: ConnectionLabels; locale: string; setup?: ReactNode }) {
  const headId = `conn-${view.id}`;
  const since = view.since ? labels.since.replace("{date}", sinceText(view.since, locale)) : "";
  const fixButton = (p: NonNullable<ConnectionView["primary"]>, id?: string) => p.href
    ? <a href={safeHref(p.href)} className={`${ui.btnPrimary} min-h-11`}>{p.label}</a>
    : <RowActionButton instanceId={instanceId} label={p.label} action={p.action} id={id ?? p.id} />;
  return (
    <section data-card="" data-skin-part="card" data-testid="connection-card" data-state={view.state} id={headId} aria-labelledby={`${headId}-title`} className={`${ui.card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={`${headId}-title`} className="min-w-0 break-words text-base font-semibold">{view.title}</h3>
        <Badge tone={STATE_TONE[view.state]} testid="connection-state">{labels.state[view.state]}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view.primary && fixButton(view.primary)}
          {view.edit && <DialogLink href={view.edit.href} className={`${ui.btn} min-h-11`}>{view.edit.label ?? labels.edit}</DialogLink>}
          {view.menu.length > 0 && (
            <RowMenu label={labels.menu}>
              {view.menu.map((m) => <RowMenuItem key={m.action + (m.id ?? "")} instanceId={instanceId} label={m.label} action={m.action} id={m.id} confirm={m.confirm} danger={m.danger} />)}
            </RowMenu>
          )}
        </div>
      </div>
      {view.summary && <p className="break-words text-sm" data-testid="connection-summary">{view.summary}</p>}
      {view.reason && <p className="break-words text-sm text-muted" data-testid="connection-reason">{since ? `${view.reason.replace(/[.。]\s*$/, "")} · ${since}` : view.reason}</p>}
      {view.rows.length > 0 && (
        <ul aria-label={labels.rows} className="space-y-2" data-testid="connection-rows">
          {view.rows.map((r) => (
            <li key={r.text} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-chip ${DOT[r.state]}`} />
              <span className="min-w-0 break-words font-medium">{r.text}</span>
              <Badge tone={STATE_TONE[r.state]}>{labels.state[r.state]}</Badge>
              {r.reason && <span className="min-w-0 break-words text-muted">{r.reason}</span>}
              {r.primary && <span className="ml-auto">{fixButton(r.primary, r.primary.id)}</span>}
            </li>
          ))}
        </ul>
      )}
      {setup}
    </section>
  );
}
