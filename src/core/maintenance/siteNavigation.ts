import { revalidatePath } from "next/cache";
import { prisma } from "@/core/db";
import { makeTranslator } from "@/core/i18n/dictionary";
import { pickName } from "@/core/instances";
import {
  MENU_LABEL_MAX, MENU_MAX_CHILDREN, MENU_MAX_TOTAL, SYSTEM_PAGES, countNodes, internalPath, isRefKind, parseStoredMenu, refKey, serializeMenu,
  type MenuLabel, type MenuNode,
} from "@/core/menu";
import { describeMenuRefs } from "@/core/menuCatalog";
import { menuEligible } from "@/core/modules/menuEligibility";
import { hasPublicPage } from "@/core/modules/publicPage";
import { getActiveInstances } from "@/core/modules/registry";
import { existingRefs, loadMenu, saveMenu } from "@/core/menuStore";
import { getSiteConfig } from "@/core/settings";
import { McpToolError } from "@/core/services/mcp/validate";
import { isSafeExternalUrl } from "@/core/url";
import type { Outcome } from "./actions";
import { redactSecrets } from "./redact";
import type { Plan } from "./requests";
import { clearUndoPoint, fingerprintOf, loadUndoPoint, saveUndoPoint } from "./undoPoint";

/**
 * THE MENU OF THE SITE FOR AN AI: `navigation_get` (level 1, read) and `navigation_set` (level 3, follows the approval setting of the access).
 *
 * `navigation_set` takes the WHOLE menu (the shape `navigation_get` returns, so an AI reads, edits and sends it back): adding, removing and reordering are
 * all "send the new list". One writer means one right to tick and one thing to approve, and the owner reads a before / after summary.
 * Same rules as the admin's menu form (`menuInput.ts`): 40 entries in all, 8 per submenu, two levels, labels of 80 characters at most, an entry may
 * appear only once. On top of it, for an AI: every target must EXIST (a page of the site, a module page, a published entry, a short link, an https address),
 * every label is written in EVERY language of the site, and a refusal lists every problem with an example.
 * Never: raw HTML, scripts, javascript: addresses, an address with a password, a secret. The menu itself is the only thing written (`nav.menu`).
 * When the change is applied, the previous menu is kept as a restore point the owner uses from Admin > Navigation (see undoPoint.ts).
 */
const TARGET_KEYS = ["page", "instance", "entry", "path", "externalUrl"] as const;
/** Read-only fields of `navigation_get`: accepted (and ignored) when the list is sent back as it was read. */
const READ_ONLY_KEYS = ["name", "shown", "address", "problem", "kind"] as const;
const ENTRY_KEYS = [...TARGET_KEYS, "label", "children", ...READ_ONLY_KEYS] as readonly string[];
const PATH_RE = /^\/[A-Za-z0-9._~\-/%]{0,299}$/;

export const NAVIGATION_GET_INPUT = { type: "object" } as const;
export const NAVIGATION_SET_INPUT = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      description: `The WHOLE menu, in display order (${MENU_MAX_TOTAL} entries at most, submenus included; ${MENU_MAX_CHILDREN} per submenu; two levels). Start from what navigation_get returns. Each entry has ONE target: {"page": "home"} (a page of the site: home or privacy), {"instance": "pages"} (the page of a module instance, key from site_info), {"instance": "pages", "entry": "<entry id>"} (a published entry of that instance), {"path": "/contact"} (a page of this site, by its address), or {"externalUrl": "https://example.org"} (a page elsewhere, https only). A submenu has no target but a label and "children": [...]. "label" is {"en": "Home", "fr": "Accueil"} with EVERY language of the site: optional when the target has its own name (the entry keeps it), required for externalUrl and submenus. Nothing is saved if one entry is wrong; every problem is listed.`,
      items: { type: "object" },
    },
  },
  required: ["entries"],
} as unknown as import("@/core/modules/types").JsonSchemaLite;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ───────────── Reading ───────────── */

async function siteContext() {
  const config = await getSiteConfig();
  const active = await getActiveInstances();
  return { config, active, t: makeTranslator(config.adminLocale ?? config.defaultLocale) };
}

