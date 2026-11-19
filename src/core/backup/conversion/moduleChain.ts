import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/core/config";
import { git, installModule, parseRepoUrl, updateModule, updateModuleToRef, type InstallResult } from "@/core/modules/installer";
import { compareVersions, TAG_RE } from "@/core/updates/versions";
import type { Row } from "./types";

/**
 * THE CHAIN OF A MODULE (docs/BACKUP.md, "Old backups"; docs/MIGRATIONS.md).
 *
 * A module converts its own data (`dataVersion`, `migrations`) and, since the module repository deletes old conversions, declares `dataFloor`: the oldest data it
 * still converts. Data below the floor is set aside by the core. A BACKUP can hold such data, so the restore walks the module through its releases, as a live update
 * through the catalogue would:
 *   1. the data of the backup is at or above the floor of the version the catalogue offers: the current version converts it (the usual case, one step);
 *   2. below the floor: install the release that still converts it (the "bridge": the LATEST release whose own floor is at or below the data), let it convert,
 *      then repeat from the data version it produced, until the current floor accepts it; then the catalogue version.
 * Everything here is best effort and never throws: a step that cannot be done is reported (with where the data is in the unpacked archive), the rest goes on.
 */

export type ModuleChain = {
  /** Version of the data in the backup (the lowest among the instances of the module; 1 when there is none or it is not noted). */
  dataVersion: number;
  /** Floor of the version the restore will install. */
  floor: number;
  /** Releases to go through, oldest first. The first is installed; the others are steps after the data is restored. Empty: straight to the current version. */
  tags: string[];
  /** Why there is no usable chain although the data is below the floor. */
  blocked?: "no-release" | "unreachable" | "too-long";
  repo: string;
  subdir: string | null;
};

type ManifestLite = { dataVersion: number; dataFloor: number; version: string };

/** A shallow, blob-less copy of a module repository, read with `git show` (one clone per repository, shared by the modules of the pass). */
export type RepoReader = {
  tags: () => Promise<string[]>;
  manifestAt: (ref: string, subdir: string | null) => Promise<ManifestLite | null>;
  close: () => void;
};

