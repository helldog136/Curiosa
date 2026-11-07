import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";
import { ACCESS_PROFILES } from "@/core/services/mcp/profiles";
import { profileLines } from "@/core/services/mcp/profileTexts";
import { GUIDE_KEYS, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { AssistantStep } from "./AssistantStep";
import { ADMIN_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/** Last, optional step of the setup: right after the account exists (an access needs an owner), the person can connect an AI assistant. Skipping creates nothing. */
export default async function SetupAssistantPage({ searchParams }: { searchParams: Promise<{ modules?: string }> }) {
  const { t } = await adminCtx({ right: "core:mcp.tokens" });
  const { modules } = await searchParams;
  // The dashboard notice about modules is carried over (a closed list, nothing else goes into the address).
  const back = `${ADMIN_HREF}?welcome=1${modules === "partial" || modules === "failed" ? `&modules=${modules}` : ""}`;
  const guide = Object.fromEntries(GUIDE_KEYS.map((k) => [k, t(k)])) as GuideTexts;
  const text = (keys: readonly string[]) => keys.map((k) => t(k));
  return (
    <AssistantStep
      baseUrl={siteUrl}
      backHref={back}
      manageHref={ASSISTANTS_HREF}
      guide={guide}
      profiles={ACCESS_PROFILES.map((p) => ({ id: p, name: t(`ai.profile.${p}`), lines: text(profileLines(p)) }))}
      texts={Object.fromEntries(
        ["title", "optional", "intro", "name", "nameExample", "nameDefault", "profile", "allows", "create", "skip", "skipNote", "created", "address", "code", "once", "remove",
          "how.title", "how.l1", "how.l2", "how.l3", "how.l4", "how.ready", "reconnect", "next.title", "next", "dashboard", "manage"].map((k) => [k, t(`setup.ai.${k}`)]),
      )}
      always={t("ai.profile.always")}
      copy={{ copy: t("mcp.guide.copy"), copied: t("mcp.guide.copied") }}
    />
  );
}
