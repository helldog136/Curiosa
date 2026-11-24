/**
 * PERSONAL CATALOGUES (core 0.47.0): the owner registers a git repository (public or PRIVATE) that is itself a module catalogue, with the layout of the official one
 * (curiosa-extras): `catalogue/index.json` listing modules that live in that same repository, each pinned on a release tag. Its modules are merged into the catalogue of THIS
 * site, next to the official ones, flagged with where they come from. Nothing else changes: they are installed, updated and removed by the same functions as every
 * catalogue module (`installFromCatalogue`, `updateModule`, `uninstallModule`), with the same checks (manifest schema, minimal core, size, symbolic links refused, load check in a
 * fresh process, services, data migrations, rollback) and the same permission review (the fiche of the extension, read WITHOUT installing).
 *
 * Rules that never bend:
 *   - they count as UNVERIFIED (`origin: "extra"`, like the extra index of `MODULES_INDEX_URL`): never installed or updated by a cascade, a suggestion, a scheduled task, "update
 *     all" or the AI assistant (MCP); only the owner, on a click, after the sentence that says the code runs on the server. See `isExtra` (dependencyPlan.ts) and `installFromCatalogue`;
 *   - the ORIGIN is written on the installed module itself (setting `modules.personal`, by module id) when it is installed from a personal catalogue. It stays after the
 *     catalogue is removed ("source removed"), so removing the catalogue never turns the module into one an assistant may update. Reading that list is FAIL-CLOSED: if it cannot
 *     be read, every module is treated as personal;
 *   - the access code of a private repository is the one of private skins (gitAccess.ts: sealed, one per repository, handed to git through the environment of the child only).
 *     A catalogue lists ONLY modules of its own repository (one repository = one code = one decision of trust). A code the owner has just pasted is used from memory to check
 *     the repository and is saved only when the catalogue is really added;
 *   - an id the official catalogue has is refused (the official one wins), and so is an id already offered by a personal catalogue registered before; an entry with no pinned
 *     reference is refused (a personal module is always installed from a tag or a commit someone chose);
 *   - the core NEVER checks a licence for these modules and makes no request about it. The only network traffic here is git towards the registered address;
 *   - removing a catalogue never uninstalls anything.
 */
import crypto from "node:crypto";
import { prisma } from "../db";
import { accessState, accessTarget, failureOf, isGitAccessError, type AccessState } from "../gitAccess";
import { removeAccessCode, saveAccessCode } from "../gitAccessAdmin";
import { getSetting, setSetting } from "../settings";
import { readRows as readSkinRows } from "../skins/registry";
import { incompatWithThisCore } from "./compat";
import { git, gitWithCode, parseRepoUrl, sameRepo } from "./installer";
import { fetchCatalogueFromRepo, sanitizeEntries, clearRecognizedCache, type RecognizedItem } from "./recognized";
import { listSources } from "./sources";

export type PersonalCatalogue = { id: string; /** The friendly name shown on the pill and in the filters. */ name: string; /** Address of the repository (https). */ url: string; /** A branch or a tag to read the index from (the default branch otherwise). */ ref?: string };

const KEY = "modules.catalogues";
const MARKS_KEY = "modules.personal";
export const MAX_CATALOGUES = 5;
/** Personal entries never displace official ones: each source has its own cap. */
export const MAX_PERSONAL_ITEMS = 150;
const NAME_MAX = 40;
/** A read that takes longer than this is a failure: one slow private repository must never hold the whole catalogue back. */
const READ_MS = 8_000;
/** The official catalogue waits at most this long for the personal ones. */
export const PERSONAL_BUDGET_MS = 6_000;

const G = globalThis as Record<symbol, unknown>;

/* ───────────── One writer at a time ───────────── */

const LOCK = Symbol.for("curiosa.personalCatalogues.lock");
/** Read-modify-write of the settings of this file: one at a time, on the same chain whatever bundle asks (pages and actions may be separate bundles). */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = (G[LOCK] as Promise<void> | undefined) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  G[LOCK] = prev.then(() => mine);
  await prev;
  try { return await fn(); } finally { release(); }
}

