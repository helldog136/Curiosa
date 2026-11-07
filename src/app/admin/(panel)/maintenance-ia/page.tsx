import { redirect } from "next/navigation";
import { legacyAssistantsTarget, ASSISTANTS_HREF, type RawQuery } from "@/core/services/mcp/assistantsLinks";
import { MAINTENANCE_IA_LEGACY_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/** Ancienne page « Maintenance par IA » : mène à Assistants IA › Demandes à valider (?notice=… conservé). */
export default async function Page({ searchParams }: { searchParams: Promise<RawQuery> }) {
  redirect(legacyAssistantsTarget(MAINTENANCE_IA_LEGACY_HREF, await searchParams) ?? ASSISTANTS_HREF);
}
