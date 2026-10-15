import { redirect } from "next/navigation";
import { legacyAssistantsTarget, ASSISTANTS_HREF, type RawQuery } from "@/core/services/mcp/assistantsLinks";

export const dynamic = "force-dynamic";

/** Ancienne page « API & MCP » : mène à Assistants IA › Accès (?profile=maintenance conservé ; l'ancre #new-token est gardée par le navigateur). */
export default async function Page({ searchParams }: { searchParams: Promise<RawQuery> }) {
  redirect(legacyAssistantsTarget("/admin/mcp", await searchParams) ?? ASSISTANTS_HREF);
}
