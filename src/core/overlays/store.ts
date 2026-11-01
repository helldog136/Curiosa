import type { OverlayPage } from "@prisma/client";
import { prisma } from "../db";
import { MAX_ACTIVE_PAGES, MAX_ELEMENTS_PER_PAGE, MAX_PAGES, DEFAULT_RESOLUTION, MAX_SIDE, MIN_SIDE, NAME_MAX, UID_RE, clampInt, isPlainObject, nextTestUntil, type OverlayPageData, type PageElement } from "./model";
import { keepOptions } from "./options";
import { newSecret, secretColumns, unsealSecret } from "./secret";
import { cleanName, type PageValue } from "./pageInput";
import { parseStyle } from "./tokens";

/** Accès à la base des pages d'overlay. Les limites dures (20 pages, 10 actives, 30 éléments) sont appliquées ICI, à l'écriture. Lectures toujours bornées (20 lignes). */
type Fail = { ok: false; error: "notFound" | "limitPages" | "limitActive" | "name" | "resolution" };
export type StoreResult<T = Record<never, never>> = ({ ok: true } & T) | Fail;

const parse = (raw: string, fallback: unknown): unknown => { try { return JSON.parse(raw); } catch { return fallback; } };

/** Lit les éléments d'une ligne sans jamais lever : une ligne abîmée donne moins d'éléments, pas une erreur. */
export function parseElements(raw: string): PageElement[] {
  const list = parse(raw, []);
  if (!Array.isArray(list)) return [];
  const out: PageElement[] = [];
  const seen = new Set<string>();
  for (const e of list.slice(0, MAX_ELEMENTS_PER_PAGE)) {
    if (!isPlainObject(e) || typeof e.uid !== "string" || !UID_RE.test(e.uid) || seen.has(e.uid) || typeof e.instance !== "string" || typeof e.element !== "string") continue;
    seen.add(e.uid);
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
    out.push({ uid: e.uid, instance: e.instance.slice(0, 40), element: e.element.slice(0, 60), x: n(e.x, 0), y: n(e.y, 0), w: Math.max(1, n(e.w, 100)), h: Math.max(1, n(e.h, 100)), visible: e.visible !== false, options: keepOptions(e.options) });
  }
  return out;
}

export function toData(row: OverlayPage): OverlayPageData {
  return {
    id: row.id, name: row.name, width: clampInt(row.width, MIN_SIDE, MAX_SIDE, DEFAULT_RESOLUTION[0]), height: clampInt(row.height, MIN_SIDE, MAX_SIDE, DEFAULT_RESOLUTION[1]),
    active: row.active, style: parseStyle(parse(row.style, {})), elements: parseElements(row.elements), rev: row.rev, testUntil: row.testUntil ? row.testUntil.getTime() : null,
  };
}

export async function listPages(): Promise<OverlayPageData[]> {
  return (await prisma.overlayPage.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_PAGES })).map(toData);
}
export async function getPage(id: string): Promise<OverlayPageData | null> {
  if (typeof id !== "string" || id.length > 40) return null;
  const row = await prisma.overlayPage.findUnique({ where: { id } });
  return row ? toData(row) : null;
}
export async function getPageBySecret(hash: string): Promise<OverlayPageData | null> {
  const row = await prisma.overlayPage.findUnique({ where: { secretHash: hash } });
  return row ? toData(row) : null;
}
/** L'adresse secrète d'une page, pour la montrer à qui administre (null : illisible, voir secret.ts). Jamais journalisée. */
export async function readSecret(id: string): Promise<string | null> {
  const row = await prisma.overlayPage.findUnique({ where: { id }, select: { secretSealed: true } });
  return row ? unsealSecret(row.secretSealed) : null;
}

