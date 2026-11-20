/**
 * SKIN FROM A FILE (core 0.46.1, docs/SKINS.md "From your folder to your site"): the owner drops the .zip of a skin made by hand.
 *
 * Two steps, the same checks as a skin from an address (`validateSkinFolder`), the same rollback, preview, activation and removal:
 *   1. `stageUpload(bytes)`  reads the zip (zip.ts), checks the skin, and puts ONLY the validated skin files at their normal place (`data/skins/<id>/<version>/`)
 *                            with a small note in `data/skins/.staged/<sha256>.json`. No registry row is written: nothing is added yet, the site is unchanged,
 *                            and the preview shows the real site dressed with these files.
 *   2. `addStaged(token)`    re-checks the staged files, writes the registry row (provenance: "uploaded file", SHA-256 and size, never the content), audits.
 * THE ARCHIVE IS NEVER KEPT: its bytes are read in memory and dropped; the only copies on disk are the validated skin files. The staged copy lives
 * `STAGE_TTL_MS` at most and is removed by Add (it becomes the installed copy), by Cancel (`discardStaged`), by a new drop, by any error, and by `sweepStagedFiles`
 * (called when the Appearance page loads and on every new drop).
 *
 * Folder layout of the zip (the least surprising rule): the skin files at the root of the zip, OR all inside ONE folder (any name: Windows and macOS name it after the
 * zip, GitHub after the branch). The skin's name is the `id` in its skin.json, never the folder's name.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SKINS_DIR } from "../config";
import { getCoreVersion } from "../modules/compat";
import { audit } from "../permissions";
import { SKIN_ID_RE } from "./allowlist";
import { makeIssue, type SkinIssue } from "./messages";
import { fail, hooks, placeVersion, refuse, summaryOf, type Failure, type InstallOk, type InspectSummary, type LoadedSkin } from "./service";
import { filesPresent, readRows, serial, skinDir, writeRows, type SkinRow } from "./registry";
import { compareVersions, SEMVER_RE } from "./semver";
import { hasErrors, validateSkinFolder, type SkinValidation } from "./validate";
import { isJunk, readSkinZip } from "./zip";

/** How long a checked skin waits for "Add this skin". */
export const STAGE_TTL_MS = 30 * 60_000;
const STAGED = () => path.join(SKINS_DIR, ".staged");
const SHA_RE = /^[0-9a-f]{64}$/;

type Marker = { sha256: string; bytes: number; id: string; version: string; fingerprint: string; kind: "site" | "overlay"; at: number };

const markerFile = (sha: string) => path.join(STAGED(), `${sha}.json`);
function readMarker(sha: string): Marker | null {
  try {
    if (!SHA_RE.test(sha)) return null;
    const m = JSON.parse(fs.readFileSync(markerFile(sha), "utf8")) as Marker;
    return m && m.sha256 === sha && SKIN_ID_RE.test(m.id) && SEMVER_RE.test(m.version) && typeof m.fingerprint === "string" && typeof m.at === "number" && Number.isFinite(m.at) ? m : null;
  } catch { return null; }
}
function allMarkers(): { file: string; marker: Marker | null }[] {
  let names: string[] = [];
  try { names = fs.readdirSync(STAGED()); } catch { return []; }
  return names.map((n) => ({ file: path.join(STAGED(), n), marker: /^[0-9a-f]{64}\.json$/.test(n) ? readMarker(n.slice(0, 64)) : null }));
}

/** Removes a staged copy: its note, and its files unless a registered skin already uses that version. */
async function removeStage(m: Marker | null, file: string): Promise<void> {
  fs.rmSync(file, { force: true });
  if (!m) return;
  const rows = await readRows();
  const claimed = rows.some((r) => r.id === m.id && (r.version === m.version || r.previous?.version === m.version));
  if (!claimed) {
    fs.rmSync(skinDir(m.id, m.version), { recursive: true, force: true });
    try { fs.rmdirSync(path.join(SKINS_DIR, m.id)); } catch { /* not empty (other versions) or already gone */ }
  }
}

async function sweepInner(now: number, keep?: string): Promise<number> {
  let n = 0;
  for (const { file, marker } of allMarkers()) {
    if (marker && marker.sha256 === keep) continue;
    if (!marker || now - marker.at > STAGE_TTL_MS || keep !== undefined) { await removeStage(marker, file); n++; }
  }
  // leftovers of an interrupted check (a temporary folder of this feature), older than the staging time
  try {
    for (const name of fs.readdirSync(SKINS_DIR)) {
      if (!name.startsWith(".incoming-")) continue;
      const p = path.join(SKINS_DIR, name);
      if (now - fs.statSync(p).mtimeMs > STAGE_TTL_MS) { fs.rmSync(p, { recursive: true, force: true }); n++; }
    }
  } catch { /* no skins folder yet */ }
  return n;
}

