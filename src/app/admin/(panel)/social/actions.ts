"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { installFromCatalogue } from "@/core/modules/installer";
import { getModule } from "@/core/modules/registry";
import { suggestNickname } from "@/core/instanceLabel";
import { audit } from "@/core/permissions";
import { getSetting, setSetting } from "@/core/settings";
import { providersOf } from "@/core/services/topics";
import { moveKey, orderedKeys, readSocialPrefs, SOCIAL_HIDDEN_KEY, SOCIAL_ORDER_KEY, SOCIAL_TOPIC } from "@/core/social";
import { localized } from "@/core/modules/types";
import { addInstance } from "../modules/actions";

/**
 * Ajoute un réseau social : installe son module s'il ne l'est pas encore (réservé au propriétaire : c'est du code exécuté sur le serveur),
 * puis en crée une instance. Pour un deuxième compte du même réseau, les surnoms sont donnés d'office (« Instagram », « Instagram 2 ») : la personne ne tape rien,
 * elle pourra les changer dans « Modifier ».
 */
export async function addNetwork(moduleId: string): Promise<void> {
  const { user, config } = await adminCtx({ right: "core:modules.install" });
  if (!(await getModule(moduleId))) {
    const installed = await installFromCatalogue(moduleId);
    if (!installed.ok) redirect(`/admin/social?error=${encodeURIComponent(installed.error)}`);
    await audit(user.email, "module.install", moduleId);
  }
  const mod = await getModule(moduleId);
  const form = new FormData();
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId } });
  if (mod && existing.length > 0) {
    const name = localized(mod.manifest.name, config.defaultLocale, config.defaultLocale);
    const taken: string[] = existing.map((e) => e.nickname).filter((n): n is string => Boolean(n));
    for (const e of existing) {
      if (e.nickname) continue;
      const given = taken.length === 0 ? name : suggestNickname(name, taken);
      taken.push(given);
      form.set(`nickname_${e.id}`, given);
    }
    form.set("nickname", suggestNickname(name, taken));
  }
  await addInstance(moduleId, form);
}

/** L'interrupteur « Affiché » d'une ligne : masque ou montre le bouton dans l'en-tête, sans rien supprimer. */
export async function setSocialShown(instanceKey: string, shown: boolean): Promise<{ ok?: string; error?: string }> {
  const { user, t } = await adminCtx("admin");
  const known = (await providersOf(SOCIAL_TOPIC)).some((p) => p.instance.key === instanceKey);
  if (!known) return { error: t("social.gone") };
  const { hidden } = await readSocialPrefs();
  if (shown) hidden.delete(instanceKey); else hidden.add(instanceKey);
  await setSetting(SOCIAL_HIDDEN_KEY, [...hidden].sort());
  await audit(user.email, shown ? "social.show" : "social.hide", instanceKey);
  revalidatePath("/", "layout");
  return { ok: t(shown ? "social.nowShown" : "social.nowHidden") };
}

/** « Monter » / « Descendre » : un cran, au clavier comme à la souris. L'ordre enregistré couvre tous les réseaux. */
export async function moveSocial(instanceKey: string, direction: "up" | "down"): Promise<void> {
  const { user } = await adminCtx("admin");
  const all = (await providersOf(SOCIAL_TOPIC)).map((p) => p.instance.key).sort((a, b) => a.localeCompare(b));
  const order = orderedKeys(all, ((await getSetting<unknown>(SOCIAL_ORDER_KEY)) as string[] | undefined) ?? []);
  const moved = moveKey(order, instanceKey, direction);
  await setSetting(SOCIAL_ORDER_KEY, moved);
  await audit(user.email, "social.move", instanceKey);
  revalidatePath("/", "layout");
  redirect("/admin/social");
}
