/**
 * STORAGE OF SKIN CUSTOMIZATION (docs/SKINS.md "Customization", "Storage"): the setting `skin.custom.<skinId>`, the pictures an owner uploaded, their quota.
 *
 *  - ONE setting per skin, only what differs from the skin's defaults, at most 4 KB: `{ v: 1, skinVersion, look?, values: { <controlId>: <value> } }`. It is kept when the
 *    owner switches to another skin (coming back finds it again) and when a skin is removed (the removal can erase it on request). Never inside the skin's own files.
 *  - every value is checked again here (`checkValue`) whoever sends it: the page, the assistant, a restored backup. An unknown or no longer fitting key is IGNORED at read
 *    and kept in storage until the next save (so the owner can go back to a previous version of the skin and find it).
 *  - pictures are files of /uploads owned by `skin:<id>` (so backups carry them and the storage line counts them), one owner row per file with the slot in
 *    `ownerInstance` (`skin:<id>:<slot>`): a file belongs to ONE slot of ONE skin. At most 8 files and 4 MB a skin. A replaced or abandoned file is deleted.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { UPLOADS_DIR } from "../config";
import { prisma } from "../db";
import { removeDerived } from "../imageDerive";
import { audit } from "../permissions";
import { deleteSetting, getSetting, setSetting } from "../settings";
import { UPLOAD_NAME_RE } from "../services/uploads";
import { SKIN_ID_RE } from "./allowlist";
import { SETTING_CUSTOM_PREFIX } from "./constants";
import { checkValue, resolveValues, type Resolved } from "./customizeResolve";
import { newPictureName, processPicture, type PictureError } from "./customizeImage";
import { CUSTOMIZE_LIMITS, type Control, type CustomizeDecl, type ImageControl, type StoredCustom, type UploadedPicture } from "./customizeSpec";
import { invalidateSkinCache } from "./invalidate";
import type { SkinDefinition } from "./types";

export const customKey = (skinId: string): string => `${SETTING_CUSTOM_PREFIX}${skinId}`;
const ownerModule = (skinId: string): string => `skin:${skinId}`;
const ownerSlot = (skinId: string, slot: string): string => `skin:${skinId}:${slot}`;
const ABANDONED_MS = 24 * 3600_000;

/** A stored value read tolerantly: anything that is not the expected shape is "nothing stored". */
export function parseStored(raw: unknown): StoredCustom | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !r.values || typeof r.values !== "object" || Array.isArray(r.values)) return null;
  return { v: 1, ...(typeof r.skinVersion === "string" ? { skinVersion: r.skinVersion.slice(0, 40) } : {}), ...(typeof r.look === "string" || r.look === null ? { look: r.look } : {}), values: r.values as Record<string, unknown> };
}

export async function readStored(skinId: string): Promise<StoredCustom | null> {
  if (!SKIN_ID_RE.test(skinId)) return null;
  return parseStored(await getSetting(customKey(skinId)));
}

/** Does this upload exist on disk? (A restored backup may lack it: the skin's own picture shows instead.) */
export const uploadExists = (name: string): boolean => UPLOAD_NAME_RE.test(name) && existsSync(path.join(UPLOADS_DIR, name));

/** The effective customization of a skin, for rendering: null when the skin declares none. */
export async function loadResolved(skin: Pick<SkinDefinition, "id" | "version" | "customize">): Promise<{ resolved: Resolved; stored: StoredCustom | null } | null> {
  if (!skin.customize) return null;
  const stored = await readStored(skin.id);
  return { resolved: resolveValues(skin.customize, stored, { skinId: skin.id, version: skin.version, fileExists: uploadExists }), stored };
}

type Declared = { id: string; version: string; customize: CustomizeDecl };
const controlsOf = (d: CustomizeDecl): Control[] => d.groups.flatMap((g) => g.controls);
const namesIn = (values: Record<string, unknown>): string[] => Object.values(values).flatMap((v) => (v && typeof v === "object" && !Array.isArray(v) ? [(v as UploadedPicture).upload, (v as UploadedPicture).still].filter((n): n is string => typeof n === "string") : []));

async function destroy(name: string): Promise<void> {
  try { await fs.rm(path.join(UPLOADS_DIR, name), { force: true }); } catch { /* the registry row goes anyway: nothing else points at it */ }
  await removeDerived(name);
  await prisma.uploadFile.deleteMany({ where: { name } });
}