/** At most 3 repository reads at the same time (each is a download): the others wait their turn. */
const GATE = Symbol.for("curiosa.personalCatalogues.gate");
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  const g = (G[GATE] ??= { busy: 0, queue: [] as (() => void)[] }) as { busy: number; queue: (() => void)[] };
  if (g.busy >= 3) await new Promise<void>((resolve) => g.queue.push(resolve)); else g.busy++;
  try { return await fn(); } finally { const next = g.queue.shift(); if (next) next(); else g.busy--; }
}

/* ───────────── The list the owner keeps ───────────── */

/** What is kept in the setting: the id is derived from the address, never stored. */
const stored = (c: PersonalCatalogue) => ({ name: c.name, url: c.url, ...(c.ref ? { ref: c.ref } : {}) });
const cleanName = (v: unknown): string => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const addressOfCatalogue = (c: Pick<PersonalCatalogue, "url" | "ref">): string => (c.ref ? `${c.url}#${c.ref}` : c.url);

/** One spelling per repository: no `.git`, no final slash. */
const plainUrl = (url: string): string => url.replace(/\/+$/, "").replace(/\.git$/, "");

/** `owner/name` of the address, or the address without its scheme: what the table shows under the friendly name. */
export const catalogueLabel = (url: string): string => accessTarget(url)?.repo ?? url.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "");

/** The id of a catalogue: a hash of the normalised host, owner and repository (two different repositories can never share one, whatever their names look like). */
export function idOf(url: string): string {
  const t = accessTarget(url);
  const norm = t ? `${t.host}/${t.repo}` : plainUrl(url).replace(/^[a-z]+:\/\//i, "").toLowerCase();
  return `c-${crypto.createHash("sha256").update(norm).digest("hex").slice(0, 12)}`;
}

export async function listCatalogues(): Promise<PersonalCatalogue[]> {
  const raw = await getSetting<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PersonalCatalogue[] = [];
  for (const c of raw) {
    const p = typeof c?.url === "string" ? parseRepoUrl(c.ref ? `${c.url}#${c.ref}` : c.url) : null;
    if (!p?.ok || p.repo.subdir) continue;
    const url = plainUrl(p.repo.url);
    const id = idOf(url);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: cleanName(c.name) || catalogueLabel(url).split("/").pop()!, url, ...(p.repo.ref ? { ref: p.repo.ref } : {}) });
  }
  return out.slice(0, MAX_CATALOGUES);
}

/* ───────────── The origin written on each installed module ───────────── */

type Mark = { catalogue: string; name: string };
type Marks = Record<string, Mark>;

async function readMarks(): Promise<Marks> {
  const raw = await getSetting<unknown>(MARKS_KEY);
  const out: Marks = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
      const mm = m as Partial<Mark> | null;
      if (/^[a-z][a-z0-9-]{1,39}$/.test(id) && mm && typeof mm.catalogue === "string") out[id] = { catalogue: mm.catalogue.slice(0, 40), name: cleanName(mm.name) };
    }
  }
  return out;
}

/** Writes "this module comes from a personal catalogue" on the module (by id). Stays when the catalogue is removed. */
export async function markPersonal(moduleId: string, from: { id: string; name: string }): Promise<void> {
  await withLock(async () => { const marks = await readMarks(); marks[moduleId] = { catalogue: from.id, name: cleanName(from.name) }; await setSetting(MARKS_KEY, marks); });
}

export async function unmarkPersonal(moduleId: string): Promise<void> {
  await withLock(async () => { const marks = await readMarks(); if (!(moduleId in marks)) return; delete marks[moduleId]; await setSetting(MARKS_KEY, marks); });
}

/** The marks of all modules (for the backup): null when they cannot be read. */
export async function personalMarks(): Promise<Marks | null> {
  try { return await readMarks(); } catch { return null; }
}

/** Does this repository address belong to a personal catalogue? */
export const fromPersonal = (repoUrl: string | null | undefined, catalogues: readonly Pick<PersonalCatalogue, "url">[]): boolean => !!repoUrl && catalogues.some((c) => sameRepo(repoUrl, c.url));

