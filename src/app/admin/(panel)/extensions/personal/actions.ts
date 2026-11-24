"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { accessState, type AccessState } from "@/core/gitAccess";
import { verifyAccessCode } from "@/core/gitAccessAdmin";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { PERSONAL_HREF } from "@/core/adminLinks";
import { addCatalogue, catalogueLabel, checkCatalogue, listCatalogues, refreshCatalogues, removeCatalogue, type Offer, type RefusalReason } from "@/core/modules/personalCatalogues";
import { forgetModulesReport } from "@/core/modules/updateStatus";
import { audit } from "@/core/permissions";

/**
 * Personal catalogues (core 0.47.0): registering a repository (maybe private) that offers extensions. The owner only (right `core:modules.install`): it is code that runs
 * on the server. Nothing here reaches an assistant (MCP). The access code arrives in the body of the request, is tried against the repository and stored sealed by
 * `saveAccessCode`; the answers carry words, never the code.
 */

export type OfferView = { id: string; name: string; version?: string; icon?: string; ready: boolean; needsCore?: string };
export type RefusedView = { id: string; text: string };
export type CheckView =
  | { ok: true; address: string; name: string; offers: OfferView[]; refused: RefusedView[]; access: AccessState; alreadyAdded: boolean }
  | { ok: false; error: string; field?: "code"; needsCode?: boolean };

const refresh = () => { revalidatePath(PERSONAL_HREF); revalidatePath(EXTENSIONS_ADD_HREF); forgetModulesReport(); };
const offerView = (o: Offer): OfferView => ({ id: o.id, name: o.name, ...(o.version ? { version: o.version } : {}), ...(o.icon ? { icon: o.icon } : {}), ready: !o.needsCore, ...(o.needsCore ? { needsCore: o.needsCore } : {}) });

/** Looks at the address (with a code the owner has just pasted, tried first): how many extensions it offers, which are refused and why. Registers nothing. */
export async function checkPersonalAction(address: string, code?: string): Promise<CheckView> {
  const { user, t } = await adminCtx({ right: "core:modules.install" });
  const url = String(address ?? "").slice(0, 400).trim();
  // A code the owner has just pasted is tried from memory and NOT saved: it is saved only when the catalogue is added (addPersonalAction).
  if (code?.trim()) {
    const tried = await verifyAccessCode(url.split("#")[0]!, code, user.email);
    if (!tried.ok) return { ok: false, field: "code", needsCode: true, error: t(`access.error.${tried.error}`, tried.address ? { address: tried.address } : undefined) };
  }
  const r = await checkCatalogue(url, code?.trim() || undefined);
  if (!r.ok) return { ok: false, error: t(r.error), ...(r.needsCode ? { needsCode: true } : {}) };
  const why = (reason: RefusalReason, id: string, by?: string) => t(`personal.refused.${reason}`, { id, by: by ?? "" });
  return { ok: true, address: r.address, name: r.name, offers: r.offers.map(offerView), refused: r.refused.map((x) => ({ id: x.id, text: why(x.reason, x.id, x.by) })), access: r.access, alreadyAdded: r.alreadyAdded };
}

export async function addPersonalAction(address: string, name: string, code?: string): Promise<{ ok: true; offered: number } | { ok: false; error: string }> {
  const { user, t } = await adminCtx({ right: "core:modules.install" });
  const r = await addCatalogue(String(address ?? "").slice(0, 400).trim(), String(name ?? "").slice(0, 80), user.email, typeof code === "string" && code.trim() ? code : undefined);
  if (!r.ok) return { ok: false, error: t(r.error) };
  await audit(user.email, "module.catalogue.add", catalogueLabel(r.catalogue.url));
  refresh();
  return { ok: true, offered: r.offered };
}

export async function removePersonalAction(id: string): Promise<{ ok: boolean; kept: number }> {
  const { user } = await adminCtx({ right: "core:modules.install" });
  const target = (await listCatalogues()).find((c) => c.id === String(id));
  const r = await removeCatalogue(String(id), user.email);
  if (r.ok && target) await audit(user.email, "module.catalogue.remove", catalogueLabel(target.url));
  refresh();
  return { ok: r.ok, kept: r.keptModules.length };
}

/** "Refresh": the index is read again from the repository now. */
export async function refreshPersonalAction(): Promise<void> {
  await adminCtx({ right: "core:modules.install" });
  refreshCatalogues();
  refresh();
}

/** What is saved for the repository of a catalogue (no secret). */
export async function personalAccessAction(address: string): Promise<AccessState> {
  await adminCtx({ right: "core:modules.install" });
  return accessState(String(address ?? "").slice(0, 400).split("#")[0]!);
}
