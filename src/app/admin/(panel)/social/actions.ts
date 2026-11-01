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
import { createInstance, defaultNames, runInstanceCreateHook } from "@/core/instanceService";
import { getInstanceById } from "@/core/instances";
import { instanceSettingKey } from "@/core/modules/context";
import { isSocialProfileField, previewSocialButton, SOCIAL_PROFILE_KEY } from "@/core/socialCheck";
import { addInstance } from "../modules/actions";

/** Un module de réseau : il fournit son bouton (`social.link`) et son adresse se règle dans `profile`. */
const isSocialNetwork = (mod: NonNullable<Awaited<ReturnType<typeof getModule>>>) => isSocialProfileField(mod, SOCIAL_PROFILE_KEY);

/**
 * Les surnoms d'un deuxième compte du même réseau, donnés d'office (« Instagram », « Instagram 2 ») : la personne ne tape rien, elle pourra les changer dans « Modifier ».
 * `forExisting` : les instances qui n'ont pas encore de surnom ; `forNew` : celui de la nouvelle ; `null` tant qu'il n'y a pas d'instance.
 */
async function autoNicknames(moduleId: string, name: string): Promise<{ forExisting: Map<string, string>; forNew: string } | null> {
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId } });
  if (existing.length === 0) return null;
  const taken: string[] = existing.map((e) => e.nickname).filter((n): n is string => Boolean(n));
  const forExisting = new Map<string, string>();
  for (const e of existing) {
    if (e.nickname) continue;
    const given = taken.length === 0 ? name : suggestNickname(name, taken);
    taken.push(given);
    forExisting.set(e.id, given);
  }
  return { forExisting, forNew: suggestNickname(name, taken) };
}

/**
 * Ajoute un réseau social : installe son module s'il ne l'est pas encore (réservé au propriétaire : c'est du code exécuté sur le serveur),
 * puis en crée une instance. Pour un deuxième compte du même réseau, les surnoms sont donnés d'office.
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
  if (mod) {
    const names = await autoNicknames(moduleId, localized(mod.manifest.name, config.defaultLocale, config.defaultLocale));
    if (names) {
      for (const [id, given] of names.forExisting) form.set(`nickname_${id}`, given);
      form.set("nickname", names.forNew);
    }
  }
  await addInstance(moduleId, form);
}

/** Le résultat d'un réseau ajouté par le champ unique : le bouton qui s'affichera, ou ce qui s'est passé (le réseau peut être ajouté sans que l'adresse convienne : `added`). */
export type PasteResult = { ok: true; label: string } | { ok: false; error: string; added?: boolean };

/**
 * UN réseau du champ « Collez l'adresse de votre profil » : installe le module si besoin, crée l'instance (sans redirection), écrit l'adresse et vérifie ce que le module
 * en fait. Appelée une fois par réseau, dans l'ordre, par la page (progression « 2 sur 6 ») : un échec n'empêche pas les autres. Réservé au propriétaire (installation).
 */
export async function addNetworkWithProfile(moduleId: string, address: string): Promise<PasteResult> {
  const { user, t, config } = await adminCtx({ right: "core:modules.install" });
  const raw = typeof address === "string" ? address.trim() : "";
  if (!raw || raw.length > 300 || typeof moduleId !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(moduleId)) return { ok: false, error: t("error.generic") };
  if (!(await getModule(moduleId))) {
    const installed = await installFromCatalogue(moduleId);
    if (!installed.ok) return { ok: false, error: installed.error.startsWith("modules.error.") ? t(installed.error, { service: "" }) : t("error.generic") };
    await audit(user.email, "module.install", moduleId);
  }
  const mod = await getModule(moduleId);
  if (!mod || !isSocialNetwork(mod)) return { ok: false, error: t("social.paste.notNetwork") };
  const name = localized(mod.manifest.name, config.defaultLocale, config.defaultLocale);
  const names = await autoNicknames(moduleId, name);
  if (names) for (const [id, given] of names.forExisting) await prisma.moduleInstance.update({ where: { id }, data: { nickname: given } });
  const created = await createInstance(prisma, { manifest: mod.manifest, nickname: names?.forNew, names: names ? defaultNames(mod.manifest, config.locales, names.forNew) : defaultNames(mod.manifest, config.locales) });
  await runInstanceCreateHook(created.id);
  await audit(user.email, "instance.create", created.key);
  const view = await getInstanceById(created.id);
  const button = view ? await previewSocialButton(mod, view, raw, config.defaultLocale) : null;
  revalidatePath("/", "layout");
  // Le module ne reconnaît pas l'adresse (une version plus ancienne que le catalogue, par exemple) : le réseau est ajouté « à régler », rien n'est enregistré.
  if (!button) return { ok: false, added: true, error: t("social.paste.fix", { name }) };
  await setSetting(instanceSettingKey(created.id, SOCIAL_PROFILE_KEY), raw);
  await audit(user.email, "instance.settings", created.key, { module: moduleId, instance: created.key });
  revalidatePath("/", "layout");
  return { ok: true, label: button.label };
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
