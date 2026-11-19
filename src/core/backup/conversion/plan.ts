import { getModule } from "@/core/modules/registry";
import type { CatalogueEntry } from "@/core/modules/catalogue";
import { readVersion } from "@/core/updates/service";
import { compareVersions } from "@/core/updates/versions";
import { runCoreConversions, rawgCarryOver, rawgSummary } from "./coreConversions";
import { dataVersionInBackup, openRepo, planChain, type ModuleChain, type RepoReader } from "./moduleChain";
import type { BackupData, ReportItem } from "./types";

/**
 * THE CONVERSION PLAN: shown BEFORE anything is restored (docs/BACKUP.md, "Old backups"). Nothing here writes: the core conversions run on a copy of the lists, the
 * module paths only read git. It says the version gap, which core conversions will run, the path of each module whose data needs more than the current version, and
 * what can only be set aside (with the exact place to look by hand in the unpacked archive).
 */
export type PlanModuleStep = {
  id: string;
  /** bridge: through older releases first · installed: the module is already here and cannot be walked back · blocked: no release converts this data. */
  route: "bridge" | "installed" | "blocked";
  dataVersion: number;
  floor: number;
  /** Releases to go through (oldest first); empty unless `route` is "bridge". */
  tags: string[];
  /** Where the data of this module is in the unpacked archive. */
  path: string;
};

export type ConversionPlan = {
  backupVersion: string;
  currentVersion: string;
  /** same: same release · older: an older release · unknown: the file does not say. */
  gap: "same" | "older" | "unknown";
  /** Core conversions that will run (id = `core.<name>`; `params.count` when it counts something). */
  core: ReportItem[];
  /** What the RAWG hand-over will carry (never a value). */
  rawg: { key: boolean; fixes: number; todo: number } | null;
  modules: PlanModuleStep[];
};

/** `d` is copied (lists and module rows): the plan never changes what it is given. */
const copyOf = (d: BackupData): BackupData => ({ ...d, modules: d.modules.map((m) => ({ ...m })), instances: [...d.instances], instanceTranslations: [...d.instanceTranslations], entries: [...d.entries], entryTranslations: [...d.entryTranslations], records: [...d.records], settings: [...d.settings], retired: [...(d.retired ?? [])] });

export function corePlan(d: BackupData, now: Date): { core: ReportItem[]; rawg: ConversionPlan["rawg"] } {
  const copy = copyOf(d);
  const ran = runCoreConversions(copy, now);
  return { core: [...ran.converted, ...ran.setAside], rawg: rawgSummary(rawgCarryOver(copy)) };
}

const pathOfModule = (d: BackupData, id: string): string => {
  const keys = d.instances.filter((i) => i.moduleId === id).map((i) => String(i.key)).filter(Boolean);
  return keys.length ? keys.map((k) => `readable/modules/${k}/`).join(", ") : "data/module-records.json";
};

type ModuleInput = { id: string; status: string; entry?: CatalogueEntry };

/** The path of every module whose data is below what the version offered here converts. Never throws: a repository that cannot be read leaves the module on the direct path. */
export async function planModuleSteps(d: BackupData, modules: ModuleInput[], readers = new Map<string, RepoReader>()): Promise<{ steps: PlanModuleStep[]; chains: Map<string, ModuleChain> }> {
  const steps: PlanModuleStep[] = [];
  const chains = new Map<string, ModuleChain>();
  const own = !readers.size;
  try {
    for (const m of modules) {
      const dataVersion = dataVersionInBackup(d, m.id);
      if (dataVersion <= 1 && !d.instances.some((i) => i.moduleId === m.id)) continue;
      if (m.status === "installed") {
        const floor = (await getModule(m.id).catch(() => null))?.manifest.dataFloor ?? 1;
        if (dataVersion < floor) steps.push({ id: m.id, route: "installed", dataVersion, floor, tags: [], path: pathOfModule(d, m.id) });
        continue;
      }
      if (m.status !== "catalogue" || !m.entry?.repo) continue;
      try {
        let reader = readers.get(m.entry.repo);
        if (!reader) { reader = await openRepo(m.entry.repo); readers.set(m.entry.repo, reader); }
        const chain = await planChain(reader, { repo: m.entry.repo, subdir: m.entry.subdir ?? null, targetRef: m.entry.ref ?? null, dataVersion });
        if (chain.tags.length || chain.blocked) {
          chains.set(m.id, chain);
          steps.push({ id: m.id, route: chain.blocked ? "blocked" : "bridge", dataVersion, floor: chain.floor, tags: chain.tags, path: pathOfModule(d, m.id) });
        }
      } catch { /* repository unreachable: the direct path is tried at restore time and its failure is reported then */ }
    }
  } finally {
    if (own) for (const r of readers.values()) r.close();
  }
  return { steps, chains };
}

export async function buildConversionPlan(opts: { data: BackupData; frameworkVersion: string | undefined; createdAt: string; modules: ModuleInput[] }): Promise<ConversionPlan> {
  const currentVersion = readVersion();
  const backupVersion = opts.frameworkVersion ?? "";
  const { core, rawg } = corePlan(opts.data, new Date(opts.createdAt));
  const { steps } = await planModuleSteps(opts.data, opts.modules);
  return {
    backupVersion, currentVersion,
    gap: !/^\d+\.\d+\.\d+/.test(backupVersion) ? "unknown" : compareVersions(backupVersion, currentVersion) === 0 ? "same" : "older",
    core, rawg, modules: steps,
  };
}
