import { callProvider, providerInstance } from "@/core/modules/dependencies";
import { ensureDefaultInstance } from "@/core/modules/defaultInstance";
import { getModule } from "@/core/modules/registry";
import { installFromCatalogue } from "@/core/modules/installer";
import { setSetting } from "@/core/settings";
import { audit } from "@/core/permissions";
import { COVERS_MODULE, COVERS_SERVICE, type RawgPayload } from "./coreConversions";
import type { ReportItem } from "./types";

/**
 * Applies the RAWG hand-over prepared by `rawgCarryOver` (coreConversions.ts) AFTER the data of the backup is in place: the "Game covers" module is installed when it
 * is missing (official catalogue only), gets its first instance, and receives the key, the cover fixes and the list to check through its `adopt` service, which never
 * replaces what the module already holds. The value of the key never leaves memory: not shown, not logged. Never throws.
 */
export async function applyRawgHandover(payload: RawgPayload, actor: string): Promise<{ converted?: ReportItem; failed?: ReportItem }> {
  const path = "data/settings.json (rawg.key, rawg.fixes)";
  try {
    if (!(await getModule(COVERS_MODULE))) {
      const r = await installFromCatalogue(COVERS_MODULE, { dependencies: false, restoreKept: false, firstInstance: false });
      if (!r.ok) return { failed: { id: "core.rawg", note: "rawgInstall", path } };
    }
    await ensureDefaultInstance(COVERS_MODULE);
    if (!(await providerInstance(COVERS_SERVICE, COVERS_MODULE))) return { failed: { id: "core.rawg", note: "rawgInstall", path } };
    const r = await callProvider(COVERS_SERVICE, "adopt", { ...(payload.key ? { key: payload.key } : {}), fixes: payload.fixes, todo: payload.todo }, { moduleId: COVERS_MODULE });
    const v = r.ok && r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : null;
    if (!v || v.ok !== true || (payload.key && v.keyHeld !== true)) return { failed: { id: "core.rawg", note: "rawgRefused", path } };
    await setSetting("rawg.handover", { doneAt: new Date().toISOString(), key: v.keyHeld === true, fixes: Number(v.fixes) || 0, todo: Number(v.todo) || 0 });
    await audit(actor, "rawg.handover", COVERS_MODULE);
    return { converted: { id: "core.rawg", note: "rawg", params: { fixes: Number(v.fixes) || 0 } } };
  } catch {
    return { failed: { id: "core.rawg", note: "rawgRefused", path } };
  }
}
