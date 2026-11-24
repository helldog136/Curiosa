import { prisma } from "@/core/db";
import { FEATURES } from "@/core/instances";
import { setSetting } from "@/core/settings";
import { seenFeaturesKey } from "@/core/instanceKeys";
import { getModule, listModuleRows } from "./registry";
import type { ParsedManifest } from "./manifest";

/**
 * INSTANCE FEATURES FOLLOW THE MODULE (0.45.1).
 *
 * An instance gets the content features of its module (`content.features` in module.json) when it is created, and the owner can then untick any of them in the
 * instance settings. So a feature that a LATER version of the module declares for the first time (0.45.0: "skin") never reached the instances that already existed.
 *
 * Rule: each instance remembers the manifest features it has "seen" (setting `instance.<id>.__seenFeatures`, a JSON list; no schema change). After an update (and at start-up),
 * the features the manifest declares that the instance has not seen yet are ADDED to the instance, then marked as seen. Nothing is ever removed, and a feature the
 * owner unticked stays unticked: it is already in the seen list, so it is not "new" again.
 *
 * One-time catch-up for instances created before this tracking existed (no seen list): we cannot know which features the owner unticked on purpose, so we assume
 * the owner saw every feature EXCEPT "skin", which is brand new (released in 0.45.0, the day before this fix) and so cannot have been unticked deliberately. Seen = manifest
 * features minus "skin"; "skin" is then the only new feature, and is added. Run at start-up, before any later module update, so a legacy instance never meets another feature
 * as "new" by mistake. Idempotent: a second run finds nothing new and writes nothing.
 */
export { seenFeaturesKey };

/** The features declared by a manifest that this core knows. */
export const manifestFeatures = (manifest: Pick<ParsedManifest, "content">): string[] =>
  (manifest.content?.features ?? []).filter((f) => (FEATURES as readonly string[]).includes(f));

/** Pure: what the instance has after adopting, and what it has seen. `seen` null = instance created before the tracking (see the catch-up above). */
export function adoptFeatures(current: string[], seen: string[] | null, declared: string[]): { features: string[]; seen: string[]; added: string[] } {
  const known = seen ?? declared.filter((f) => f !== "skin");
  const added = declared.filter((f) => !known.includes(f) && !current.includes(f));
  return { features: [...current, ...added], seen: [...new Set([...known, ...declared])], added };
}

const parseList = (raw: string | null | undefined): string[] | null => {
  if (raw == null) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null; } catch { return null; }
};

/** Adopts the newly declared features on every instance of one module. Returns the number of instances that changed. Never throws. */
export async function adoptModuleFeatures(moduleId: string): Promise<number> {
  try {
    const mod = await getModule(moduleId);
    if (!mod) return 0;
    const declared = manifestFeatures(mod.manifest);
    const rows = await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true, features: true } });
    const settings = await prisma.setting.findMany({ where: { key: { in: rows.map((r) => seenFeaturesKey(r.id)) }, locale: "" }, select: { key: true, value: true } });
    const seenByKey = new Map(settings.map((s) => [s.key, parseList(s.value)]));
    let changed = 0;
    for (const row of rows) {
      const seen = seenByKey.get(seenFeaturesKey(row.id)) ?? null;
      const next = adoptFeatures(parseList(row.features) ?? [], seen, declared);
      if (next.added.length) {
        await prisma.moduleInstance.update({ where: { id: row.id }, data: { features: JSON.stringify(next.features) } });
        changed++;
      }
      if (seen === null || next.seen.length !== seen.length) await setSetting(seenFeaturesKey(row.id), next.seen);
    }
    return changed;
  } catch (error) {
    console.error(`[modules] feature adoption failed for ${moduleId}:`, (error as Error)?.message);
    return 0;
  }
}

/** Start-up pass over every installed module. */
export async function adoptAllInstanceFeatures(): Promise<number> {
  let n = 0;
  for (const row of await listModuleRows()) n += await adoptModuleFeatures(row.id);
  return n;
}
