import { ModuleView, type ModuleQuery } from "./ModuleView";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";
import { getModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return adminTitle(async ({ locale, config }) => {
    const mod = await getModule(decodeURIComponent(id));
    return mod ? localized(mod.manifest.name, locale, config.defaultLocale) : "";
  }, { need: "admin" });
}

/** Page d'un module en page entière (adresse directe, rafraîchissement). Depuis Extensions, le même contenu s'ouvre en fenêtre (voir extensions/@modal). */
export default async function ModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ModuleQuery> }) {
  const { id } = await params;
  return <ModuleView id={id} query={await searchParams} />;
}