/** Level 1: the menu as visitors get it, in the shape `navigation_set` accepts, plus what can be added. Never a secret. */
export async function navigationGet(): Promise<unknown> {
  const { config, active } = await siteContext();
  const { items, stored } = await loadMenu();
  const info = await describeMenuRefs(items, { t: makeTranslator(config.defaultLocale), locale: config.defaultLocale, defaultLocale: config.defaultLocale });
  const keyOf = new Map(active.map((a) => [a.instance.id, a.instance.key]));
  const flat = items.flatMap((n) => [n, ...(n.children ?? [])]);
  const entryIds = [...new Set(flat.filter((n) => n.kind === "entry" && n.ref).map((n) => n.ref!))];
  const entryOwner = new Map((entryIds.length ? await prisma.entry.findMany({ where: { id: { in: entryIds } }, select: { id: true, instanceId: true } }) : []).map((e) => [e.id, e.instanceId]));
  const redirectIds = [...new Set(flat.filter((n) => n.kind === "redirect" && n.ref).map((n) => n.ref!))];
  const redirectPath = new Map((redirectIds.length ? await prisma.redirect.findMany({ where: { id: { in: redirectIds } }, select: { id: true, path: true } }) : []).map((r) => [r.id, r.path]));

  const one = (n: MenuNode): Row => {
    const key = refKey(n);
    const d = key ? info[key] : undefined;
    const label = n.label ? { label: n.label } : {};
    const kids = n.children?.length ? { children: n.children.map(one) } : {};
    if (n.kind === "group") return { ...label, ...kids, kind: "submenu", shown: !!n.children?.length };
    if (n.kind === "link") {
      const internal = internalPath(n.href ?? "") !== null;
      return { ...label, ...kids, kind: internal ? "path" : "external_address", ...(internal ? { path: n.href, problem: "Free link to an address of this site that is not a known page: navigation_set refuses it. Use the page, instance or entry it leads to, or remove it." } : { externalUrl: n.href }), shown: true };
    }
    const missing = d?.missing === true;
    const target: Row = n.kind === "system" ? { page: n.ref }
      : n.kind === "instance" ? { instance: keyOf.get(n.ref!) ?? null }
      : n.kind === "entry" ? { instance: keyOf.get(entryOwner.get(n.ref!) ?? "") ?? null, entry: n.ref }
      : { path: `/${redirectPath.get(n.ref!) ?? ""}` };
    return { ...label, ...target, ...kids, kind: n.kind === "system" ? "site_page" : n.kind === "instance" ? "module_page" : n.kind === "entry" ? "content_entry" : "short_link", name: d?.title ?? "", address: d?.sub ?? "", shown: !missing, ...(missing ? { problem: "The target does not exist or is not published any more: it is hidden from visitors. Remove it from the list." } : {}) };
  };

  const eligible = active.filter((a) => hasPublicPage(a) && !!a.instance.basePath && menuEligible(a.mod.manifest));
  return {
    languages: config.locales, defaultLanguage: config.defaultLocale,
    limits: { entries: MENU_MAX_TOTAL, perSubmenu: MENU_MAX_CHILDREN, levels: 2, labelLength: MENU_LABEL_MAX },
    menuIsCustomised: stored,
    entries: items.map(one),
    canAdd: {
      sitePages: SYSTEM_PAGES.map((p) => ({ page: p.key, address: p.href })),
      modulePages: eligible.map((a) => ({ instance: a.instance.key, name: pickName(a.instance, config.defaultLocale, config.defaultLocale), address: `/${a.instance.basePath}` })),
      contentEntries: "Use {instance, entry}: the entry id comes from <instance>__list_entries (published entries only).",
      anyKnownAddress: 'Use {path: "/contact"}: a site page, module page, published entry or short link at that address.',
      otherSites: 'Use {externalUrl: "https://example.org"} with a label in every language.',
    },
    howToChange: "Change the list and send ALL of it back with navigation_set. Add = a new item, remove = leave it out, reorder = change the order.",
  };
}

/* ───────────── Validation ───────────── */

