/** The disk the data folder lives on (the Docker data volume, or the host disk on bare metal). The one place that turns the raw numbers into a level. */
import { deps } from "../maintenance/deps";
import { describeDisk, type DiskSpace } from "./level";

export function diskSpace(): DiskSpace | null {
  const d = deps.disk();
  return d ? describeDisk(d.freeBytes, d.totalBytes) : null;
}
