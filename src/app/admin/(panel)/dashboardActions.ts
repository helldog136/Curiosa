"use server";
import { ADMIN_HREF } from "@/core/adminLinks";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { setSetupHidden } from "@/core/dashboard/setup";
import { storageInfo } from "@/core/storage/service";

/** « Masquer cette liste » (mise en route) : réservé à l'administration, noté au journal. */
export async function hideSetup(): Promise<void> {
  const { user } = await adminCtx("admin");
  await setSetupHidden(user, true);
  revalidatePath(ADMIN_HREF);
}

/** « Refresh » on the Storage card: measures again now (at most every 30 seconds; the measurement is bounded). Same people as the card. */
export async function refreshStorage(): Promise<void> {
  await adminCtx({ right: "core:backup" });
  await storageInfo({ refresh: true, waitMs: 8_000 });
  revalidatePath(ADMIN_HREF);
}