/** Deletes the pictures of this skin that nothing refers to (`keep`), optionally only the old ones. */
export async function pruneUnreferenced(skinId: string, keep: ReadonlySet<string>, olderThanMs = 0): Promise<number> {
  const rows = await prisma.uploadFile.findMany({ where: { ownerModule: ownerModule(skinId) }, select: { name: true, createdAt: true, claimedAt: true } });
  let n = 0;
  for (const r of rows) {
    // `claimedAt`: when the owner stopped using the file (empty while it is staged or in use); the day counts from the later of that and its creation
    const since = Math.max(r.createdAt.getTime(), r.claimedAt?.getTime() ?? 0);
    if (keep.has(r.name) || (olderThanMs > 0 && Date.now() - since < olderThanMs)) continue;
    await destroy(r.name);
    n++;
  }
  return n;
}

export async function pictureUsage(skinId: string): Promise<{ files: number; bytes: number }> {
  const sum = await prisma.uploadFile.aggregate({ where: { ownerModule: ownerModule(skinId) }, _sum: { bytes: true }, _count: { _all: true } });
  return { files: sum._count._all, bytes: sum._sum.bytes ?? 0 };
}

export type SaveInput = { look?: string | null; values: Record<string, unknown> };
export type SaveResult =
  | { ok: true; changed: boolean; stored: StoredCustom | null }
  | { ok: false; errors: Record<string, "invalid" | "picture">; error?: "too-big" };

/**
 * Saves the customization of one skin: the FULL set of values the owner wants (a control left out is back at the skin's own). Every value is checked; a picture must be a
 * file of this skin and this slot. Only differences from the defaults are stored. A picture no longer used is deleted a day later (the staged window), not at once.
 */
