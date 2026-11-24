/**
 * PERSONAL CATALOGUES (core 0.47.0): the owner registers a git repository (public or PRIVATE) that is itself a module catalogue, with the layout of the official one
 * (curiosa-extras): `catalogue/index.json` listing modules that live in that same repository, each pinned on a release tag. Its modules are merged into the catalogue of THIS
 * site, next to the official ones, flagged with where they come from. Nothing else changes: they are installed, updated and removed by the same functions as every
 * catalogue module (`installFromCatalogue`, `updateModule`, `uninstallModule`), with the same checks (manifest schema, minimal core, size, symbolic links refused, load check in a
 * fresh process, services, data migrations, rollback) and the same permission review (the fiche of the extension, read WITHOUT installing).
 *
 * Rules that never bend:
 *   - they count as UNVERIFIED (`origin: "extra"`, like the extra index of `MODULES_INDEX_URL`): never installed or updated by a cascade, a suggestion, a scheduled task or the
 *     AI assistant (MCP); only the owner, on a click, after the sentence that says the code runs on the server. See `isExtra` (dependencyPlan.ts) and `installFromCatalogue`;
 *   - the access code of a private repository is the one of private skins (gitAccess.ts: sealed, one per repository, handed to git through the environment of the child only).
 *     This file never reads it: every git call goes through `git()` (installer.ts), which attaches it. That is why a catalogue lists ONLY modules of its own repository
 *     (one repository = one code = one decision of trust); an entry that points elsewhere is refused with a plain reason;
 *   - an id that the official catalogue already has is refused (the official one wins), and so is an id already offered by a personal catalogue registered before (the first wins);
 *   - the core NEVER checks a licence for these modules and makes no request about it. The only network traffic here is git towards the registered address;
 *   - removing a catalogue never uninstalls anything: its modules keep running, and nothing offers them an update any more.
 */
import { prisma } from "../db";
import { accessState, accessTarget, failureOf, isGitAccessError, type AccessState } from "../gitAccess";
import { removeAccessCode } from "../gitAccessAdmin";
import { getSetting, setSetting } from "../settings";
import { readRows as readSkinRows } from "../skins/registry";
import { incompatWithThisCore } from "./compat";
import { git, parseRepoUrl, sameRepo } from "./installer";
import { fetchCatalogueFromRepo, sanitizeEntries, clearRecognizedCache, type RecognizedItem } from "./recognized";
import { listSources } from "./sources";

export type PersonalCatalogue = { id: string; /** The friendly name shown on the pill and in the filters. */ name: string; /** Address of the repository (https). */ url: string; /** A branch or a tag to read the index from (the default branch otherwise). */ ref?: string };

const KEY = "modules.catalogues";
export const MAX_CATALOGUES = 5;
const NAME_MAX = 40;
/** A read that takes longer than this is a failure: one slow private repository must never hold the whole catalogue back. */
const READ_MS = 25_000;

/* ───────────── The list the owner keeps ───────────── */

/** What is kept in the setting: the id is derived from the address, never stored. */
const stored = (c: PersonalCatalogue) => ({ name: c.name, url: c.url, ...(c.ref ? { ref: c.ref } : {}) });
const cleanName = (v: unknown): string => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const addressOfCatalogue = (c: Pick<PersonalCatalogue, "url" | "ref">): string => (c.ref ? `${c.url}#${c.ref}` : c.url);

/** `owner/name` of the address, or the address without its scheme: what the table shows under the friendly name. */
export const catalogueLabel = (url: string): string => accessTarget(url)?.repo ?? url.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "");

/** One spelling per repository: no `.git`, no final slash. */
const plainUrl = (url: string): string => url.replace(/\/+$/, "").replace(/\.git$/, "");

function idOf(url: string): string {
  const slug = catalogueLabel(url).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "catalogue";
}

export async function listCatalogues(): Promise<PersonalCatalogue[]> {
  const raw = await getSetting<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PersonalCatalogue[] = [];
  for (const c of raw) {
    const p = typeof c?.url === "string" ? parseRepoUrl(c.ref ? `${c.url}#${c.ref}` : c.url) : null;
    if (!p?.ok || p.repo.subdir) continue;
    const id = idOf(p.repo.url);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: cleanName(c.name) || catalogueLabel(p.repo.url).split("/").pop()!, url: plainUrl(p.repo.url), ...(p.repo.ref ? { ref: p.repo.ref } : {}) });
  }
  return out.slice(0, MAX_CATALOGUES);
}

/** Does this repository address belong to a personal catalogue? Such modules are never installed, updated or reinstalled by an assistant. */
export const fromPersonal = (repoUrl: string | null | undefined, catalogues: readonly Pick<PersonalCatalogue, "url">[]): boolean => !!repoUrl && catalogues.some((c) => sameRepo(repoUrl, c.url));

/* ───────────── What a read found ───────────── */

