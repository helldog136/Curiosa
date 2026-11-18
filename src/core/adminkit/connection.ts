/**
 * The `connection` block (pure, tested without a browser): validates what a module returned and decides what the person sees (R33).
 *  - three states only: configured / degraded / notConfigured, written by the core ("Configured", "Degraded", "Not configured");
 *  - setup instructions (`setup`) exist only while the state is `notConfigured` (R33.5);
 *  - a configured connection whose external services have a problem shows as degraded, with one line (R33.7); when every service answers, nothing is added.
 */
import type { Block } from "../blocks";
import type { NetHealthLine } from "../netHealthText";

type ConnectionBlock = Extract<Block, { type: "connection" }>;
export type ConnectionState = ConnectionBlock["state"];
export const CONNECTION_STATES: readonly ConnectionState[] = ["configured", "degraded", "notConfigured"];

type Fix = { label: string; href?: string; action?: string; id?: string };
export type ConnectionRow = { text: string; state: ConnectionState; reason?: string; primary?: Fix };
export type ConnectionView = {
  id: string; title: string; state: ConnectionState; summary: string; reason: string; since: Date | null;
  primary: Fix | null; edit: { href: string; label?: string } | null;
  menu: { label: string; action: string; confirm?: string; danger: boolean; id?: string }[];
  setup: Block[]; rows: ConnectionRow[];
  /** The state came from the health of the external services, not from the module. */
  fromNet: boolean;
};

const oneLine = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ACTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** A target the card may link to: a page of the admin or of the site, a query string of this page, or an https address. */
export const safeTarget = (href: unknown): string | null => {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (h.length === 0 || h.length > 500 || /[\u0000-\u001f\u007f\\]/.test(h) || h.startsWith("//")) return null;
  if (h.startsWith("/") || h.startsWith("?")) return h;
  try { const u = new URL(h); return u.protocol === "https:" && !u.username && !u.password ? h : null; } catch { return null; }
};

function fix(p: unknown): Fix | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const label = oneLine(o.label, 60);
  if (!label) return null;
  const href = safeTarget(o.href);
  const action = typeof o.action === "string" && ACTION_NAME.test(o.action) ? o.action : undefined;
  if (!href && !action) return null;
  return { label, ...(href ? { href } : {}), ...(action && !href ? { action } : {}), ...(typeof o.id === "string" && o.id ? { id: o.id.slice(0, 200) } : {}) };
}

/** The view of a block, or null when it is not a valid one (the page then shows nothing for it: the kit tests say why). `net`: the problem lines of the services the block names. */
export function connectionView(block: ConnectionBlock, net: NetHealthLine[] = []): ConnectionView | null {
  if (!block || typeof block !== "object" || !CONNECTION_STATES.includes(block.state)) return null;
  const title = oneLine(block.title, 80);
  if (!title) return null;
  let state = block.state;
  let reason = oneLine(block.reason, 200);
  let fromNet = false;
  if (state === "configured" && net.length > 0) { state = "degraded"; reason = reason || oneLine(net.map((l) => l.text).join(" "), 300); fromNet = true; }
  const since = state === "degraded" && !fromNet && typeof block.since === "string" && Number.isFinite(Date.parse(block.since)) ? new Date(block.since) : null;
  const edit = state !== "notConfigured" && block.edit && safeTarget(block.edit.href) ? { href: safeTarget(block.edit.href)!, label: oneLine(block.edit.label, 40) || undefined } : null;
  const menu = (Array.isArray(block.menu) ? block.menu : []).slice(0, 4).flatMap((m) => {
    const label = oneLine(m?.label, 60);
    return label && typeof m.action === "string" && ACTION_NAME.test(m.action) ? [{ label, action: m.action, ...(m.confirm ? { confirm: oneLine(m.confirm, 300) } : {}), danger: m.danger === true, ...(m.id ? { id: String(m.id).slice(0, 200) } : {}) }] : [];
  });
  const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, 20).flatMap((r): ConnectionRow[] => {
    const text = oneLine(r?.text, 120);
    if (!text || !CONNECTION_STATES.includes(r.state) || r.state === "configured") return [];
    const primary = fix(r.primary);
    return [{ text, state: r.state, ...(oneLine(r.reason, 200) ? { reason: oneLine(r.reason, 200) } : {}), ...(primary ? { primary } : {}) }];
  });
  return {
    id: oneLine(block.id, 64).replace(/[^A-Za-z0-9_-]/g, "") || "connection", title, state, summary: state === "notConfigured" ? "" : oneLine(block.summary, 200), reason: state === "configured" ? "" : reason,
    since, primary: state === "configured" ? null : fix(block.primary), edit, menu, setup: state === "notConfigured" && Array.isArray(block.setup) ? block.setup : [], rows, fromNet,
  };
}

/** "since 15 November" (the year only when it is not this one). */
export function sinceText(d: Date, locale: string, now: number = Date.now()): string {
  const year = new Date(now).getFullYear() === d.getFullYear() ? {} : { year: "numeric" as const };
  try { return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...year }).format(d); } catch { return d.toISOString().slice(0, 10); }
}

/** The tone of the chip of each state. The word always comes with the colour (R28). */
export const STATE_TONE: Record<ConnectionState, "ok" | "warn" | "neutral"> = { configured: "ok", degraded: "warn", notConfigured: "neutral" };