type Ctx = Awaited<ReturnType<typeof siteContext>>;

async function resolvePath(path: string, ctx: Ctx): Promise<MenuNode | null> {
  let p = path.replace(/\/+$/, "") || "/";
  // A language prefix of the site is the same page in another language.
  const first = p.split("/")[1] ?? "";
  if (first && first !== ctx.config.defaultLocale && ctx.config.locales.includes(first)) p = p.slice(first.length + 1) || "/";
  const home = SYSTEM_PAGES.find((s) => s.href === p);
  if (home) return { kind: "system", ref: home.key };
  const segments = p.split("/").filter(Boolean);
  const pages = ctx.active.filter((a) => hasPublicPage(a) && menuEligible(a.mod.manifest));
  const byBase = pages.find((a) => !!a.instance.basePath && `/${a.instance.basePath}` === p);
  if (byBase) return { kind: "instance", ref: byBase.instance.id };
  const published = { status: "published", publishedAt: { lte: new Date() } } as const;
  for (const a of pages) {
    const base = a.instance.basePath ?? "";
    const slug = base ? (segments[0] === base && segments.length === 2 ? segments[1] : undefined) : (segments.length === 1 ? segments[0] : undefined);
    if (!slug) continue;
    const tr = await prisma.entryTranslation.findFirst({ where: { instanceId: a.instance.id, slug, entry: published }, select: { entryId: true } });
    if (tr) return { kind: "entry", ref: tr.entryId };
  }
  if (segments.length === 1) {
    const r = await prisma.redirect.findFirst({ where: { path: segments[0]!, active: true }, select: { id: true } });
    if (r) return { kind: "redirect", ref: r.id };
  }
  return null;
}

function parseLabel(raw: unknown, required: boolean, ctx: Ctx, where: string, problems: string[]): MenuLabel | undefined {
  if (raw === undefined || raw === null) {
    if (required) problems.push(`${where}: a label is needed, written in every language of the site (${ctx.config.locales.join(", ")}). Example: {"label": {${ctx.config.locales.map((l) => `"${l}": "…"`).join(", ")}}}`);
    return undefined;
  }
  if (!isRow(raw)) { problems.push(`${where}: "label" must be an object with one text per language, for example {${ctx.config.locales.map((l) => `"${l}": "…"`).join(", ")}}`); return undefined; }
  const out: MenuLabel = {};
  for (const k of Object.keys(raw)) if (!ctx.config.locales.includes(k)) problems.push(`${where}: "${redactSecrets(k, 12)}" is not a language of this site (${ctx.config.locales.join(", ")})`);
  const missing: string[] = [];
  for (const l of ctx.config.locales) {
    const v = raw[l];
    const text = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!text) { missing.push(l); continue; }
    if (text.length > MENU_LABEL_MAX) problems.push(`${where}: the ${l} label is longer than ${MENU_LABEL_MAX} characters`);
    if (/<\/?[a-z][^>]*>/i.test(text)) problems.push(`${where}: the ${l} label contains HTML; write plain text`);
    out[l] = text.slice(0, MENU_LABEL_MAX);
  }
  if (missing.length) problems.push(`${where}: the label is missing in ${missing.join(", ")} (a label is written in every language of the site)`);
  return out;
}

