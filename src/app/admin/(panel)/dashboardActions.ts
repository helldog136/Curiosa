"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { setSetupHidden } from "@/core/dashboard/setup";

/** « Masquer cette liste » (mise en route) : réservé à l'administration, noté au journal. */
export async function hideSetup(): Promise<void> {
  const { user } = await adminCtx("admin");
  await setSetupHidden(user, true);
  revalidatePath("/admin");
}
