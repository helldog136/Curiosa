import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { providerInstance } from "@/core/modules/dependencies";
import { COVERS_MODULE, COVERS_SERVICE } from "@/core/services/rawgHandover";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Adresse HISTORIQUE de l'écran « Quel est le bon jeu ? » (liens « Ce n'est pas le bon jeu ? » déjà publiés par les modules, favoris) : depuis la 0.3.0 cet écran est celui du
 * module « Jaquettes de jeux ». Cette page ne montre plus rien : elle conduit au même écran, sur le même titre ; sans le module, à sa fiche du catalogue (pour l'installer).
 */
export default async function RawgCoversRedirect({ searchParams }: { searchParams: Promise<Params> }) {
  await adminCtx("admin");
  const sp = await searchParams;
  const provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
  if (!provider) redirect(`/admin/extensions/add/details?id=${COVERS_MODULE}`);
  const keep = new URLSearchParams();
  const titre = one(sp.titre).slice(0, 400), q = one(sp.q).slice(0, 400), saved = one(sp.saved);
  if (titre) keep.set("titre", titre);
  if (q && titre) keep.set("q", q);
  if (["game", "none", "confirm", "forgot"].includes(saved)) keep.set("saved", saved);
  redirect(`/admin/instances/${provider.instance.id}${keep.size ? `?${keep}` : ""}`);
}