/** One entry -> a menu node, or problems. `level` 0 = main menu, 1 = inside a submenu. */
async function parseEntry(raw: unknown, where: string, level: 0 | 1, ctx: Ctx, problems: string[]): Promise<MenuNode | null> {
  if (!isRow(raw)) { problems.push(`${where}: each entry must be an object such as {"page": "home"}`); return null; }
  for (const k of Object.keys(raw)) if (!ENTRY_KEYS.includes(k)) problems.push(`${where}: unexpected field "${redactSecrets(k, 30)}"`);
  const given = TARGET_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== "");
  const kidsRaw = raw.children;
  const hasKids = Array.isArray(kidsRaw) && kidsRaw.length > 0;
  if (kidsRaw !== undefined && !Array.isArray(kidsRaw)) problems.push(`${where}: "children" must be a list`);
  if (hasKids && level === 1) problems.push(`${where}: a submenu cannot contain another submenu (two levels at most)`);
  if (hasKids && (kidsRaw as unknown[]).length > MENU_MAX_CHILDREN) problems.push(`${where}: a submenu holds ${MENU_MAX_CHILDREN} entries at most (this one has ${(kidsRaw as unknown[]).length})`);

  let node: MenuNode | null = null;
  const isEntryOfInstance = given.length === 2 && given.includes("instance") && given.includes("entry");
  if (given.length === 0) {
    if (!hasKids) { problems.push(`${where}: give a target ("page", "instance", "path" or "externalUrl"), or a submenu with a label and "children". Example: {"page": "home"}`); return null; }
    if (level === 1) return null;
    const label = parseLabel(raw.label, true, ctx, where, problems);
    node = { kind: "group", ...(label ? { label } : {}) };
  } else if (given.length > 1 && !isEntryOfInstance) {
    problems.push(`${where}: give ONE target, not several (${given.join(", ")}). A published entry is {"instance": "pages", "entry": "<id>"}`);
    return null;
  } else if (isEntryOfInstance) {
    const a = ctx.active.find((x) => x.instance.key === raw.instance);
    if (!a || !hasPublicPage(a) || !menuEligible(a.mod.manifest)) { problems.push(`${where}: "${redactSecrets(String(raw.instance), 40)}" is not a module instance with a public page (see site_info)`); return null; }
    const e = typeof raw.entry === "string" ? await prisma.entry.findFirst({ where: { id: raw.entry, instanceId: a.instance.id, status: "published", publishedAt: { lte: new Date() } }, select: { id: true } }) : null;
    if (!e) { problems.push(`${where}: no published entry "${redactSecrets(String(raw.entry), 40)}" in "${a.instance.key}" (ids come from ${a.instance.key}__list_entries; a draft cannot be in the menu: publish it first)`); return null; }
    node = { kind: "entry", ref: e.id };
  } else if (given[0] === "page") {
    const p = SYSTEM_PAGES.find((s) => s.key === raw.page);
    if (!p) { problems.push(`${where}: unknown page "${redactSecrets(String(raw.page), 30)}". The site pages are: ${SYSTEM_PAGES.map((s) => s.key).join(", ")}`); return null; }
    node = { kind: "system", ref: p.key };
  } else if (given[0] === "instance") {
    const a = ctx.active.find((x) => x.instance.key === raw.instance);
    if (!a) { problems.push(`${where}: unknown instance "${redactSecrets(String(raw.instance), 40)}" (keys are listed by site_info)`); return null; }
    if (!hasPublicPage(a) || !a.instance.basePath || !menuEligible(a.mod.manifest)) { problems.push(`${where}: "${a.instance.key}" has no page of its own that can be in the menu${a.instance.basePath === "" ? ' (it lives at the root of the site: put one of its published entries in the menu instead, {"instance": "' + a.instance.key + '", "entry": "<id>"})' : ""}`); return null; }
    node = { kind: "instance", ref: a.instance.id };
  } else if (given[0] === "entry") {
    problems.push(`${where}: "entry" goes with "instance": {"instance": "pages", "entry": "<id>"}`);
    return null;
  } else if (given[0] === "path") {
    const path = typeof raw.path === "string" ? raw.path.trim() : "";
    if (!PATH_RE.test(path) || path.startsWith("//")) { problems.push(`${where}: "path" must be an address of this site starting with "/", for example "/contact"`); return null; }
    node = await resolvePath(path, ctx);
    if (!node) { problems.push(`${where}: no page of this site is at "${path}". Use a known page, module page, published entry or short link (see navigation_get > canAdd), or an externalUrl for another site`); return null; }
  } else {
    const url = typeof raw.externalUrl === "string" ? raw.externalUrl.trim() : "";
    let ok = /^https:\/\//i.test(url) && url.length <= 2000 && isSafeExternalUrl(url);
    if (ok) { try { const u = new URL(url); ok = !u.username && !u.password; } catch { ok = false; } }
    if (!ok) { problems.push(`${where}: "externalUrl" must be a full https address without a password, for example "https://example.org/press"`); return null; }
    const label = parseLabel(raw.label, true, ctx, where, problems);
    node = { kind: "link", href: url, ...(label ? { label } : {}) };
  }

  if (node.kind !== "group" && node.kind !== "link") {
    const label = parseLabel(raw.label, false, ctx, where, problems);
    if (label) node.label = label;
  }
  if (hasKids && level === 0) {
    const kids: MenuNode[] = [];
    for (let j = 0; j < (kidsRaw as unknown[]).length && j < MENU_MAX_CHILDREN + 1; j++) {
      const k = await parseEntry((kidsRaw as unknown[])[j], `${where}.children[${j}]`, 1, ctx, problems);
      if (k) kids.push(k);
    }
    if (kids.length) node.children = kids;
  }
  if (node.kind === "group" && !node.children?.length) { problems.push(`${where}: a submenu needs at least one entry in "children"`); return null; }
  return node;
}

