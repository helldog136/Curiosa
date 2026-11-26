import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { accessState } from "@/core/gitAccess";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { getRecognizedDetailed } from "@/core/modules/recognized";
import { installedFrom, listCatalogues, statusOf } from "@/core/modules/personalCatalogues";
import { PersonalView } from "./PersonalView";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => `${t("nav.extensions")} \u00b7 ${t("hub.tab.personal")}`);
}

export default async function PersonalCataloguesPage() {
  const { t, user, advanced } = await adminCtx("admin");
  if (!can(user, "core:modules.install")) redirect(EXTENSIONS_HREF);
  await getRecognizedDetailed().catch(() => null);   // reads every catalogue now, so each row says what its last reading found
  const data = await Promise.all((await listCatalogues()).map(async (catalogue) => ({ catalogue, status: statusOf(catalogue.id), access: await accessState(catalogue.url), installed: (await installedFrom(catalogue)).length })));
  return <PersonalView t={t} advanced={advanced} data={data} />;
}