/** Removes the staged skins that waited too long (and the leftovers of an interrupted check). Never throws. */
export async function sweepStagedFiles(now = Date.now()): Promise<number> {
  try { return await serial(() => sweepInner(now)); } catch { return 0; }
}

/** Cancel: removes the staged copy (all of them without a token). Never throws. */
export async function discardStaged(token?: string): Promise<void> {
  try {
    await serial(async () => {
      for (const { file, marker } of allMarkers()) if (!token || marker?.sha256 === token || !marker) await removeStage(marker, file);
    });
  } catch { /* nothing more to remove */ }
}

// ---------------------------------------------------------------------------------------------------------------------

/** The skin files out of the zip: at the root, or inside the one folder that holds them. `null` + a code when the layout is not one of the two. */
export function skinFilesOf(files: readonly { path: string; content: Buffer }[]): { files: { path: string; content: Buffer }[] } | { error: "nomanifest" | "layout" } {
  const live = files.filter((f) => !isJunk(f.path));
  if (live.some((f) => f.path === "skin.json")) return { files: live.map((f) => ({ ...f })) };
  const tops = new Set(live.map((f) => f.path.split("/")[0]!));
  if (tops.size === 1 && live.every((f) => f.path.includes("/"))) {
    const top = [...tops][0]!;
    const inner = live.map((f) => ({ path: f.path.slice(top.length + 1), content: f.content }));
    if (inner.some((f) => f.path === "skin.json")) return { files: inner };
  }
  return { error: live.some((f) => f.path === "skin.json" || f.path.endsWith("/skin.json")) ? "layout" : "nomanifest" };
}

export type UploadStage = {
  ok: true;
  /** Names the staged copy (the archive's SHA-256): sent back by "Add this skin", "Cancel" and the preview. */
  token: string;
  id: string; version: string; bytes: number;
  summary: InspectSummary;
  /** Warnings only (a refusal never gets here). */
  issues: SkinIssue[];
  /** The version of the same skin already added from a file, which this one replaces. */
  replaces?: string;
  /** The real-site preview shows site skins only. */
  previewable: boolean;
};

/** The rules shared by the check and the add: what already exists under this name. */
function conflict(rows: readonly SkinRow[], v: SkinValidation): Failure | null {
  const m = v.manifest!;
  const existing = rows.find((r) => r.id === m.id);
  if (!existing) return null;
  if (!existing.upload) return fail("skins.upload.exists", { detail: m.id });
  const claimed = existing.version === m.version || existing.previous?.version === m.version;
  if (claimed || compareVersions(m.version, existing.version) <= 0) return fail("skins.upload.version", { detail: m.id, target: existing.version });
  return null;
}

