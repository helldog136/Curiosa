import { InstanceView } from "./InstanceView";

/** Réglages d'une instance en page entière (adresse directe, rafraîchissement, menu d'admin). Depuis Extensions, le même contenu s'ouvre en fenêtre (voir extensions/@modal). */
export default async function InstancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  return <InstanceView id={id} query={await searchParams} />;
}
