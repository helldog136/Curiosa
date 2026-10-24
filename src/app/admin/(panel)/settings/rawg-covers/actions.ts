"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { auditFix, chooseGame, chooseImage, chooseNone, confirmCurrent, forget, forgetAll, fixSummary, type FixError, type FixOutcome } from "@/core/rawgAdmin";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Actions de l'écran « Jaquettes à vérifier » : réservées aux administrateurs (`adminCtx("admin")` en tête de chacune), une cadence limitée par personne,
 * des valeurs validées par le cœur (rawgAdmin.ts). Le jeu se choisit par son NUMÉRO : l'image vient de la réponse de RAWG, jamais du navigateur.
 */
const LIST = "/admin/settings/rawg-covers";
const text = (fd: FormData, name: string, max = 400): string => { const v = fd.get(name); return typeof v === "string" ? v.slice(0, max) : ""; };

type Ctx = Awaited<ReturnType<typeof adminCtx>>;
async function done(ctx: Ctx, out: FixOutcome, saved: "game" | "none" | "image" | "confirm", field?: string): Promise<ActionState> {
  if (!out.ok) {
    const message = ctx.t(`rawgfix.err.${out.error satisfies FixError}`);
    return field && (out.error === "image" || out.error === "title") ? { errors: { [field]: message } } : { error: message };
  }
  await auditFix(ctx.user.email, "rawg.fix", fixSummary(out.fix));
  revalidatePath(LIST);
  revalidatePath("/admin/settings");
  redirect(`${LIST}?saved=${saved}`);
}

/** « C'est ce jeu » */
export async function chooseGameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  const id = Number(text(formData, "rawgId", 12));
  return done(ctx, await chooseGame(ctx.user.id, text(formData, "title"), id, text(formData, "q", 100) || undefined), "game");
}

/** « Aucune jaquette » */
export async function chooseNoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  return done(ctx, await chooseNone(ctx.user.id, text(formData, "title")), "none");
}

/** Image au choix (mode avancé) : une adresse `https://media.rawg.io/media/…`, rien d'autre. */
export async function chooseImageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  return done(ctx, await chooseImage(ctx.user.id, text(formData, "title"), text(formData, "imageUrl")), "image", "imageUrl");
}

/** « Ce choix est bon » : on garde le jeu trouvé tel quel. */
export async function confirmAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  return done(ctx, await confirmCurrent(ctx.user.id, text(formData, "title")), "confirm");
}

/** « Oublier » : le titre retrouve le choix automatique. */
export async function forgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  const key = text(formData, "key", 160);
  const ok = await forget(ctx.user.id, key);
  if (!ok) return { error: ctx.t("rawgfix.err.forget") };
  await auditFix(ctx.user.email, "rawg.fix.forget", key);
  revalidatePath(LIST);
  redirect(`${LIST}?saved=forgot`);
}

/** « Tout oublier » (après confirmation dans la page). */
export async function forgetAllAction(): Promise<ActionState> {
  const ctx = await adminCtx("admin");
  const n = await forgetAll(ctx.user.id);
  if (n === null) return { error: ctx.t("rawgfix.err.rate") };
  await auditFix(ctx.user.email, "rawg.fix.forgetAll", String(n));
  revalidatePath(LIST);
  redirect(`${LIST}?saved=forgot`);
}
