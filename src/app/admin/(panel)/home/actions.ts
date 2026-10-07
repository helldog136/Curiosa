"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { getActiveInstances, sectionsOf } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { isSectionSize } from "@/core/home";
import { setSetting, type HomeSection } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

export async function saveHome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const active = await getActiveInstances();
  const total = Math.min(Number(formData.get("count")) || 0, 60);
  const rows: { order: number; section: HomeSection }[] = [];

  for (let i = 0; i < total; i++) {
    if (formData.get(`remove_${i}`) === "on") continue;
    const [instanceKey = "", sectionId = ""] = String(formData.get(`section_${i}`) ?? "").split("|");
    const target = active.find((a) => a.instance.key === instanceKey);
    const decl = target ? sectionsOf(target.mod.manifest).find((s) => s.id === sectionId) : undefined;
    if (!target || !decl) continue;

    // Les options ne sont lues que si elles sont déclarées par le module, et typées selon sa déclaration.
    const options: Record<string, unknown> = {};
    for (const o of decl.options ?? []) {
      const raw = formData.get(`opt_${i}_${o.key}`);
      if (o.type === "boolean") options[o.key] = raw === "on";
      else if (raw !== null && String(raw).trim() !== "") {
        options[o.key] = o.type === "number" ? Number(raw) || 0 : String(raw).trim().slice(0, 500);
      } else if (o.default !== undefined) options[o.key] = o.default;
    }
    // On ne garde la taille que si elle diffère de la recommandation du module (elle pourra donc évoluer avec lui).
    const chosen = String(formData.get(`size_${i}`) ?? "");
    const size = isSectionSize(chosen) && chosen !== (decl.size ?? "full") ? chosen : undefined;
    rows.push({ order: Number(formData.get(`order_${i}`)) || 0, section: { id: `s${i}-${Date.now().toString(36)}`, instance: instanceKey, section: sectionId, options, ...(size ? { size } : {}), ...(formData.get(`isolated_${i}`) === "on" ? { isolated: true } : {}) } });
  }
  rows.sort((a, b) => a.order - b.order);
  await setSetting("home.sections", rows.map((r) => r.section));
  await audit(user.email, "home.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
