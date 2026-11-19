"use server";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { APPEARANCE_HREF } from "@/core/adminLinks";
import type { ActionState } from "@/components/admin/ActionForm";
import { saveSkinOptions } from "@/core/skins/appearance";
import { definitionOf } from "@/core/skins/appearanceView";
import { composeDraft } from "@/core/skins/customizeDraft";
import { resetCustom, saveCustom } from "@/core/skins/customizeStore";
import { SKIN_ID_RE } from "@/core/skins/allowlist";
import { BASIC_ID } from "@/core/skins/constants";
import { activeSkinId } from "@/core/skins/service";
import type { Signal } from "@/core/skins/customizeResolve";
import { fieldName } from "./shared";

type State = { values?: unknown; look?: unknown; options?: unknown };
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const parse = (text: unknown): State => { try { return asRecord(JSON.parse(String(text ?? ""))); } catch { return {}; } };
const optionsOf = (state: State): Record<string, string> => Object.fromEntries(Object.entries(asRecord(state.options)).filter(([, v]) => typeof v === "string") as [string, string][]);

/** Saves the customization of one skin (administration, like the retouches). Errors come back under the field they belong to, with what to do. */
export async function saveCustomizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const skinId = String(fd.get("skin") ?? "");
  if (!SKIN_ID_RE.test(skinId) || skinId === BASIC_ID) return { error: t("error.generic") };
  const def = await definitionOf(skinId);
  if (!def) return { error: t("appearance.cz.unavailable") };
  const state = parse(fd.get("state"));
  const values = asRecord(state.values);
  if (def.customize) {
    const r = await saveCustom({ id: def.id, version: def.version, customize: def.customize }, { values, look: typeof state.look === "string" ? state.look : null }, { actor: user.email });
    if (!r.ok) {
      if (r.error === "too-big") return { error: t("appearance.cz.error.big") };
      return { errors: Object.fromEntries(Object.entries(r.errors).map(([id, code]) => [fieldName(id), t(code === "picture" ? "appearance.cz.error.picture" : "appearance.cz.error.invalid")])) };
    }
  }
  // the skin's own options belong to the skin in use: they are saved only when this is it
  if (def.options.length > 0 && (await activeSkinId()) === def.id) {
    await saveSkinOptions(def.options.map((o) => ({ id: o.id, default: o.default, values: o.values })), optionsOf(state), { actor: user.email });
  }
  revalidatePath("/", "layout");
  revalidatePath(APPEARANCE_HREF);
  return { ok: t("appearance.cz.saved") };
}

/** Back to the skin's own: everything, or the controls listed. */
export async function resetCustomizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const skinId = String(fd.get("skin") ?? "");
  if (!SKIN_ID_RE.test(skinId) || fd.get("what") !== "all") return { error: t("error.generic") };
  const def = await definitionOf(skinId);
  if (!def?.customize) return { error: t("appearance.cz.unavailable") };
  await resetCustom({ id: def.id, version: def.version, customize: def.customize }, "all", { actor: user.email });
  if (def.options.length > 0 && (await activeSkinId()) === def.id) await saveSkinOptions(def.options.map((o) => ({ id: o.id, default: o.default, values: o.values })), {}, { actor: user.email });
  revalidatePath("/", "layout");
  revalidatePath(APPEARANCE_HREF);
  return { ok: t("appearance.cz.resetDone") };
}

export type DraftView = { ok: true; css: string; signals: Signal[]; values: Record<string, unknown> } | { ok: false };

/** The live preview: the draft composed like the public render. Writes nothing. */
export async function previewDraftAction(skinId: string, state: unknown): Promise<DraftView> {
  await adminCtx("admin");
  if (!SKIN_ID_RE.test(String(skinId))) return { ok: false };
  const s = asRecord(state);
  const c = await composeDraft(String(skinId), { values: asRecord(s.values), look: typeof s.look === "string" ? s.look : null }, optionsOf(s));
  if (!c) return { ok: false };
  return { ok: true, css: c.css, signals: c.signals, values: c.resolved.values };
}