export type PersonalIndex = { has(row: { id: string; repoUrl?: string | null }): boolean };

/**
 * Which installed modules are personal: the ones marked at install, plus any whose repository is a registered catalogue (modules installed before the mark existed).
 * FAIL-CLOSED: null when the marks or the list cannot be read. Every caller must then treat EVERY module as personal (refuse), never as official.
 */
export async function personalIndex(): Promise<PersonalIndex | null> {
  try {
    const [marks, list] = [await readMarks(), await listCatalogues()];
    return { has: (row) => row.id in marks || fromPersonal(row.repoUrl, list) };
  } catch { return null; }
}

/** Of these ids, the ones "Update all" may touch: never a personal module, and none at all if the origin cannot be told (fail-closed). */
export async function withoutPersonal(ids: string[]): Promise<string[]> {
  const index = await personalIndex();
  if (!index) return [];
  const rows = new Map((await prisma.module.findMany({ select: { id: true, repoUrl: true } })).map((r) => [r.id, r]));
  return ids.filter((id) => !index.has(rows.get(id) ?? { id }));
}

/* ───────────── What a read found ───────────── */

/** Why an entry of an index is not offered. `elsewhere`: it points to another repository. `clash`: the official catalogue has this id. `duplicate`: a catalogue registered before offers it. `unpinned`: no tag or commit to install from. */
export type RefusalReason = "elsewhere" | "clash" | "duplicate" | "unpinned";
export type Refusal = { id: string; reason: RefusalReason; /** The name of the catalogue that already offers it (`duplicate`). */ by?: string };
export type Offer = { id: string; name: string; version?: string; icon?: string; /** Set when this site runs an older core than the one the index asks for: the extension is listed but cannot be installed here. */ needsCore?: string };
export type ReadReport = { offered: RecognizedItem[]; refused: Refusal[] };
/** `index`: no readable `catalogue/index.json`. `access`: the repository refuses the reading (no code, wrong or expired code, or no such repository). */
export type ReadFailure = "access" | "unreachable" | "tooOld" | "index" | "unknown";

type Known = { official: ReadonlySet<string>; taken: ReadonlyMap<string, { id: string; name: string }> };

function failureOfRead(error: unknown): ReadFailure {
  if (isGitAccessError(error)) return "access";
  if (error instanceof SyntaxError || (error as Error)?.message === "too-large") return "index";
  const kind = failureOf(error).kind;
  if (kind === "unreachable" || kind === "tooOld") return kind;
  if (kind === "notFound" || kind === "rejected" || kind === "redirect") return "access";
  const text = String((error as { stderr?: unknown })?.stderr ?? "");
  return /index\.json|does not exist|exists on disk|not a valid object|invalid object name/i.test(text) ? "index" : "unknown";
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { failure: { kind: "unreachable" } })), ms); })]); } finally { clearTimeout(timer); }
}

type RawRead = { ok: true; entries: RecognizedItem[] } | { ok: false; failure: ReadFailure };

/**
 * Downloads `catalogue/index.json` of the repository (shallow, nothing written in the installation) through git, so a saved access code is used by git alone; `code` is a
 * code the owner has just pasted and is used from memory only. The entries are revalidated by the same function as the official index (`sanitizeEntries`).
 */
async function readRaw(c: Pick<PersonalCatalogue, "url" | "ref">, code?: string): Promise<RawRead> {
  const run = (args: string[], cwd?: string) => (code ? gitWithCode(args, cwd, READ_MS, { url: c.url, code }) : git(args, cwd, undefined, READ_MS));
  try {
    const got = await gated(() => withTimeout(fetchCatalogueFromRepo(c.url, c.ref ?? "HEAD", run), READ_MS + 2_000));
    return { ok: true, entries: sanitizeEntries(got.index) };
  } catch (error) { return { ok: false, failure: failureOfRead(error) }; }
}