/** Why an entry of an index is not offered. `elsewhere`: it points to another repository. `clash`: the official catalogue has this id. `duplicate`: a catalogue registered before offers it. */
export type RefusalReason = "elsewhere" | "clash" | "duplicate";
export type Refusal = { id: string; reason: RefusalReason; /** The catalogue that already offers it (`duplicate`). */ by?: string };
export type Offer = { id: string; name: string; version?: string; icon?: string; /** Set when this site runs an older core than the one the index asks for: the extension is listed but cannot be installed here. */ needsCore?: string };
export type ReadReport = { offered: RecognizedItem[]; refused: Refusal[] };
/** `index`: no readable `catalogue/index.json`. `access`: the repository refuses the reading (no code, wrong or expired code, or no such repository). */
export type ReadFailure = "access" | "unreachable" | "tooOld" | "index" | "unknown";

type Known = { official: ReadonlySet<string>; taken: ReadonlyMap<string, string> };

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

/**
 * Reads `catalogue/index.json` of the repository (shallow, nothing written in the installation) through `git()`, so a saved access code is used by git alone. The entries are
 * revalidated by the same function as the official index (`sanitizeEntries`: id, https address on an allowed host, pinned reference, services, previews…).
 */
export async function readCatalogue(c: Pick<PersonalCatalogue, "id" | "url" | "ref">, known: Known): Promise<{ ok: true; report: ReadReport } | { ok: false; failure: ReadFailure }> {
  let index: unknown;
  try { index = (await withTimeout(fetchCatalogueFromRepo(c.url, c.ref ?? "HEAD", (args, cwd) => git(args, cwd, undefined, READ_MS)), READ_MS + 2_000)).index; } catch (error) { return { ok: false, failure: failureOfRead(error) }; }
  const offered: RecognizedItem[] = [];
  const refused: Refusal[] = [];
  const claimed = new Set<string>();
  for (const e of sanitizeEntries(index)) {
    if (!sameRepo(e.repo, c.url)) refused.push({ id: e.id, reason: "elsewhere" });
    else if (known.official.has(e.id)) refused.push({ id: e.id, reason: "clash" });
    else if (known.taken.has(e.id) && known.taken.get(e.id) !== c.id) refused.push({ id: e.id, reason: "duplicate", by: known.taken.get(e.id) });
    else if (!claimed.has(e.id)) { claimed.add(e.id); offered.push(e); }
  }
  return { ok: true, report: { offered, refused } };
}

/* ───────────── State of each catalogue (what the table says) ───────────── */

/** "configured": the last read worked. "degraded": it did not (the reason is in `failure`). "access": the repository refuses the reading, or a saved code cannot be read (restored backup). "unknown": not read since the start. */
export type CatalogueStatus = { state: "configured" | "degraded" | "access" | "unknown"; at: number | null; failure?: ReadFailure; offered: number; refused: Refusal[] };
const STATE_KEY = Symbol.for("curiosa.personalCatalogues.state");
const states = (): Map<string, CatalogueStatus> => ((globalThis as Record<symbol, unknown>)[STATE_KEY] ??= new Map<string, CatalogueStatus>()) as Map<string, CatalogueStatus>;
export const statusOf = (id: string): CatalogueStatus => states().get(id) ?? { state: "unknown", at: null, offered: 0, refused: [] };
const record = (id: string, r: Awaited<ReturnType<typeof readCatalogue>>): void => {
  states().set(id, r.ok ? { state: "configured", at: Date.now(), offered: r.report.offered.length, refused: r.report.refused } : { state: r.failure === "access" ? "access" : "degraded", at: Date.now(), failure: r.failure, offered: 0, refused: [] });
};

/** What the catalogue of this site gets from the personal catalogues: each entry flagged with its catalogue. Called by the reader of the index (recognized.ts); never throws. */
export async function personalItems(official: ReadonlySet<string>): Promise<RecognizedItem[]> {
  const list = await listCatalogues();
  if (!list.length) return [];
  const taken = new Map<string, string>();
  const out: RecognizedItem[] = [];
  const reads = await Promise.all(list.map((c) => readCatalogue(c, { official, taken: new Map() }).then((r) => [c, r] as const)));
  // The first registered catalogue wins an id: the pass is in registration order, and the later one is told which one has it.
  for (const [c, r] of reads) {
    if (!r.ok) { record(c.id, r); continue; }
    const offered: RecognizedItem[] = [];
    const refused: Refusal[] = [...r.report.refused];
    for (const e of r.report.offered) {
      if (taken.has(e.id)) refused.push({ id: e.id, reason: "duplicate", by: taken.get(e.id) });
      else { taken.set(e.id, c.id); offered.push({ ...e, catalogueOrigin: "extra", catalogueSource: { id: c.id, name: c.name } }); }
    }
    record(c.id, { ok: true, report: { offered, refused } });
    out.push(...offered);
  }
  return out;
}

/* ───────────── Check, add, remove ───────────── */

export type Checked = { ok: true; address: string; ref?: string; id: string; name: string; offers: Offer[]; installable: number; refused: Refusal[]; access: AccessState; alreadyAdded: boolean }
  | { ok: false; error: string; failure?: ReadFailure; needsCode?: boolean };

