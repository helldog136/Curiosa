import { InstanceView } from "./InstanceView";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";
import { getInstanceById } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return adminTitle(async ({ locale, config }) => {
    const instance = await getInstanceById(id);
    return instance ? (await getInstanceLabeler(locale, config.defaultLocale)).label(instance) : "";
  }, { need: "member" });
}

/** Réglages d'une instance en page entière (adresse directe, rafraîchissement, menu d'admin). Depuis Extensions, le même contenu s'ouvre en fenêtre (voir extensions/@modal). */
export default async function InstancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  return <InstanceView id={id} query={await searchParams} />;
}