/** What a catalogue offers once the refusals are applied (the same rules for a check and for the merge into the site catalogue). */
function sift(c: Pick<PersonalCatalogue, "id" | "url">, entries: RecognizedItem[], known: Known): ReadReport {
  const offered: RecognizedItem[] = [];
  const refused: Refusal[] = [];
  const claimed = new Set<string>();
  for (const e of entries) {
    const other = known.taken.get(e.id);
    if (!sameRepo(e.repo, c.url)) refused.push({ id: e.id, reason: "elsewhere" });
    else if (known.official.has(e.id)) refused.push({ id: e.id, reason: "clash" });
    else if (other && other.id !== c.id) refused.push({ id: e.id, reason: "duplicate", by: other.name });
    else if (!e.ref) refused.push({ id: e.id, reason: "unpinned" });
    else if (!claimed.has(e.id)) { claimed.add(e.id); offered.push(e); }
  }
  return { offered, refused };
}

/* ───────────── State of each catalogue (what the table says) ───────────── */

/** "configured": the last read worked. "degraded": it did not (the reason is in `failure`). "access": the repository refuses the reading, or a saved code cannot be read (restored backup). "unknown": not read since the start. */
export type CatalogueStatus = { state: "configured" | "degraded" | "access" | "unknown"; at: number | null; failure?: ReadFailure; offered: number; refused: Refusal[] };
const STATE_KEY = Symbol.for("curiosa.personalCatalogues.state");
const states = (): Map<string, CatalogueStatus> => (G[STATE_KEY] ??= new Map<string, CatalogueStatus>()) as Map<string, CatalogueStatus>;
export const statusOf = (id: string): CatalogueStatus => states().get(id) ?? { state: "unknown", at: null, offered: 0, refused: [] };

/* ───────────── The merge into the site catalogue ───────────── */

export type PersonalReads = Promise<{ c: PersonalCatalogue; read: RawRead }[]>;

/** Starts reading every registered catalogue now, in parallel (the reader of the official index starts its own at the same time). Never rejects. */
export function startPersonalReads(): PersonalReads {
  return listCatalogues().catch((): PersonalCatalogue[] => []).then((list) => Promise.all(list.map(async (c) => ({ c, read: await readRaw(c) }))));
}

/**
 * The entries of the personal catalogues, flagged with their catalogue, once the official ids are known. Official ids always win. Never throws.
 * `failed` tells the caller that a catalogue could not be read, so the site catalogue is read again soon instead of in 15 minutes.
 */
export async function mergePersonal(reads: Awaited<PersonalReads>, official: ReadonlySet<string>): Promise<{ items: RecognizedItem[]; failed: boolean }> {
  const taken = new Map<string, { id: string; name: string }>();
  const items: RecognizedItem[] = [];
  let failed = false;
  // The first registered catalogue wins an id: the pass is in registration order, and the later one is told which one has it.
  for (const { c, read } of reads) {
    if (!read.ok) { failed = true; states().set(c.id, { state: read.failure === "access" ? "access" : "degraded", at: Date.now(), failure: read.failure, offered: 0, refused: [] }); continue; }
    const { offered, refused } = sift(c, read.entries, { official, taken });
    const mine: RecognizedItem[] = [];
    for (const e of offered) {
      const other = taken.get(e.id);
      if (other) refused.push({ id: e.id, reason: "duplicate", by: other.name });
      else { taken.set(e.id, { id: c.id, name: c.name }); mine.push({ ...e, catalogueOrigin: "extra", catalogueSource: { id: c.id, name: c.name } }); }
    }
    states().set(c.id, { state: "configured", at: Date.now(), offered: mine.length, refused });
    items.push(...mine);
  }
  return { items: items.slice(0, MAX_PERSONAL_ITEMS), failed };
}

/* ───────────── Check, add, remove ───────────── */

export type Checked = { ok: true; address: string; ref?: string; id: string; name: string; offers: Offer[]; installable: number; refused: Refusal[]; access: AccessState; alreadyAdded: boolean }
  | { ok: false; error: string; failure?: ReadFailure; needsCode?: boolean };