const offerOf = (e: RecognizedItem): Offer => ({ id: e.id, name: e.name, ...(e.version ? { version: e.version } : {}), ...(e.icon ? { icon: e.icon } : {}), ...(incompatWithThisCore(e.requires)?.needs ? { needsCore: incompatWithThisCore(e.requires)!.needs } : {}) });

/** Looks at an address WITHOUT registering it: how many modules it offers, which are refused and why. A saved access code is used by git alone. */
export async function checkCatalogue(input: string): Promise<Checked> {
  const parsed = parseRepoUrl(String(input).slice(0, 400));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.repo.subdir) return { ok: false, error: "personal.error.subdir" };
  const url = plainUrl(parsed.repo.url);
  const list = await listCatalogues();
  const id = idOf(url);
  const taken = new Map<string, string>();
  const { getRecognizedDetailed } = await import("./recognized");
  const all = (await getRecognizedDetailed().catch(() => ({ items: [] as RecognizedItem[] }))).items;
  for (const e of all) if (e.catalogueSource && e.catalogueSource.id !== id) taken.set(e.id, e.catalogueSource.id);
  const read = await readCatalogue({ id, url, ref: parsed.repo.ref }, { official: new Set(all.filter((e) => !e.catalogueSource).map((e) => e.id)), taken });
  const access = await accessState(url);
  if (!read.ok) return { ok: false, error: read.failure === "access" ? "personal.error.access" : read.failure === "index" ? "personal.error.index" : read.failure === "unreachable" ? "access.error.unreachable" : read.failure === "tooOld" ? "access.error.tooOld" : "personal.error.read", failure: read.failure, needsCode: read.failure === "access" && !!accessTarget(url) };
  const offers = read.report.offered.map(offerOf);
  return { ok: true, address: addressOfCatalogue({ url, ref: parsed.repo.ref }), ...(parsed.repo.ref ? { ref: parsed.repo.ref } : {}), id, name: catalogueLabel(url).split("/").pop()!, offers, installable: offers.filter((o) => !o.needsCore).length, refused: read.report.refused, access, alreadyAdded: list.some((c) => c.id === id) };
}

export type AddResult = { ok: true; catalogue: PersonalCatalogue; offered: number } | { ok: false; error: string };

/** Registers a catalogue. It must be readable and offer at least one module of its own; the id of the registration is the repository, so the same address twice is one catalogue. */
export async function addCatalogue(input: string, name: string, actor: string): Promise<AddResult> {
  const list = await listCatalogues();
  const checked = await checkCatalogue(input);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (checked.alreadyAdded) return { ok: false, error: "personal.error.exists" };
  if (list.length >= MAX_CATALOGUES) return { ok: false, error: "personal.error.max" };
  if (checked.offers.length === 0) return { ok: false, error: "personal.error.empty" };
  const parsed = parseRepoUrl(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const catalogue: PersonalCatalogue = { id: checked.id, name: cleanName(name) || checked.name, url: plainUrl(parsed.repo.url), ...(parsed.repo.ref ? { ref: parsed.repo.ref } : {}) };
  await setSetting(KEY, [...list, catalogue].map(stored));
  clearRecognizedCache();
  record(catalogue.id, { ok: true, report: { offered: [], refused: checked.refused } });
  states().set(catalogue.id, { state: "configured", at: Date.now(), offered: checked.offers.length, refused: checked.refused });
  void actor;
  return { ok: true, catalogue, offered: checked.offers.length };
}

export async function renameCatalogue(id: string, name: string): Promise<boolean> {
  const list = await listCatalogues();
  const next = cleanName(name);
  if (!next || !list.some((c) => c.id === id)) return false;
  await setSetting(KEY, list.map((c) => (c.id === id ? { ...c, name: next } : c)).map(stored));
  clearRecognizedCache();
  return true;
}

/** How many installed modules come from this repository (they keep running when the catalogue is removed). */
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
 * Takes the catalogue off the list. NOTHING is uninstalled: modules already installed from it keep running, with their data; only the offer of updates stops (the index is no
 * longer read). The access code of its repository goes too when nothing else on the site uses that repository.
 */
export async function removeCatalogue(id: string, actor: string): Promise<{ ok: boolean; keptModules: string[]; accessRemoved: boolean }> {
  const list = await listCatalogues();
  const c = list.find((x) => x.id === id);
  if (!c) return { ok: false, keptModules: [], accessRemoved: false };
  const kept = await installedFrom(c);
  await setSetting(KEY, list.filter((x) => x.id !== id).map(stored));
  states().delete(id);
  clearRecognizedCache();
  let accessRemoved = false;
  if (!(await repoStillUsed(c.url, id)) && (await accessState(c.url)).state !== "none") accessRemoved = (await removeAccessCode(c.url, actor)).ok;
  return { ok: true, keptModules: kept, accessRemoved };
}

/** Reads every catalogue again now (the "Refresh" button): the memory of the index is dropped, the next read goes to git. */
export function refreshCatalogues(): void { clearRecognizedCache(); }
