import type { AdminUser } from "@/core/auth/access";
import type { Translator } from "@/core/i18n/dictionary";
import { connectionView } from "@/core/adminkit/connection";
import { describeNetHealth } from "@/core/netHealthText";
import { NETWORKS_HREF } from "@/core/adminLinks";
import { instanceSettingKey } from "@/core/modules/context";
import { loadGroupIndex } from "@/core/modules/connectionsIndex";
import { placeHref, type IndexedPage } from "@/core/modules/places";
import { getActiveInstances } from "@/core/modules/registry";
import { placeIndexFor } from "@/core/modules/placesLoad";
import { sectionQuery } from "@/core/modules/placeScope";
import { getSettingByLocale } from "@/core/settings";
import { loadPlaceSection, type LoadedSection } from "./PlaceSection";
import { rowFromAddress, rowFromConnection, rowFromPage, sortRows, type ConnectionRow } from "./connectionRows";

/** The address parameter that opens the edit window of one account (a name of its own: a module never reads it). */
export const EDIT_PARAM = "editAccount";

type Ctx = { t: Translator; locale: string; defaultLocale: string; locales: string[]; advanced: boolean };

const TEXT_LIKE = new Set(["text", "url", "link"]);
/** The only setting of a section, when the section is "one address" (a profile) and nothing else is shown in it. */
function addressField(l: LoadedSection) {
  if (l.blocks.length > 0) return null;
  const basic = l.fields.filter((f) => !f.rare && !f.advanced);
  return basic.length === 1 && TEXT_LIKE.has(basic[0]!.type) ? basic[0]! : null;
}

async function storedText(l: LoadedSection, key: string, defaultLocale: string): Promise<string> {
  const byLocale = await getSettingByLocale(instanceSettingKey(l.active.instance.id, key));
  const v = byLocale[""] ?? byLocale[defaultLocale] ?? Object.values(byLocale)[0];
  return typeof v === "string" ? v : "";
}

export type Classified = { rows: ConnectionRow[]; /** Sections the table cannot show as rows: they stay as they are. */ rest: LoadedSection[]; /** The address sections by anchor (the edit window). */ addresses: Map<string, LoadedSection> };

/**
 * Sorts loaded sections into table rows and the rest. A section becomes rows only when the table says EVERYTHING it shows: connection blocks alone, or a single address.
 * Anything else (other blocks, several settings, a section that did not load) stays where it was, so nothing is lost and nothing is shown twice (R33.7).
 */
export async function classifySections(loaded: LoadedSection[], ctx: Ctx & { pageHref: (l: LoadedSection) => string; editBase: (l: LoadedSection) => string }): Promise<Classified> {
  const { t } = ctx;
  const out: Classified = { rows: [], rest: [], addresses: new Map() };
  for (const l of loaded) {
    if (l.state !== "ok") { out.rest.push(l); continue; }
    const conns = l.blocks.filter((b) => b.type === "connection");
    const others = l.blocks.filter((b) => b.type !== "connection" && b.type !== "netHealth");
    if (conns.length > 0 && others.length === 0 && l.fields.length === 0) {
      const views = conns.flatMap((b) => {
        const block = b as Extract<typeof b, { type: "connection" }>;
        const v = connectionView(block, block.net ? describeNetHealth(block.net, ctx.locale).lines : []);
        return v ? [v] : [];
      });
      if (views.length === conns.length) {
        for (const v of views) out.rows.push(rowFromConnection(v, { anchor: l.section.anchor, instanceId: l.section.instanceId, pageHref: ctx.pageHref(l), labels: { edit: t("connections.action.edit"), fix: t("connections.action.fix"), setup: t("connections.action.setup") } }));
        continue;
      }
    }
    const field = addressField(l);
    if (field) {
      const name = l.section.siblings ? `${l.section.title} · ${l.section.instanceLabel}` : l.section.title;
      out.rows.push(rowFromAddress({ anchor: l.section.anchor, name, value: await storedText(l, field.key, ctx.defaultLocale), editHref: `${ctx.editBase(l)}?${EDIT_PARAM}=${encodeURIComponent(l.section.anchor)}`, labels: { edit: t("connections.action.edit"), add: t("connections.action.addAddress") } }));
      out.addresses.set(l.section.anchor, l);
      continue;
    }
    out.rest.push(l);
  }
  return out;
}

