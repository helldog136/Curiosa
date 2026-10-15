import { redirect } from "next/navigation";
import { legacyAssistantsTarget, ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";

export const dynamic = "force-dynamic";

/** Ancienne page d'un jeton : mène à la page de cet accès dans Assistants IA. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(legacyAssistantsTarget(`/admin/mcp/${encodeURIComponent(id)}`) ?? ASSISTANTS_HREF);
}
