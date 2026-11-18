"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { accessHref, ASSISTANTS_HREF, TEAM_HREF } from "@/core/services/mcp/assistantsLinks";
import { setFullPowers } from "@/core/services/mcp/fullPowers";
import { removalConfirmed } from "@/components/admin/removalConfirm";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * FULL POWERS of an access (core 0.35.0, services/mcp/fullPowers.ts): OWNER only, in the admin, and ONLY here. Not the technical coordination (which holds
 * `core:mcp.tokens`), and never an assistant: no MCP tool and no module reaches `setFullPowers`. Kept in its own file so that actions.ts stays on core:mcp.tokens.
 *
 * Turning it on needs the typed name of the access (checked here again, not only in the window). Both ways are journalled with the owner as actor, the name of the
 * access and the time of the journal line. Turning it off needs no confirmation: it is the way back, and it is always one click.
 */
export async function setFullPowersAction(tokenId: string, on: boolean, typedName?: string): Promise<ActionState> {
  const { user, t } = await adminCtx("owner");
  const row = await prisma.apiToken.findUnique({ where: { id: String(tokenId) } });
  if (!row || row.revokedAt) return { errors: { name: t("fullpowers.err.gone") } };
  if (on) {
    if (row.scope !== "write") return { errors: { name: t("fullpowers.readOnly") } };
    if (!removalConfirmed("erase", { checked: false, typed: String(typedName ?? ""), name: row.name })) return { errors: { name: t("fullpowers.err.name", { name: row.name }) } };
  }
  if (!(await setFullPowers(row.id, on))) return { errors: { name: t("fullpowers.err.gone") } };
  await audit(user.email, on ? "mcp.fullpowers.on" : "mcp.fullpowers.off", row.name);
  revalidatePath(ASSISTANTS_HREF);
  revalidatePath(TEAM_HREF);
  revalidatePath(accessHref(row.id));
  return { ok: t(on ? "fullpowers.done.on" : "fullpowers.done.off", { name: row.name }) };
}

/** The "turn off" button of the banner and of the access row: a form action (no state to show, the page redraws). */
export async function turnOffFullPowersAction(tokenId: string): Promise<void> {
  await setFullPowersAction(tokenId, false);
}