/** Step 1: reads and checks the zip, puts the validated skin files in place WITHOUT adding the skin. The archive bytes are dropped on return. */
export async function stageUpload(bytes: Buffer, o: { actor: string; now?: number }): Promise<UploadStage | Failure> {
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  return serial(async () => {
    const now = o.now ?? Date.now();
    let tmp: string | null = null;
    try {
      await sweepInner(now, sha);   // a new drop replaces the previous staged skin
      const z = readSkinZip(bytes);
      if (!z.ok) { await audit(o.actor, "skin.refused", `upload sha256:${sha.slice(0, 16)} zip-${z.code}`); return fail(`skins.upload.${z.code}`, { ...(z.file ? { detail: z.file } : {}) }); }
      const laid = skinFilesOf(z.files);
      if ("error" in laid) { await audit(o.actor, "skin.refused", `upload sha256:${sha.slice(0, 16)} ${laid.error}`); return fail(`skins.upload.${laid.error}`); }
      fs.mkdirSync(SKINS_DIR, { recursive: true });
      tmp = fs.mkdtempSync(path.join(SKINS_DIR, ".incoming-"));
      const dir = path.join(tmp, "skin");
      for (const f of laid.files) {
        const dest = path.join(dir, f.path);
        if (!dest.startsWith(dir + path.sep)) return fail("skins.upload.bad-name", { detail: f.path.slice(0, 80) });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content, { flag: "wx" });
      }
      const v = validateSkinFolder(dir, { coreVersion: getCoreVersion(), advice: true });
      if (!v.ok || !v.manifest) return await refuse(v, o.actor);
      const m = v.manifest;
      const rows = await readRows();
      const clash = conflict(rows, v);
      if (clash) return clash;
      const summary = summaryOf(dir, v);
      placeVersion(v);
      fs.mkdirSync(STAGED(), { recursive: true });
      const marker: Marker = { sha256: sha, bytes: bytes.length, id: m.id, version: m.version, fingerprint: v.fingerprint, kind: m.kind === "overlay" ? "overlay" : "site", at: now };
      fs.writeFileSync(markerFile(sha), JSON.stringify(marker));
      const replaces = rows.find((r) => r.id === m.id)?.version;
      return { ok: true, token: sha, id: m.id, version: m.version, bytes: bytes.length, summary, issues: v.issues.filter((i) => i.severity === "warning"), ...(replaces ? { replaces } : {}), previewable: marker.kind === "site" };
    } catch (error) {
      console.error("[skins] upload check failed:", (error as Error)?.message);
      return fail("skins.error.failed");
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

/** Step 2: adds the staged skin. Its files are read again and checked again; a skin that changed since the check, or waited too long, is refused and cleaned. */
export async function addStaged(token: string, o: { actor: string; now?: number }): Promise<InstallOk | Failure> {
  return serial(async () => {
    const now = o.now ?? Date.now();
    const marker = readMarker(String(token));
    const file = SHA_RE.test(String(token)) ? markerFile(String(token)) : "";
    if (!marker) return fail("skins.upload.expired");
    if (now - marker.at > STAGE_TTL_MS) { await removeStage(marker, file); return fail("skins.upload.expired"); }
    try {
      const v = validateSkinFolder(skinDir(marker.id, marker.version), { coreVersion: getCoreVersion(), expectId: marker.id });
      if (!v.ok || !v.manifest || hasErrors(v.issues) || v.fingerprint !== marker.fingerprint || v.manifest.version !== marker.version) { await removeStage(marker, file); return fail("skins.upload.expired"); }
      const m = v.manifest;
      const rows = await readRows();
      const clash = conflict(rows, v);
      if (clash) { await removeStage(marker, file); return clash; }
      const existing = rows.find((r) => r.id === m.id);
      await hooks.beforeSwitch?.();
      const row: SkinRow = {
        id: m.id, version: m.version, repo: "", ref: null, subdir: null, source: "personal", ...(m.kind === "overlay" ? { kind: "overlay" as const } : {}),
        commit: "", tree: null, fingerprint: v.fingerprint, installedAt: new Date(now).toISOString(), upload: { sha256: marker.sha256, bytes: marker.bytes },
        ...(existing ? { previous: { version: existing.version, ref: null, commit: "", tree: null, fingerprint: existing.fingerprint, ...(existing.upload ? { upload: existing.upload } : {}) } } : {}),
      };
      await writeRows([...rows.filter((r) => r.id !== m.id), row].sort((a, b) => (a.id < b.id ? -1 : 1)));
      if (existing?.previous && existing.previous.version !== m.version && existing.previous.version !== existing.version) fs.rmSync(skinDir(m.id, existing.previous.version), { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      await audit(o.actor, "skin.install", `${m.id}@${m.version} uploaded file sha256:${marker.sha256} ${marker.bytes}B`);
      return { ok: true, id: m.id, version: m.version, source: "personal", warnings: v.issues.filter((i) => i.severity === "warning") };
    } catch (error) {
      console.error("[skins] upload add failed:", (error as Error)?.message);
      await removeStage(marker, file).catch(() => undefined);
      return fail("skins.error.failed");
    }
  });
}

/** The id behind a staged copy (for the preview link), or null when it is gone or too old. */
export function stagedId(token: string, now = Date.now()): string | null {
  const m = readMarker(String(token));
  return m && m.kind === "site" && now - m.at <= STAGE_TTL_MS && filesPresent(m.id, m.version) ? m.id : null;
}

/**
 * The staged skin of this name, ready to compose, for the PREVIEW only (never for the site's own skin or a page's skin). Read again from the files and
 * checked against the note, so a changed or expired copy is refused.
 */
export function loadStagedSkin(id: string, opts: { now?: number; moduleParts?: Readonly<Record<string, readonly string[]>> } = {}): LoadedSkin {
  const now = opts.now ?? Date.now();
  const none: LoadedSkin = { ok: false, id, issues: [makeIssue("skin-files-missing")] };
  for (const { marker } of allMarkers()) {
    if (!marker || marker.id !== id || marker.kind !== "site" || now - marker.at > STAGE_TTL_MS || !filesPresent(id, marker.version)) continue;
    const v = validateSkinFolder(skinDir(id, marker.version), { coreVersion: getCoreVersion(), expectId: id, moduleParts: opts.moduleParts, reading: true });
    if (!v.ok || !v.manifest || !v.tokens || v.fingerprint !== marker.fingerprint) return { ok: false, id, issues: v.issues };
    return { ok: true, id, version: marker.version, fingerprint: v.fingerprint, manifest: v.manifest, css: v.css, tokens: v.tokens, assetBase: `/skins/${id}/${marker.version}/` };
  }
  return none;
}

// ---------------------------------------------------------------------------------------------------------------------
const recent = new Map<string, number[]>();
/** At most 12 files per owner per 10 minutes (the check unzips and validates: it is not free). In memory, per process. */
export function uploadRateOk(actor: string, now = Date.now()): boolean {
  const list = (recent.get(actor) ?? []).filter((at) => now - at < 10 * 60_000);
  if (list.length >= 12) { recent.set(actor, list); return false; }
  list.push(now);
  recent.set(actor, list);
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
  return true;
}
