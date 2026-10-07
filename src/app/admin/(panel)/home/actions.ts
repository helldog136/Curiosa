"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { getActiveInstances, sectionsOf } from "@/core/modules/registry";
import { audit } from "@/core/permissions";
import { MAX_COLUMNS, MAX_ROWS } from "@/core/home";
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
    // Taille en cases : on ne garde que ce qui diffère de la recommandation du module (elle pourra donc évoluer avec lui).
    const num = (k: string, max: number) => { const n = Math.trunc(Number(formData.get(k))); return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : undefined; };
    const w = num(`w_${i}`, MAX_COLUMNS), h = num(`h_${i}`, MAX_ROWS);
    const rec = { w: decl.size?.w ?? MAX_COLUMNS, h: decl.size?.h ?? 1 };
    rows.push({ order: Number(formData.get(`order_${i}`)) || 0, section: { id: `s${i}-${Date.now().toString(36)}`, instance: instanceKey, section: sectionId, options, ...(w !== undefined && w !== rec.w ? { w } : {}), ...(h !== undefined && h !== rec.h ? { h } : {}) } });
  }
  rows.sort((a, b) => a.order - b.order);
  const columns = Math.trunc(Number(formData.get("columns")));
  if (Number.isFinite(columns) && columns >= 1) await setSetting("home.columns", Math.min(MAX_COLUMNS, columns));
  await setSetting("home.sections", rows.map((r) => r.section));
  await audit(user.email, "home.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
