"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { overlayPageSkinHref } from "@/core/adminLinks";
import { audit } from "@/core/permissions";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { listContextValues } from "@/core/overlays/context";
import { updateLook } from "@/core/overlays/lookService";
import { LABEL_MAX, VALUE_MAX, upsertRule } from "@/core/overlays/look";
import { getPage } from "@/core/overlays/store";
import { clearSkinCatalogueCache } from "@/core/skins/catalogue";
import * as skins from "@/core/skins/service";
import type { ActionState } from "@/components/admin/ActionForm";
import type { SwitchResult } from "@/components/admin/Switch";

/** Admin actions of the skin tab. Same rules as the other overlay actions: the admin tier is required first, everything from the form is validated again on the server. */
const text = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const here = (id: string) => overlayPageSkinHref(text(id, 40));

/** (0.10.1) "Refresh the list": reads the skin catalogue again right now (otherwise at most every 15 minutes), previews and animated previews included. */
export async function refreshSkinCatalogueAction(id: string): Promise<void> {
  await adminCtx(OVERLAY_NEED);
  clearSkinCatalogueCache();
  await skins.listCatalogue({ kind: "overlay", fresh: true }).catch(() => null);
  revalidatePath(here(id));
  redirect(`${here(id)}?ok=refreshed`);
}

export async function setPageSkinAction(id: string, skin: string): Promise<void> {
  const { user, locale, config } = await adminCtx(OVERLAY_NEED);
  const r = await updateLook(text(id, 40), (cur) => ({ ...cur, skin: skin || null }), locale, config.defaultLocale);
  if (!r.ok) redirect(`${here(id)}${here(id).includes("?") ? "&" : "?"}e=skin`);
  await audit(user.email, "overlay.skin", text(id, 40));
  revalidatePath(here(id));
  redirect(`${here(id)}?ok=skin`);
}

export async function toggleByContextAction(id: string, instance: string, context: string, enabled: boolean): Promise<SwitchResult> {
  const { user, t, locale, config } = await adminCtx(OVERLAY_NEED);
  const r = await updateLook(text(id, 40), (cur) => ({ ...cur, byContext: { ...cur.byContext, enabled: enabled === true, instance: text(instance, 60) || cur.byContext.instance, context: text(context, 60) || cur.byContext.context } }), locale, config.defaultLocale);
  if (!r.ok) return { error: t("ovp.skin.err.generic") };
  await audit(user.email, enabled ? "overlay.skin.context.on" : "overlay.skin.context.off", text(id, 40));
  revalidatePath(here(id));
  return { ok: t("ovp.skin.saved") };
}

export async function chooseContextAction(id: string, instance: string, context: string): Promise<void> {
  const { user, locale, config } = await adminCtx(OVERLAY_NEED);
  await updateLook(text(id, 40), (cur) => ({ ...cur, byContext: { ...cur.byContext, instance: text(instance, 60), context: text(context, 60), rules: [] } }), locale, config.defaultLocale);
  await audit(user.email, "overlay.skin.context", text(id, 40));
  revalidatePath(here(id));
  redirect(here(id));
}

/** Saves one rule (a game and its skin). Errors come back under the fields. */
export async function saveRuleAction(id: string, previousValue: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale, config } = await adminCtx(OVERLAY_NEED);
  const value = text(formData.get("value"), VALUE_MAX).trim(), label = text(formData.get("label"), LABEL_MAX).trim(), skin = text(formData.get("skin"), 41);
  const errors: Record<string, string> = {};
  if (!value) errors.value = t("ovp.skin.err.value");
  if (!skin) errors.skin = t("ovp.skin.err.skin");
  if (Object.keys(errors).length) return { error: t("ovp.skin.err.fields"), errors };
  const r = await updateLook(text(id, 40), (cur) => {
    const base = previousValue && previousValue !== value ? { ...cur, byContext: { ...cur.byContext, rules: cur.byContext.rules.filter((x) => x.value !== previousValue) } } : cur;
    const exists = !previousValue && base.byContext.rules.some((x) => x.value === value);
    return exists ? { ...base, byContext: { ...base.byContext, rules: [...base.byContext.rules, { value, label, skin }] } } : upsertRule(base, { value, label: label || value, skin });
  }, locale, config.defaultLocale);
  if (!r.ok) {
    const dup = r.ok === false && r.issues.some((i) => i.code === "duplicate");
    const bad = r.ok === false && r.issues.some((i) => i.code === "ruleSkin");
    return { error: t("ovp.skin.err.fields"), errors: { ...(dup ? { value: t("ovp.skin.err.duplicate") } : {}), ...(bad ? { skin: t("ovp.skin.err.skin") } : {}), ...(!dup && !bad ? { value: t("ovp.skin.err.generic") } : {}) } };
  }
  await audit(user.email, "overlay.skin.rule", text(id, 40));
  revalidatePath(here(id));
  return { ok: t("ovp.skin.saved") };
}

export async function removeRuleAction(id: string, value: string): Promise<void> {
  const { user, locale, config } = await adminCtx(OVERLAY_NEED);
  await updateLook(text(id, 40), (cur) => ({ ...cur, byContext: { ...cur.byContext, rules: cur.byContext.rules.filter((r) => r.value !== text(value, VALUE_MAX)) } }), locale, config.defaultLocale);
  await audit(user.email, "overlay.skin.rule.remove", text(id, 40));
  revalidatePath(here(id));
  redirect(`${here(id)}?ok=removed`);
}

export async function installOverlaySkinAction(id: string, skinId: string): Promise<void> {
  const { user } = await adminCtx(OVERLAY_NEED);
  const r = await skins.installFromCatalogue(text(skinId, 41), { actor: user.email });
  revalidatePath(here(id));
  redirect(`${here(id)}${r.ok ? "?ok=installed" : "?e=install"}`);
}

/** Values the picker offers (searched by the person), for a page whose context is chosen. */
export async function searchValuesAction(id: string, query: string): Promise<{ id: string; name: string }[]> {
  await adminCtx(OVERLAY_NEED);
  const page = await getPage(text(id, 40));
  const b = page?.look.byContext;
  if (!b?.instance || !b.context) return [];
  return listContextValues({ instance: b.instance, context: b.context }, text(query, 80), 30);
}