export async function openRepo(url: string): Promise<RepoReader> {
  const base = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "chain-"));
  await git(["init", "-q", dir]);
  await git(["remote", "add", "origin", url], dir);
  const fetchAll = (filter: boolean) => git(["fetch", "-q", ...(filter ? ["--filter=blob:none"] : []), "--tags", "origin", "+refs/heads/*:refs/remotes/origin/*"], dir, undefined, 180_000);
  await fetchAll(true).catch(() => fetchAll(false));
  return {
    tags: async () => (await git(["tag", "--list"], dir)).split("\n").map((t) => t.trim()).filter((t) => TAG_RE.test(t)).sort(compareVersions),
    manifestAt: async (ref, subdir) => {
      try {
        const raw = await git(["show", `${ref}:${subdir ? `${subdir}/` : ""}module.json`], dir);
        const m = JSON.parse(raw) as Row;
        const dv = Number(m.dataVersion ?? 1);
        const df = Number(m.dataFloor ?? 1);
        return { dataVersion: Number.isInteger(dv) && dv >= 1 ? dv : 1, dataFloor: Number.isInteger(df) && df >= 1 ? df : 1, version: String(m.version ?? "") };
      } catch { return null; }
    },
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** The version of the data of a module in a backup: the lowest `instance.<id>.__dataVersion` of its instances (absent = 1). */
export function dataVersionInBackup(d: { instances: Row[]; settings: Row[] }, moduleId: string): number {
  const versions = d.instances.filter((i) => i.moduleId === moduleId).map((i) => {
    const v = Number(d.settings.find((s) => s.key === `instance.${String(i.id)}.__dataVersion` && !s.locale)?.value);
    return Number.isInteger(v) && v >= 1 ? v : 1;
  });
  return versions.length ? Math.min(...versions) : 1;
}

const MAX_HOPS = 6;

/**
 * The chain of one module. `target`: where the restore installs it from (catalogue pin: `ref` may be a tag or a commit). `upTo`: highest release to consider.
 * Reads only what it needs: the manifest of the pinned version, and, when the data is below its floor, the manifests of the releases from the newest downwards.
 */
export async function planChain(reader: RepoReader, input: { repo: string; subdir: string | null; targetRef: string | null; dataVersion: number }): Promise<ModuleChain> {
  const { repo, subdir, dataVersion } = input;
  const head = await reader.manifestAt(input.targetRef ?? "refs/remotes/origin/HEAD", subdir) ?? await reader.manifestAt("refs/remotes/origin/main", subdir) ?? await reader.manifestAt("refs/remotes/origin/master", subdir);
  const floor = head?.dataFloor ?? 1;
  const base: ModuleChain = { dataVersion, floor, tags: [], repo, subdir };
  if (dataVersion >= floor) return base;

  const tags = (await reader.tags()).reverse();   // newest first
  const hops: string[] = [];
  let have = dataVersion;
  while (have < floor) {
    if (hops.length >= MAX_HOPS) return { ...base, tags: [], blocked: "too-long" };
    let pick: { tag: string; m: ManifestLite } | null = null;
    for (const tag of tags) {
      const m = await reader.manifestAt(tag, subdir);
      if (m && m.dataFloor <= have) { pick = { tag, m }; break; }
    }
    if (!pick) return { ...base, tags: [], blocked: "no-release" };
    if (pick.m.dataVersion <= have) return { ...base, tags: [], blocked: "no-release" };   // that release would not move the data forward
    hops.push(pick.tag);
    have = pick.m.dataVersion;
  }
  return { ...base, tags: hops };
}

/** Where a module is installed from: `repo#ref:subdir`. */
export const repoSpec = (repo: string, ref: string | null, subdir: string | null) => `${repo}${ref || subdir ? `#${ref ?? ""}${subdir ? `:${subdir}` : ""}` : ""}`;

/** Installs the first release of the chain (code only; the data arrives with the restore). Best effort: the caller falls back to the current version. */
export async function installFirstRelease(id: string, chain: ModuleChain): Promise<InstallResult> {
  const first = chain.tags[0];
  if (!first) return { ok: false, error: "modules.error.notfound" };
  const parsed = parseRepoUrl(repoSpec(chain.repo, first, chain.subdir));
  if (!parsed.ok) return parsed;
  return installModule(repoSpec(chain.repo, first, chain.subdir), { expectId: id, dependencies: false, restoreKept: false, firstInstance: false });
}

export type ChainStep = { step: string; ok: boolean; error?: string };

/**
 * After the data is restored: the remaining releases of the chain, each converting the data with its own code, then the version the catalogue pins.
 * Returns every step (the report lists the failed ones). Stops at the first failure: the data stays as the last good step left it.
 */
export async function walkRemaining(id: string, chain: ModuleChain): Promise<ChainStep[]> {
  const steps: ChainStep[] = [];
  for (const tag of chain.tags.slice(1)) {
    const r = await updateModuleToRef(id, tag).catch((e): InstallResult => ({ ok: false, error: String((e as Error)?.message ?? e) }));
    const failed = !r.ok || (r.migrations ?? []).some((m) => m.status === "failed" || m.status === "newer");
    steps.push({ step: tag, ok: !failed, ...(failed ? { error: r.ok ? (r.migrations ?? []).find((m) => m.error)?.error ?? "migration" : r.error } : {}) });
    if (failed) return steps;
  }
  const last = await updateModule(id).catch((e): InstallResult => ({ ok: false, error: String((e as Error)?.message ?? e) }));
  const upToDate = !last.ok && last.error === "modules.error.uptodate";
  const failed = !upToDate && (!last.ok || (last.migrations ?? []).some((m) => m.status === "failed" || m.status === "newer"));
  steps.push({ step: "current", ok: !failed, ...(failed ? { error: last.ok ? (last.migrations ?? []).find((m) => m.error)?.error ?? "migration" : last.error } : {}) });
  return steps;
}