const offerOf = (e: RecognizedItem): Offer => ({ id: e.id, name: e.name, ...(e.version ? { version: e.version } : {}), ...(e.icon ? { icon: e.icon } : {}), ...(incompatWithThisCore(e.requires)?.needs ? { needsCore: incompatWithThisCore(e.requires)!.needs } : {}) });

/**
 * Looks at an address WITHOUT registering it and WITHOUT saving anything: how many modules it offers, which are refused and why. A code pasted by the owner (`code`) is used from
 * memory for this reading only; a saved code is used by git alone.
 */
export async function checkCatalogue(input: string, code?: string): Promise<Checked> {
  const parsed = parseRepoUrl(String(input).slice(0, 400));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.repo.subdir) return { ok: false, error: "personal.error.subdir" };
  const url = plainUrl(parsed.repo.url);
  const list = await listCatalogues();
  const id = idOf(url);
  const taken = new Map<string, { id: string; name: string }>();
  const { getRecognizedDetailed } = await import("./recognized");
  const all = (await getRecognizedDetailed().catch(() => ({ items: [] as RecognizedItem[] }))).items;
  for (const e of all) if (e.catalogueSource && e.catalogueSource.id !== id) taken.set(e.id, e.catalogueSource);
  const official = new Set(all.filter((e) => !e.catalogueSource).map((e) => e.id));
  const read = await readRaw({ url, ref: parsed.repo.ref }, code?.trim() || undefined);
  const access = await accessState(url);
  if (!read.ok) return { ok: false, error: read.failure === "access" ? "personal.error.access" : read.failure === "index" ? "personal.error.index" : read.failure === "unreachable" ? "access.error.unreachable" : read.failure === "tooOld" ? "access.error.tooOld" : "personal.error.read", failure: read.failure, needsCode: read.failure === "access" && !!accessTarget(url) };
  const report = sift({ id, url }, read.entries, { official, taken });
  const offers = report.offered.map(offerOf);
  return { ok: true, address: addressOfCatalogue({ url, ref: parsed.repo.ref }), ...(parsed.repo.ref ? { ref: parsed.repo.ref } : {}), id, name: catalogueLabel(url).split("/").pop()!, offers, installable: offers.filter((o) => !o.needsCore).length, refused: report.refused, access, alreadyAdded: list.some((c) => c.id === id) };
}

export type AddResult = { ok: true; catalogue: PersonalCatalogue; offered: number } | { ok: false; error: string };

/**
 * Registers a catalogue. It must be readable and offer at least one module of its own. The code the owner pasted (`code`) is checked from memory first and SAVED ONLY NOW,
 * when the catalogue is valid; if the registration then fails, a code saved by this call and used by nothing else is removed again. The read-modify-write of the list is
 * one at a time, and the limit is checked inside it.
 */
export async function addCatalogue(input: string, name: string, actor: string, code?: string): Promise<AddResult> {
  const checked = await checkCatalogue(input, code);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (checked.alreadyAdded) return { ok: false, error: "personal.error.exists" };
  if (checked.offers.length === 0) return { ok: false, error: "personal.error.empty" };
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const url = plainUrl(parsed.repo.url);
  const catalogue: PersonalCatalogue = { id: checked.id, name: cleanName(name) || checked.name, url, ...(parsed.repo.ref ? { ref: parsed.repo.ref } : {}) };
  let savedHere = false;
  if (code?.trim()) {
    const saved = await saveAccessCode(url, code, actor);
    if (!saved.ok) return { ok: false, error: `access.error.${saved.error}` };
    savedHere = true;
  }
  const result = await withLock(async (): Promise<AddResult> => {
    const list = await listCatalogues();
    if (list.some((c) => c.id === catalogue.id)) return { ok: false, error: "personal.error.exists" };
    if (list.length >= MAX_CATALOGUES) return { ok: false, error: "personal.error.max" };
    await setSetting(KEY, [...list, catalogue].map(stored));
    return { ok: true, catalogue, offered: checked.offers.length };
  });
  if (!result.ok) {
    if (savedHere && !(await repoStillUsed(url, catalogue.id))) await removeAccessCode(url, actor).catch(() => {});
    return result;
  }
  clearRecognizedCache();
  states().set(catalogue.id, { state: "configured", at: Date.now(), offered: checked.offers.length, refused: checked.refused });
  return result;
}

