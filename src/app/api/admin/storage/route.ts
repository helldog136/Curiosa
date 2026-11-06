import { NextResponse } from "next/server";
import { currentUser, isMember } from "@/core/permissions";
import { getAdminTranslator } from "@/core/i18n/request";
import { canSeeStorage } from "@/core/storage/access";
import { presentStorage } from "@/core/storage/present";
import { storageInfo } from "@/core/storage/service";

export const dynamic = "force-dynamic";

/** The upload hint ("3.2 GB free of 20 GB"): free space only, as sentences in the reader's language. No path, no measurement started. Everyone who can upload may read it; the link to the detail only goes to the people who can open it. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isMember(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { t, locale } = await getAdminTranslator(user.locale);
  const v = presentStorage(await storageInfo({ diskOnly: true }), t, locale);
  if (!v.uploadLine) return NextResponse.json({ line: null });
  return NextResponse.json(
    { line: v.uploadLine, level: v.level, icon: v.icon, state: v.stateText, warning: v.level === "ok" ? null : t("storage.uploadWarn", { free: v.freeText ?? "" }), href: canSeeStorage(user) ? "/admin#storage" : null, details: t("storage.seeDetails") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