export async function saveCustom(skin: Declared, input: SaveInput, opts: { actor?: string } = {}): Promise<SaveResult> {
  const errors: Record<string, "invalid" | "picture"> = {};
  const values: Record<string, unknown> = {};
  const controls = controlsOf(skin.customize);
  const known = new Map(controls.map((c) => [c.id, c]));
  for (const [id, raw] of Object.entries(input.values ?? {})) {
    const ctl = known.get(id);
    if (!ctl) continue;   // unknown ids are not stored (a look or an older page may send them)
    const r = checkValue(ctl, raw, { allowUpload: true });
    if (!r.ok) { errors[id] = "invalid"; continue; }
    if (JSON.stringify(r.value) === JSON.stringify(ctl.default)) continue;
    values[id] = r.value;
  }
  // a picture is a file of THIS skin and THIS slot (an upload of another slot or skin is refused)
  const relabel: { names: string[]; slot: string }[] = [];
  for (const [id, v] of Object.entries(values)) {
    if (!v || typeof v !== "object") continue;
    const pic = v as UploadedPicture;
    const rows = await prisma.uploadFile.findMany({ where: { name: { in: [pic.upload, ...(pic.still ? [pic.still] : [])] } }, select: { name: true, ownerModule: true, ownerInstance: true } });
    const need = pic.still ? 2 : 1;
    // the slot's own id, or one it had before a rename (`was`): the picture is then moved to the new id below
    const slots = new Set([ownerSlot(skin.id, id), ...(known.get(id)?.was ?? []).map((w) => ownerSlot(skin.id, w))]);
    if (rows.length !== need || rows.some((r) => r.ownerModule !== ownerModule(skin.id) || !r.ownerInstance || !slots.has(r.ownerInstance))) errors[id] = "picture";
    else relabel.push({ names: rows.map((r) => r.name), slot: ownerSlot(skin.id, id) });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const look = typeof input.look === "string" && skin.customize.looks.some((l) => l.id === input.look) ? input.look : null;
  const empty = Object.keys(values).length === 0 && !look;
  const next: StoredCustom | null = empty ? null : { v: 1, skinVersion: skin.version, ...(look ? { look } : {}), values };
  if (next && JSON.stringify(next).length > CUSTOMIZE_LIMITS.storedBytes) return { ok: false, errors: {}, error: "too-big" };
  const before = await readStored(skin.id);
  for (const r of relabel) await prisma.uploadFile.updateMany({ where: { name: { in: r.names }, ownerModule: ownerModule(skin.id) }, data: { ownerInstance: r.slot } });
  const changed = JSON.stringify(before ? { look: before.look ?? null, values: before.values } : null) !== JSON.stringify(next ? { look: next.look ?? null, values: next.values } : null);
  if (next) await setSetting(customKey(skin.id), next); else await deleteSetting(customKey(skin.id));
  // A picture the owner stops using is KEPT for the staged window (one day) before it is deleted: a mistaken reset or choice is not final at once.
  const kept = new Set(namesIn(values));
  const dropped = namesIn(before?.values ?? {}).filter((n) => !kept.has(n));
  if (dropped.length) await prisma.uploadFile.updateMany({ where: { name: { in: dropped }, ownerModule: ownerModule(skin.id) }, data: { claimedAt: new Date() } });
  await pruneUnreferenced(skin.id, kept, ABANDONED_MS);
  if (changed) { invalidateSkinCache(); await audit(opts.actor ?? "system", "skin.custom", `${skin.id}: ${Object.keys(values).join(",")}`.slice(0, 190)); }
  return { ok: true, changed, stored: next };
}

/** Back to the skin's own: everything, or some controls. The pictures that are no longer used are deleted a day later. */
export async function resetCustom(skin: Declared, which: "all" | string[], opts: { actor?: string } = {}): Promise<SaveResult> {
  const cur = await readStored(skin.id);
  if (which === "all") return saveCustom(skin, { values: {} }, opts);
  const values = { ...(cur?.values ?? {}) };
  for (const id of which) delete values[id];
  return saveCustom(skin, { values, look: null }, opts);
}

/** Erases everything of a skin: the setting and every picture (used when the owner removes a skin and asks to delete its pictures too). */
export async function eraseCustom(skinId: string, opts: { actor?: string } = {}): Promise<{ pictures: number }> {
  if (!SKIN_ID_RE.test(skinId)) return { pictures: 0 };
  await deleteSetting(customKey(skinId));
  const pictures = await pruneUnreferenced(skinId, new Set());
  invalidateSkinCache();
  await audit(opts.actor ?? "system", "skin.custom", `${skinId}: erased`);
  return { pictures };
}

export type StoreResult = { ok: true; value: UploadedPicture; url: string; stillUrl?: string } | { ok: false; code: PictureError["code"] | "slot" | "quota"; detail?: Record<string, number | string> };

/**
 * An upload for an image slot of a skin: checked, re-encoded by the core, written under a random name and registered as owned by this skin and slot. It becomes part of
 * the customization only when the owner saves (until then it is a staged file: the abandoned ones are deleted after a day). The previous file of the slot stays until then.
 */
export async function storePicture(skin: Declared, slotId: string, buf: Buffer, opts: { uploaderId: string; focal?: { x: number; y: number } }): Promise<StoreResult> {
  const slot = controlsOf(skin.customize).find((c): c is ImageControl => c.type === "image" && c.id === slotId);
  if (!slot?.upload) return { ok: false, code: "slot" };
  const made = await processPicture(buf, slot.upload, { focal: opts.focal });
  if (!made.ok) return { ok: false, code: made.code, detail: made.detail };
  // quota: this slot's files are about to be replaced, so only the other slots count
  const keep = await readStored(skin.id);
  await pruneUnreferenced(skin.id, new Set(namesIn(keep?.values ?? {})), ABANDONED_MS);
  const rows = await prisma.uploadFile.findMany({ where: { ownerModule: ownerModule(skin.id), NOT: { ownerInstance: ownerSlot(skin.id, slotId) } }, select: { bytes: true } });
  const incoming = made.main.length + (made.still?.length ?? 0);
  if (rows.length + (made.still ? 2 : 1) > CUSTOMIZE_LIMITS.uploadFiles || rows.reduce((t, r) => t + r.bytes, 0) + incoming > CUSTOMIZE_LIMITS.uploadBytes) return { ok: false, code: "quota" };
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  // earlier staged files of this slot that are not the saved one are replaced by this one
  const saved = new Set(namesIn(keep?.values ?? {}));
  const staged = await prisma.uploadFile.findMany({ where: { ownerInstance: ownerSlot(skin.id, slotId) }, select: { name: true } });
  for (const r of staged) if (!saved.has(r.name)) await destroy(r.name);
  const put = async (data: Buffer, ext: "webp" | "png" | "svg"): Promise<string> => {
    const name = newPictureName(ext);
    await fs.writeFile(path.join(UPLOADS_DIR, name), data);
    await prisma.uploadFile.create({ data: { name, uploaderId: opts.uploaderId, bytes: data.length, ownerModule: ownerModule(skin.id), ownerInstance: ownerSlot(skin.id, slotId) } });   // claimedAt stays empty: it is set when the owner stops using the file
    return name;
  };
  const main = await put(made.main, made.ext);
  const still = made.still ? await put(made.still, "webp") : undefined;
  const value: UploadedPicture = { upload: main, ...(still ? { still } : {}), ...(made.lum ? { lum: made.lum } : {}) };
  return { ok: true, value, url: `/uploads/${main}`, ...(still ? { stillUrl: `/uploads/${still}` } : {}) };
}