/** Name used in summaries: the label in the main language, else the target's own name. */
const nameOf = (n: MenuNode, info: Record<string, { title: string }>, locale: string): string => clip(n.label?.[locale] ?? Object.values(n.label ?? {})[0] ?? (refKey(n) ? info[refKey(n)!]?.title : undefined) ?? n.href ?? n.ref ?? "?", 40);
const identity = (n: MenuNode): string => refKey(n) ?? (n.kind === "link" ? `link:${n.href}` : `group:${Object.values(n.label ?? {}).join("|")}`);
const flatten = (items: readonly MenuNode[]): MenuNode[] => items.flatMap((n) => [n, ...(n.children ?? [])]);

/** Level 3, preparation (read only): checks every entry against the site, and freezes the new menu with a before / after summary for the owner. */
export async function prepareNavigationSet(args: { entries?: unknown }): Promise<Plan> {
  if (!Array.isArray(args.entries)) throw new McpToolError('Give "entries": the whole menu as a list, for example [{"page": "home"}, {"instance": "pages", "entry": "<id>"}]. Read it first with navigation_get.');
  if (args.entries.length === 0) throw new McpToolError("The menu would be empty. Give at least one entry (a site without a menu is almost never wanted; the owner can empty it in Admin > Navigation).");
  if (args.entries.length > MENU_MAX_TOTAL) throw new McpToolError(`The menu holds ${MENU_MAX_TOTAL} entries at most, submenus included.`);
  const ctx = await siteContext();
  const problems: string[] = [];
  const items: MenuNode[] = [];
  for (let i = 0; i < args.entries.length; i++) {
    const n = await parseEntry(args.entries[i], `entries[${i}]`, 0, ctx, problems);
    if (n) items.push(n);
  }
  const seen = new Set<string>();
  flatten(items).forEach((n) => { const k = refKey(n); if (!k) return; if (seen.has(k)) problems.push(`The same page appears twice in the menu (${k.replace(/^[a-z]+:/, "")}); keep it once`); seen.add(k); });
  if (!problems.length && countNodes(items) > MENU_MAX_TOTAL) problems.push(`The menu holds ${MENU_MAX_TOTAL} entries at most, submenus included (this one has ${countNodes(items)}).`);
  if (problems.length) throw new McpToolError(`Menu not changed: ${problems.slice(0, 12).join("; ")}${problems.length > 12 ? `; and ${problems.length - 12} more` : ""}.`);

  const current = (await loadMenu()).items;
  const next = parseStoredMenu(serializeMenu(items)) ?? items;
  const infoCtx = { t: makeTranslator(ctx.config.defaultLocale), locale: ctx.config.defaultLocale, defaultLocale: ctx.config.defaultLocale };
  const info = { ...(await describeMenuRefs(current, infoCtx)), ...(await describeMenuRefs(next, infoCtx)) };
  const before = new Map(flatten(current).map((n) => [identity(n), nameOf(n, info, ctx.config.defaultLocale)]));
  const after = new Map(flatten(next).map((n) => [identity(n), nameOf(n, info, ctx.config.defaultLocale)]));
  const added = [...after].filter(([k]) => !before.has(k)).map(([, v]) => v);
  const removed = [...before].filter(([k]) => !after.has(k)).map(([, v]) => v);
  const order = (list: readonly MenuNode[]) => JSON.stringify(list.map((n) => [identity(n), (n.children ?? []).map(identity)]));
  const reordered = !added.length && !removed.length && order(current) !== order(next);
  return { change: { target: "navigation", before: fingerprintOf(current), entries: next, summary: { beforeCount: countNodes(current), afterCount: countNodes(next), added: added.slice(0, 12), removed: removed.slice(0, 12), reordered, same: fingerprintOf(current) === fingerprintOf(next) } } };
}

