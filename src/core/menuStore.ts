import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { MENU_MAX_TOTAL, MENU_SETTING, SYSTEM_PAGES, countNodes, legacyMenu, menuRefKeys, parseStoredMenu, refKey, serializeMenu, type LegacyNavItem, type MenuNode } from "./menu";

// Le menu en base : lecture, migration unique de l'ancien menu, enregistrement, et ajout / retrait d'une instance. Les fonctions prennent la connexion
// (ou la transaction) en paramètre : la création d'une instance appelle `ensureMenuMigrated` AVANT d'écrire, dans sa propre transaction.

type Db = PrismaClient | Prisma.TransactionClient;

async function readJson(db: Db, key: string): Promise<unknown> {
  const row = await db.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

async function writeJson(db: Db, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await db.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
}

/** Adresses internes que l'ancien menu désignait et qui sont des pages publiées à la racine du site (langue par défaut) : adresse → identifiant d'entrée. Lecture bornée. */
async function rootEntriesByHref(db: Db, hrefs: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hrefs.size === 0) return out;
  const roots = await db.moduleInstance.findMany({ where: { basePath: "" }, select: { id: true } });
  if (roots.length === 0) return out;
  const locale = String(((await readJson(db, "i18n.default")) as string | undefined) ?? "") || null;
  const slugs = [...hrefs].map((h) => h.replace(/^\//, "")).filter((s) => s && !s.includes("/"));
  if (slugs.length === 0) return out;
  const rows = await db.entryTranslation.findMany({
    where: { instanceId: { in: roots.map((r) => r.id) }, slug: { in: slugs }, entry: { status: "published" }, ...(locale ? { locale } : {}) },
    select: { slug: true, entryId: true },
    take: 200,
  });
  for (const r of rows) out.set(`/${r.slug}`, r.entryId);
  return out;
}

/** Le menu tel que l'ancien cœur le montrait, reconstruit depuis la base (instances « dans le menu » puis `nav.custom`). Ne modifie rien. */
export async function legacyMenuFromDb(db: Db = prisma): Promise<MenuNode[]> {
  const instances = await db.moduleInstance.findMany({ orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }], select: { id: true, basePath: true, showInNav: true } });
  const rawCustom = await readJson(db, "nav.custom");
  const custom = (Array.isArray(rawCustom) ? rawCustom : []).filter((x): x is LegacyNavItem => !!x && typeof x === "object");
  const internal = new Set<string>();
  const addHref = (h: unknown) => { const v = String(h ?? "").trim(); if (v.startsWith("/") && !v.startsWith("//")) internal.add(v); };
  for (const c of custom) { if (Array.isArray(c.children)) c.children.forEach((k) => addHref(k?.href)); else addHref(c.href); }
  return legacyMenu({ instances, custom, entryByHref: await rootEntriesByHref(db, internal) });
}

export type LoadedMenu = { items: MenuNode[]; /** Le réglage `nav.menu` existe (sinon `items` est l'ancien menu, reconstruit mais pas encore enregistré). */ stored: boolean };

export async function loadMenu(db: Db = prisma): Promise<LoadedMenu> {
  const parsed = parseStoredMenu(await readJson(db, MENU_SETTING));
  return parsed ? { items: parsed, stored: true } : { items: await legacyMenuFromDb(db), stored: false };
}

/**
 * MIGRATION (idempotente) : fige l'état actuel du menu dans `nav.menu`. Un site existant garde exactement le même menu après la mise à jour ; ensuite
 * seules les décisions de la personne le changent. Si `nav.menu` existe déjà et se lit, rien n'est écrit. L'ancien réglage `nav.custom` reste intact.
 * Renvoie vrai si la migration vient d'écrire.
 */
export async function ensureMenuMigrated(db: Db = prisma): Promise<boolean> {
  if (parseStoredMenu(await readJson(db, MENU_SETTING))) return false;
  await writeJson(db, MENU_SETTING, serializeMenu(await legacyMenuFromDb(db)));
  return true;
}

export async function saveMenu(items: readonly MenuNode[], db: Db = prisma): Promise<void> {
  await writeJson(db, MENU_SETTING, serializeMenu(items));
}

/** L'instance est-elle dans le menu (à n'importe quel niveau) ? */
export async function isInstanceInMenu(instanceId: string, db: Db = prisma): Promise<boolean> {
  return menuRefKeys((await loadMenu(db)).items).has(`instance:${instanceId}`);
}

/**
 * Ajoute (à la fin du menu principal) ou retire l'instance du menu. Ajouter une instance déjà présente, ou retirer une absente, ne change rien.
 * Renvoie `false` si le menu est plein (40 éléments) et que l'ajout est refusé.
 */
export async function setInstanceInMenu(instanceId: string, on: boolean, db: Db = prisma): Promise<boolean> {
  const { items } = await loadMenu(db);
  const key = `instance:${instanceId}`;
  if (on === menuRefKeys(items).has(key)) return true;
  if (on) {
    if (countNodes(items) >= MENU_MAX_TOTAL) return false;
    await saveMenu([...items, { kind: "instance", ref: instanceId }], db);
    return true;
  }
  const out: MenuNode[] = [];
  for (const n of items) {
    // Un parent retiré qui avait un sous-menu : ses éléments remontent au menu principal plutôt que de disparaître.
    if (refKey(n) === key) { out.push(...(n.children ?? [])); continue; }
    const kids = (n.children ?? []).filter((c) => refKey(c) !== key);
    const { children: _drop, ...rest } = n;
    void _drop;
    out.push(kids.length ? { ...rest, children: kids } : rest);
  }
  await saveMenu(out, db);
  return true;
}

/** Parmi les références citées, celles qui existent encore (page du cœur connue, instance avec une page propre, entrée, raccourci) : `sorte:identifiant`. Une requête par sorte, bornée par le nombre de références citées. */
export async function existingRefs(cited: readonly { kind: string; ref: string }[], db: Db = prisma): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = (kind: string) => [...new Set(cited.filter((c) => c.kind === kind).map((c) => c.ref))].slice(0, MENU_MAX_TOTAL * 2);
  for (const p of SYSTEM_PAGES) if (cited.some((c) => c.kind === "system" && c.ref === p.key)) out.add(`system:${p.key}`);
  const inst = ids("instance");
  if (inst.length) for (const r of await db.moduleInstance.findMany({ where: { id: { in: inst }, NOT: { basePath: null } }, select: { id: true, basePath: true } })) if (r.basePath) out.add(`instance:${r.id}`);
  const ent = ids("entry");
  if (ent.length) for (const r of await db.entry.findMany({ where: { id: { in: ent } }, select: { id: true } })) out.add(`entry:${r.id}`);
  const red = ids("redirect");
  if (red.length) for (const r of await db.redirect.findMany({ where: { id: { in: red } }, select: { id: true } })) out.add(`redirect:${r.id}`);
  return out;
}
