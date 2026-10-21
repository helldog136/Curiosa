import { RouteModal } from "@/components/admin/RouteModal";
import { adminCtx } from "@/core/admin";
import { getInstanceById } from "@/core/instances";
import { InstanceView } from "../../../../instances/[id]/InstanceView";

export const dynamic = "force-dynamic";

/** Les réglages d'une instance, ouverts PAR-DESSUS la liste des extensions (le même contenu que la page /admin/instances/<id>, ouverte seule en page entière). */
export default async function InstanceSettingsModal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { t } = await adminCtx("admin");
  // Une action qui retire cette instance se rend de nouveau ici avant de rediriger : pas de fenêtre (et surtout pas de 404) pour une instance qui n'existe plus.
  if (!(await getInstanceById(id))) return null;
  return <RouteModal testid="settings-modal" label={t("settings.modalLabel")} closeLabel={t("modal.close")}><InstanceView id={id} query={await searchParams} inModal /></RouteModal>;
}
