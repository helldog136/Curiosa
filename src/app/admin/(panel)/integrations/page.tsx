import { redirectLegacy } from "@/app/admin/(panel)/legacyRedirect";
import type { RawQuery } from "@/core/modules/extensionsLinks";
import { INTEGRATIONS_LEGACY_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/** Ancienne adresse : mène à la page Extensions (voir core/modules/extensionsLinks.ts). */
export default function Page({ searchParams }: { searchParams: Promise<RawQuery> }) {
  return redirectLegacy(INTEGRATIONS_LEGACY_HREF, searchParams);
}