export async function createPage(input: { name: string; width: number; height: number; style?: unknown; elements?: PageElement[] }): Promise<StoreResult<{ page: OverlayPageData }>> {
  const name = cleanName(input.name);
  if (!name || name.length > NAME_MAX) return { ok: false, error: "name" };
  if ([input.width, input.height].some((n) => !Number.isInteger(n) || n < MIN_SIDE || n > MAX_SIDE)) return { ok: false, error: "resolution" };
  return prisma.$transaction(async (tx) => {
    if ((await tx.overlayPage.count()) >= MAX_PAGES) return { ok: false, error: "limitPages" } as Fail;
    // Une nouvelle page est active tant que la limite d'actives n'est pas atteinte (sinon elle attend, inactive).
    const active = (await tx.overlayPage.count({ where: { active: true } })) < MAX_ACTIVE_PAGES;
    const row = await tx.overlayPage.create({ data: { name, width: input.width, height: input.height, active, style: JSON.stringify(parseStyle(input.style)), elements: JSON.stringify((input.elements ?? []).slice(0, MAX_ELEMENTS_PER_PAGE)), ...secretColumns(newSecret()) } });
    return { ok: true, page: toData(row) } as const;
  });
}

/** Copie d'une page : mêmes éléments et style, NOUVELLE adresse secrète, jamais active d'office (pas de dépassement des 10 actives), pas de mode test. */
export async function duplicatePage(id: string, copyName: (name: string) => string): Promise<StoreResult<{ page: OverlayPageData }>> {
  const from = await getPage(id);
  if (!from) return { ok: false, error: "notFound" };
  const name = copyName(from.name).slice(0, NAME_MAX);
  const made = await createPage({ name, width: from.width, height: from.height, style: from.style, elements: from.elements });
  if (!made.ok) return made;
  const row = await prisma.overlayPage.update({ where: { id: made.page.id }, data: { active: false } });
  return { ok: true, page: toData(row) };
}

export async function renamePage(id: string, rawName: string): Promise<StoreResult> {
  const name = cleanName(rawName);
  if (!name || name.length > NAME_MAX) return { ok: false, error: "name" };
  const r = await prisma.overlayPage.updateMany({ where: { id }, data: { name } });
  return r.count ? { ok: true } : { ok: false, error: "notFound" };
}

export async function setActive(id: string, active: boolean): Promise<StoreResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.overlayPage.findUnique({ where: { id }, select: { active: true } });
    if (!row) return { ok: false, error: "notFound" } as Fail;
    if (active && !row.active && (await tx.overlayPage.count({ where: { active: true } })) >= MAX_ACTIVE_PAGES) return { ok: false, error: "limitActive" } as Fail;
    await tx.overlayPage.update({ where: { id }, data: { active, rev: { increment: 1 } } });
    return { ok: true } as const;
  });
}

export async function deletePage(id: string): Promise<StoreResult> {
  const r = await prisma.overlayPage.deleteMany({ where: { id } });
  return r.count ? { ok: true } : { ok: false, error: "notFound" };
}

/** Enregistre la mise en page validée (voir pageInput.ts). `rev` augmente : OBS la remarque à son prochain contrôle. */
export async function savePage(id: string, value: PageValue): Promise<StoreResult<{ page: OverlayPageData }>> {
  if (value.elements.length > MAX_ELEMENTS_PER_PAGE) return { ok: false, error: "notFound" };
  const r = await prisma.overlayPage.updateMany({ where: { id }, data: { name: value.name, width: value.width, height: value.height, style: JSON.stringify(value.style), elements: JSON.stringify(value.elements), rev: { increment: 1 } } });
  if (!r.count) return { ok: false, error: "notFound" };
  return { ok: true, page: (await getPage(id))! };
}

/** « Changer l'adresse secrète » : l'ancienne adresse cesse de fonctionner tout de suite. */
export async function resetPageSecret(id: string): Promise<StoreResult> {
  const r = await prisma.overlayPage.updateMany({ where: { id }, data: { ...secretColumns(newSecret()), rev: { increment: 1 } } });
  return r.count ? { ok: true } : { ok: false, error: "notFound" };
}

/** Mode test : démarrer (30 min), prolonger (+30 min) ou arrêter. L'échéance est constatée à la lecture : aucun minuteur. Ne change pas `rev` (la page d'OBS le voit par son interrogation). */
export async function setTest(id: string, action: "start" | "extend" | "stop", now = Date.now()): Promise<StoreResult<{ testUntil: number | null }>> {
  const row = await prisma.overlayPage.findUnique({ where: { id }, select: { testUntil: true } });
  if (!row) return { ok: false, error: "notFound" };
  const until = nextTestUntil(action, row.testUntil ? row.testUntil.getTime() : null, now);
  await prisma.overlayPage.update({ where: { id }, data: { testUntil: until === null ? null : new Date(until) } });
  return { ok: true, testUntil: until };
}
