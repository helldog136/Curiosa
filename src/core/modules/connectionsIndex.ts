import { canOpen, openableModuleEntries, ownersOf } from "../adminAccess";
import type { AdminUser } from "../auth/access";
import { entryHref } from "../adminSidebar";
import { getAdminNav } from "./adminNav";
import { buildMenuLayout } from "./menuPlacement";
import { buildMenuTree, connectionBlocks, type TreeItem } from "./menuPath";
import { currentVocabulary, fullyPlacedInstances, placeIndexFor } from "./placesLoad";

// The index page of a group of places (`/admin/<group>`, C2b of the admin redesign). Today only the Networks group has a real use for it: the sidebar no longer lists
// its pages and the pinned modules of the old Connections section, so this page does, under the name "Accounts and connections". Nothing is left out: it is the same
// computation the sidebar used (same access table, same placement of modules), only drawn as a page.

export type GroupIndexLink = { id: string; name: string; href: string; badge: number };
export type GroupIndexBlock = { id: string; /** A sub-group (Twitch, YouTube...); null for the entries of the group itself. */ title: string | null; links: GroupIndexLink[] };
export type GroupIndex = { title: string; blocks: GroupIndexBlock[] };

type Item = TreeItem & { href: string; place?: true; key?: string; content?: boolean };

/** What this person may open under a group, or null when the group does not exist. */
export async function loadGroupIndex(user: AdminUser, opts: { group: string; advanced: boolean; locale: string; defaultLocale: string }): Promise<GroupIndex | null> {
  const vocab = currentVocabulary();
  const group = vocab.groups.find((g) => g.id === opts.group);
  if (!group) return null;
  const everyNav = await getAdminNav(opts.locale, opts.defaultLocale);
  const owners = ownersOf(everyNav, vocab.groups.map((g) => g.id));
  const placedAway = await fullyPlacedInstances();
  const nav = openableModuleEntries(user, everyNav, owners).filter((m) => !placedAway.has(m.id));
  const index = await placeIndexFor(user, opts.advanced, opts.locale, opts.defaultLocale);
  const pages = (index.groups.find((g) => g.id === opts.group)?.pages ?? []).filter((p) => !p.core && canOpen(user, p.href, owners));
  const places: Item[] = pages.map((p, i) => ({ id: `place:${p.id}`, name: p.title, badge: 0, error: false, placement: "menu", menuPath: [{ id: group.id, text: group.id }], menuOrder: i, connector: false, moduleId: "", href: p.href, place: true as const }));
  const title = index.groups.find((g) => g.id === opts.group)?.title ?? (/^fr/i.test(opts.locale) ? group.fr : group.en);
  if (opts.group !== "networks") return places.length > 0 ? { title, blocks: [{ id: group.id, title: null, links: places.map((p) => ({ id: p.id, name: p.name, href: p.href, badge: 0 })) }] } : null;
  // Networks: what the sidebar used to show in its Networks group and in its Connections section.
  const items: Item[] = [...nav.map((m): Item => ({ ...m, href: entryHref(m), name: m.name })), ...places];
  const tree = buildMenuTree<Item>(items, opts.locale);
  const blocks = connectionBlocks(tree, buildMenuLayout(nav).connections.map((m): Item => ({ ...m, href: entryHref(m), name: m.name })));
  return { title, blocks: blocks.map((b) => ({ id: b.id, title: b.title, links: b.entries.map((e) => ({ id: e.id, name: e.name, href: e.href, badge: e.badge })) })) };
}
