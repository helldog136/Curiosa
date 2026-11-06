/** The storage numbers as the maintenance assistant tool shows them: plain data, English keys, no path. */
import type { StorageInfo } from "./service";

export function storageForTool(info: StorageInfo) {
  return {
    install: info.install,
    pending: info.pending,
    measuredAt: info.measuredAt,
    usedBySiteBytes: info.usage?.totalBytes ?? null,
    /** A bound was hit while measuring: the sizes are a lower bound. */
    partial: info.usage?.partial ?? false,
    categories: info.usage ? { ...info.usage.categories } : null,
  };
}
