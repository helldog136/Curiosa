import type { ConnectionState, ConnectionView } from "@/core/adminkit/connection";
import { STATE_TONE } from "@/core/adminkit/connection";
import type { BadgeTone } from "@/core/blocks";
import type { Translator } from "@/core/i18n/dictionary";

/**
 * The rows of the "Accounts and connections" table (C5c, R30): ONE table for everything the site is connected to. What tells the rows apart is a column (where the row
 * comes from, and its state), never a card or a section of its own. Pure (no database, no React): the loader fills the rows, the client table draws them.
 *  - `connection`: a module that connects the site to a service (its `connection` block gives the state, the reason and the fix);
 *  - `address`: a module whose only setting is the address of a profile (configured = the address is written);
 *  - `page`: a page of the module or of the group that is not one of the two (figures, other platforms…), reached by its button.
 * The state is one of the three words of the core (Configured, Degraded, Not configured); a `page` row has none.
 */
export type ConnectionOrigin = "connection" | "address" | "page";
export const ORIGINS: readonly ConnectionOrigin[] = ["connection", "address", "page"];

/** The one button of a row: an address of the page that produces it, a window above this table (an address), or a module action (reconnect). */
export type RowAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "dialog"; label: string; href: string }
  | { kind: "action"; label: string; instanceId: string; action: string; id?: string };

export type RowMenuEntry = { label: string; instanceId: string; action: string; id?: string; confirm?: string; danger: boolean };

export type ConnectionRow = {
  id: string;
  name: string;
  origin: ConnectionOrigin;
  /** Null for a `page` row. */
  state: ConnectionState | null;
  /** What is configured (the account, the address) or, when it is not, the reason and the next step: one line. */
  detail: string;
  /** Number of things to do, shown beside the name (the badge of the old menu). */
  todo: number;
  action: RowAction;
  menu: RowMenuEntry[];
};

/** The words of the table, translated by the server. */
export type ConnectionsLabels = {
  columns: { name: string; origin: string; state: string; detail: string; actions: string };
  origin: Record<ConnectionOrigin, string>;
  state: Record<ConnectionState, string>;
  search: string; none: string; clear: string; count: string; all: string; filterOrigin: string; filterState: string; menu: string; todo: string; failed: string;
};

export function connectionsLabels(t: Translator): ConnectionsLabels {
  return {
    columns: { name: t("connections.col.name"), origin: t("connections.col.origin"), state: t("connections.col.state"), detail: t("connections.col.detail"), actions: t("table.actions") },
    origin: { connection: t("connections.origin.connection"), address: t("connections.origin.address"), page: t("connections.origin.page") },
    state: { configured: t("connection.state.configured"), degraded: t("connection.state.degraded"), notConfigured: t("connection.state.notConfigured") },
    search: t("connections.search"), none: t("search.none"), clear: t("search.clear"), count: t("search.count"), all: t("table.all"),
    filterOrigin: t("connections.col.origin"), filterState: t("connections.col.state"), menu: t("table.menu"), todo: t("nav.badge.todo"), failed: t("switch.failed"),
  };
}

/** The tone of the origin pill: colour AND word (R28, R30). */
export const ORIGIN_TONE: Record<ConnectionOrigin, BadgeTone> = { connection: "info", address: "neutral", page: "neutral" };
export const stateTone = (s: ConnectionState): BadgeTone => STATE_TONE[s];

const oneLine = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

/** Joins the address of a page (or tab) and a link of a module made of a query (`?edit=app`) or of a full address. */
export function joinTarget(page: string, target: string | undefined): string {
  if (!target) return page;
  if (target.startsWith("?")) return `${page}${target}`;
  return target;
}

/** The row of a `connection` block. The button depends on the state: Edit (configured), Fix (degraded), Set up (not configured) (R3: a precise verb). */
export function rowFromConnection(view: ConnectionView, ctx: { anchor: string; instanceId: string; pageHref: string; todo?: number; labels: { edit: string; fix: string; setup: string } }): ConnectionRow {
  const fix = view.primary;
  let action: RowAction;
  if (view.state === "configured") action = { kind: "link", label: view.edit?.label ?? ctx.labels.edit, href: joinTarget(ctx.pageHref, view.edit?.href) };
  else {
    const label = fix?.label ?? (view.state === "degraded" ? ctx.labels.fix : ctx.labels.setup);
    action = fix?.action ? { kind: "action", label, instanceId: ctx.instanceId, action: fix.action, ...(fix.id ? { id: fix.id } : {}) } : { kind: "link", label, href: joinTarget(ctx.pageHref, fix?.href) };
  }
  const detail = view.state === "configured" ? view.summary : view.reason || view.summary;
  return {
    id: `${ctx.anchor}.${view.id}`, name: view.title, origin: "connection", state: view.state, detail: oneLine(detail, 200), todo: ctx.todo ?? 0, action,
    menu: view.menu.map((m) => ({ label: m.label, instanceId: ctx.instanceId, action: m.action, ...(m.id ? { id: m.id } : {}), ...(m.confirm ? { confirm: m.confirm } : {}), danger: m.danger })),
  };
}

/** The row of a module whose one setting is the address of a profile. The window above the table edits it (`editHref` is this page with the section named). */
export function rowFromAddress(ctx: { anchor: string; name: string; value: string; editHref: string; labels: { edit: string; add: string } }): ConnectionRow {
  const value = oneLine(ctx.value, 200);
  return { id: ctx.anchor, name: ctx.name, origin: "address", state: value ? "configured" : "notConfigured", detail: value, todo: 0, action: { kind: "dialog", label: value ? ctx.labels.edit : ctx.labels.add, href: ctx.editHref }, menu: [] };
}

/** A page of the group that no row covers: a row with a link to it (nothing is left out of the table). */
export function rowFromPage(ctx: { id: string; name: string; href: string; todo: number; open: string }): ConnectionRow {
  return { id: ctx.id, name: ctx.name, origin: "page", state: null, detail: "", todo: ctx.todo, action: { kind: "link", label: ctx.open, href: ctx.href }, menu: [] };
}

/** The text a row answers to when searched: everything the row shows (name, origin, state, detail), never an address the person cannot see. */
export function rowSearchParts(r: ConnectionRow, labels: ConnectionsLabels): string[] {
  return [r.name, labels.origin[r.origin], r.state ? labels.state[r.state] : "", r.detail];
}

/** Rows that need attention first (degraded, then not configured), then the configured ones, then the pages; the name breaks ties. */
export function sortRows(rows: ConnectionRow[], locale: string): ConnectionRow[] {
  const rank = (r: ConnectionRow) => (r.state === "degraded" ? 0 : r.state === "notConfigured" ? 1 : r.state === "configured" ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
}

/** The pills of a filter: only the values that exist, each with its number of rows. */
export function countBy<K extends string>(values: readonly (K | null)[]): Map<K, number> {
  const out = new Map<K, number>();
  for (const v of values) if (v) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}
