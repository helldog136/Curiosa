import { RouteModal } from "@/components/admin/RouteModal";
import { adminCtx } from "@/core/admin";
import { ModuleView, type ModuleQuery } from "../../../../modules/[id]/ModuleView";

export const dynamic = "force-dynamic";

/** Les réglages d'un module (instances, mises à jour, retrait), ouverts PAR-DESSUS la liste des extensions (le même contenu que la page /admin/modules/<id>). */
export default async function ModuleSettingsModal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ModuleQuery> }) {
  const { id } = await params;
  const { t } = await adminCtx("admin");
  return <RouteModal testid="settings-modal" label={t("settings.modalLabel")} closeLabel={t("modal.close")}><ModuleView id={id} query={await searchParams} embedded /></RouteModal>;
}
