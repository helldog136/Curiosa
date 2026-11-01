import { ModuleView, type ModuleQuery } from "./ModuleView";

export const dynamic = "force-dynamic";

/** Page d'un module en page entière (adresse directe, rafraîchissement). Depuis Extensions, le même contenu s'ouvre en fenêtre (voir extensions/@modal). */
export default async function ModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ModuleQuery> }) {
  const { id } = await params;
  return <ModuleView id={id} query={await searchParams} />;
}