export async function renameCatalogue(id: string, name: string): Promise<boolean> {
  const next = cleanName(name);
  if (!next) return false;
  const done = await withLock(async () => {
    const list = await listCatalogues();
    if (!list.some((c) => c.id === id)) return false;
    await setSetting(KEY, list.map((c) => (c.id === id ? { ...c, name: next } : c)).map(stored));
    return true;
  });
  if (done) clearRecognizedCache();
  return done;
}

/** The installed modules that come from this repository (they keep running when the catalogue is removed). */
export async function installedFrom(c: Pick<PersonalCatalogue, "url">): Promise<string[]> {
  return (await prisma.module.findMany({ where: { source: "git" }, select: { id: true, repoUrl: true } })).filter((m) => sameRepo(m.repoUrl, c.url)).map((m) => m.id).sort();
}

/** Is this repository still used by a module, a skin, a list of module repositories or another catalogue? Then its access code stays. */
async function repoStillUsed(url: string, exceptCatalogue: string): Promise<boolean> {
  const target = accessTarget(url);
  if (!target) return true;
  const same = (other: string | null | undefined) => accessTarget(other)?.repo === target.repo && accessTarget(other)?.host === target.host;
  if ((await prisma.module.findMany({ where: { source: "git" }, select: { repoUrl: true } })).some((r) => same(r.repoUrl))) return true;
  if ((await listCatalogues()).some((c) => c.id !== exceptCatalogue && same(c.url))) return true;
  if ((await listSources().catch(() => [])).some((s) => same(s.url))) return true;
  return (await readSkinRows().catch(() => [])).some((r) => same(r.repo));
}

/**
 * Takes the catalogue off the list. NOTHING is uninstalled: modules already installed from it keep running, with their data, and STAY personal ("source removed": the
 * mark is written on each of them first, so an assistant still cannot update them). The access code of its repository goes too when nothing else on the site uses that
 * repository (the installed modules count: their updates need it).
 */
export async function removeCatalogue(id: string, actor: string): Promise<{ ok: boolean; keptModules: string[]; accessRemoved: boolean }> {
  const c = (await listCatalogues()).find((x) => x.id === id);
  if (!c) return { ok: false, keptModules: [], accessRemoved: false };
  const kept = await installedFrom(c);
  for (const moduleId of kept) await markPersonal(moduleId, c);
  const removed = await withLock(async () => {
    const list = await listCatalogues();
    if (!list.some((x) => x.id === id)) return false;
    await setSetting(KEY, list.filter((x) => x.id !== id).map(stored));
    return true;
  });
  if (!removed) return { ok: false, keptModules: [], accessRemoved: false };
  states().delete(id);
  clearRecognizedCache();
  let accessRemoved = false;
  if (!(await repoStillUsed(c.url, id)) && (await accessState(c.url)).state !== "none") accessRemoved = (await removeAccessCode(c.url, actor)).ok;
  return { ok: true, keptModules: kept, accessRemoved };
}

/** Reads every catalogue again now (the "Refresh" button): the memory of the index is dropped, the next read goes to git. */
export function refreshCatalogues(): void { clearRecognizedCache(); }

/**
 * What an assistant may see of personal entries: nothing of a PRIVATE repository (one with a saved access code), and nothing at all if that cannot be told. The names of a
 * public repository's extensions are public anyway. Fail-closed.
 */
export async function visibleToAssistant<T extends { personal?: { id: string } }>(entries: T[]): Promise<T[]> {
  if (!entries.some((e) => e.personal)) return entries;
  try {
    const hidden = new Set<string>();
    for (const c of await listCatalogues()) if ((await accessState(c.url)).state !== "none") hidden.add(c.id);
    const known = new Set((await listCatalogues()).map((c) => c.id));
    return entries.filter((e) => !e.personal || (known.has(e.personal.id) && !hidden.has(e.personal.id)));
  } catch { return entries.filter((e) => !e.personal); }
}
