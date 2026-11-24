"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import type { ActionState } from "@/components/admin/ActionForm";
import { accessState, type AccessState } from "@/core/gitAccess";
import { removeAccessCode, saveAccessCode } from "@/core/gitAccessAdmin";
import { APPEARANCE_HREF, PERSONAL_HREF } from "@/core/adminLinks";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";

/**
 * Access code of a private repository (core 0.42.0): the owner only (right `core:modules.install`). The code arrives in the body of the request, is tried against the
 * repository, stored sealed, and is never sent back: the answers carry words, never the code. The assistant (MCP) has no tool that reaches these actions.
 */

const refresh = () => { revalidatePath(APPEARANCE_HREF); revalidatePath(EXTENSIONS_ADD_HREF); revalidatePath(PERSONAL_HREF); };

/** What is saved for the repository at this address (no secret): none, configured, or to enter again. */
export async function accessViewAction(url: string): Promise<AccessState> {
  await adminCtx({ right: "core:modules.install" });
  return accessState(String(url).slice(0, 400).split("#")[0]);
}

/** The "Edit" window: a new code replaces the saved one; left empty it keeps the current one. */
export async function saveAccessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:modules.install" });
  const url = String(fd.get("url") ?? "").slice(0, 400).split("#")[0]!;
  const code = String(fd.get("code") ?? "");
  const now = await accessState(url);
  if (!code.trim() && now.state === "configured") return { ok: t("access.unchanged") };
  const r = await saveAccessCode(url, code, user.email);
  if (!r.ok) return { errors: { code: t(`access.error.${r.error}`, r.address ? { address: r.address } : undefined) } };
  refresh();
  return { ok: t("access.saved") };
}

export async function removeAccessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx({ right: "core:modules.install" });
  const url = String(fd.get("url") ?? "").slice(0, 400).split("#")[0]!;
  await removeAccessCode(url, user.email);
  refresh();
  return { ok: t("access.removed") };
}