/* ───────────── Execution ───────────── */

/** After the owner's approval (or at once in "act without asking"): applies the frozen menu, if nothing changed in between and every target still exists. */
export async function executeNavigationSet(plan: Plan, actorLabel: string): Promise<Outcome> {
  const change = plan.change;
  if (!change || change.target !== "navigation") return { ok: false, message: "Not done: the request is damaged. Ask again." };
  const items = change.entries as MenuNode[];
  const current = (await loadMenu()).items;
  if (fingerprintOf(current) !== change.before) return { ok: false, message: "Not done: the menu was changed by someone else since the request. Read it again with navigation_get and ask again." };
  if (change.summary.same) return { ok: true, message: "Nothing needed to change: the menu was already like this." };
  const known = await existingRefs(flatten(items).flatMap((n) => (isRefKind(n.kind) && n.ref ? [{ kind: n.kind, ref: n.ref }] : [])));
  const gone = flatten(items).filter((n) => refKey(n) && !known.has(refKey(n)!));
  if (gone.length) return { ok: false, message: "Not done: a page of the menu does not exist any more since the request. Read the menu again with navigation_get and ask again." };
  await saveMenu(items);
  const applied = fingerprintOf((await loadMenu()).items);
  await saveUndoPoint("navigation", { at: Date.now(), by: actorLabel.replace(/^mcp:/, ""), previous: current, applied });
  const s = change.summary;
  const target = redactSecrets(`${s.beforeCount} -> ${s.afterCount} entries${s.added.length ? `; added: ${s.added.join(", ")}` : ""}${s.removed.length ? `; removed: ${s.removed.join(", ")}` : ""}${s.reordered ? "; reordered" : ""}`, 300);
  await prisma.auditLog.create({ data: { actor: actorLabel, actorKind: "assistant", action: "navigation.update", target } }).catch(() => {});
  try { revalidatePath("/", "layout"); } catch { /* outside a request (tests, scripts): the menu is read again at the next visit */ }
  return { ok: true, message: `The menu was updated (${s.beforeCount} -> ${s.afterCount} entries). The owner can restore the previous menu in Admin > Navigation until someone edits it again.`, details: { entries: s.afterCount } };
}

/* ───────────── Restore (admin) ───────────── */

export type RestoreResult = { ok: true } | { ok: false; reason: "none" | "changed" };

/** What the admin shows: is there an AI change to take back, who made it, when. Null when the menu was edited since (nothing to restore safely). */
export async function navigationRestorePoint(): Promise<{ by: string; at: number } | null> {
  const p = await loadUndoPoint("navigation");
  if (!p || fingerprintOf((await loadMenu()).items) !== p.applied) return null;
  return { by: p.by, at: p.at };
}

export async function restoreNavigation(actorEmail: string): Promise<RestoreResult> {
  const p = await loadUndoPoint("navigation");
  if (!p) return { ok: false, reason: "none" };
  if (fingerprintOf((await loadMenu()).items) !== p.applied) return { ok: false, reason: "changed" };
  const previous = parseStoredMenu(serializeMenu(Array.isArray(p.previous) ? (p.previous as MenuNode[]) : []));
  await saveMenu(previous ?? []);
  await clearUndoPoint("navigation");
  await prisma.auditLog.create({ data: { actor: actorEmail, actorKind: "person", action: "navigation.update", target: "restored the menu from before the AI change" } }).catch(() => {});
  try { revalidatePath("/", "layout"); } catch { /* outside a request */ }
  return { ok: true };
}
