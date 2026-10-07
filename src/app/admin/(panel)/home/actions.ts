"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { SLOTS } from "@/core/blocks";
import { getCollectionByKey } from "@/core/collections";
import { audit } from "@/core/permissions";
import { setSetting, type HomeSection } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

export async function saveHome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const total = Math.min(Number(formData.get("count")) || 0, 60);
  const rows: { order: number; section: HomeSection }[] = [];

  for (let i = 0; i < total; i++) {
    if (formData.get(`remove_${i}`) === "on") continue;
    const type = String(formData.get(`type_${i}`) ?? "");
    const source = String(formData.get(`source_${i}`) ?? "");
    const order = Number(formData.get(`order_${i}`)) || 0;
    const id = `s${i}-${Date.now().toString(36)}`;
    if (type === "hero") rows.push({ order, section: { id, type: "hero" } });
    else if (type === "collection" && source.startsWith("c:")) {
      const collection = await getCollectionByKey(source.slice(2));
      const count = Math.min(50, Math.max(1, Number(formData.get(`count_${i}`)) || 3));
      if (collection) rows.push({ order, section: { id, type: "collection", collection: collection.key, count } });
    } else if (type === "slot" && source.startsWith("s:") && (SLOTS as string[]).includes(source.slice(2))) {
      rows.push({ order, section: { id, type: "slot", slot: source.slice(2) } });
    }
  }
  rows.sort((a, b) => a.order - b.order);
  await setSetting("home.sections", rows.map((r) => r.section));
  await audit(user.email, "home.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
