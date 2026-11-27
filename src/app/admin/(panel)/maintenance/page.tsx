import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { MAINTENANCE_TAB_HREFS } from "@/core/adminLinks";
import { deniedPath } from "@/core/auth/access";
import { maintenanceTabs } from "@/core/modules/adminMenu";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("nav.maintenance"));
}

/** `/admin/maintenance`: the address of the whole Maintenance entry. It opens the first of its pages this person may open (each page keeps its own gate). */
export default async function MaintenanceIndex() {
  const { user, advanced } = await adminCtx("member");
  const [first] = maintenanceTabs({ role: user.level, advanced });
  redirect(first ? MAINTENANCE_TAB_HREFS[first] : deniedPath(user));
}