/** Loads every section of a page, each within its own time budget (as the place page does). */
export async function loadPageSections(page: IndexedPage, user: AdminUser, ctx: { locale: string; advanced: boolean; query?: Record<string, string> }): Promise<LoadedSection[]> {
  const actives = await getActiveInstances();
  const tabs = page.tabs;
  const all = tabs.flatMap((tab) => tab.sections.map((s) => ({ s, solo: tabs.length === 1 && tab.sections.length === 1 })));
  const loaded = await Promise.all(all.map(async ({ s, solo }) => {
    const active = actives.find((a) => a.instance.id === s.instanceId);
    return active ? loadPlaceSection(s, active, user, { locale: ctx.locale, advanced: ctx.advanced, query: sectionQuery(ctx.query ?? {}, s.instanceKey, solo) }) : null;
  }));
  return loaded.filter((x): x is LoadedSection => x !== null);
}

/** The whole table of `/admin/networks`: every page of the group that this person may open, as rows; what no row says is a "page" row with a link. */
export async function loadAccountsTable(user: AdminUser, ctx: Ctx & { group: string }): Promise<{ rows: ConnectionRow[]; addresses: Map<string, LoadedSection> } | null> {
  const index = await loadGroupIndex(user, { group: ctx.group, advanced: ctx.advanced, locale: ctx.locale, defaultLocale: ctx.defaultLocale });
  if (!index) return null;
  const links = index.blocks.flatMap((b) => b.links);
  const allowed = new Set(links.filter((l) => l.id.startsWith("place:")).map((l) => l.id.slice(6)));
  const placeIndex = await placeIndexFor(user, ctx.advanced, ctx.locale, ctx.defaultLocale);
  const pages = (placeIndex.groups.find((g) => g.id === ctx.group)?.pages ?? []).filter((p) => !p.core && allowed.has(p.id));
  const base = NETWORKS_HREF;
  const rows: ConnectionRow[] = [];
  const addresses = new Map<string, LoadedSection>();
  const pageOf = new Map<string, IndexedPage>();
  for (const p of pages) for (const tab of p.tabs) for (const s of tab.sections) pageOf.set(s.anchor, p);
  const tabHref = (l: LoadedSection) => { const p = pageOf.get(l.section.anchor)!; const i = p.tabs.findIndex((tb) => tb.sections.some((s) => s.anchor === l.section.anchor)); return i <= 0 ? p.href : placeHref(p.group, p.page, p.tabs[i]!.id); };
  for (const p of pages) {
    const got = await classifySections(await loadPageSections(p, user, { locale: ctx.locale, advanced: ctx.advanced }), { ...ctx, pageHref: tabHref, editBase: () => base });
    rows.push(...got.rows);
    for (const [k, v] of got.addresses) addresses.set(k, v);
    if (got.rest.length > 0) rows.push(rowFromPage({ id: `page:${p.id}`, name: p.title, href: p.href, todo: links.find((l) => l.id === `place:${p.id}`)?.badge ?? 0, open: ctx.t("connections.action.open") }));
  }
  // The modules pinned to the old Connections section: they have no place, so they show as a link to their page.
  for (const l of links) if (!l.id.startsWith("place:")) rows.push(rowFromPage({ id: `module:${l.id}`, name: l.name, href: l.href, todo: l.badge, open: ctx.t("connections.action.open") }));
  return { rows: sortRows(rows, ctx.locale), addresses };
}
