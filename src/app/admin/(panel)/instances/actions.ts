"use server";

import { retryInstanceMigration } from "@/core/modules/dataMigrations";
import { isHexColor, themeRef } from "@/core/color";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { DISPLAYS, FEATURES } from "@/core/instances";
import { deleteInstance, validateBasePath } from "@/core/instanceService";
import { checkNickname } from "@/core/instanceLabel";
import { instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { defaultPlacement, parsePlacement, placementSettingKey } from "@/core/modules/menuPlacement";
import { groupFlagName, judgeGroup } from "@/core/modules/groups";
import { isValidLink, resolveDefault, shouldStore } from "@/core/modules/settingValues";
import { localized } from "@/core/modules/types";
import { getModule } from "@/core/modules/registry";
import { getSources, providersOf, setSources } from "@/core/services/topics";
import { audit } from "@/core/permissions";
import { deleteSetting, getSettingByLocale, getSiteConfig, setSetting } from "@/core/settings";
import { mcpInstanceKey } from "@/core/modules/mcpProvider";
import { isSort, sortSettingKey } from "@/core/content/sort";
import type { ActionState } from "@/components/admin/ActionForm";

function parseFieldSchema(raw: string) {
  const out: { key: string; label: string; type: "text" | "url" | "number" | "boolean" | "ref"; topic?: string }[] = [];
  for (const line of raw.split("\n")) {
    const [key = "", label = "", type = "text"] = line.split("|").map((s) => s.trim());
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(key) || !label) continue;
    // "ref:<sujet>" : référence vers un élément d'un autre module (ex. ref:partnership.partner).
    const topic = type.startsWith("ref:") ? type.slice(4) : undefined;
    if (topic !== undefined && !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/.test(topic)) continue;
    out.push(topic ? { key, label, type: "ref", topic } : { key, label, type: (["text", "url", "number", "boolean"] as const).find((x) => x === type) ?? "text" });
  }
  return out.slice(0, 20);
}

/** Réglages généraux d'une instance : noms, chemin public, menu, et — pour les modules à contenu — présentation. */
export async function saveInstance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.moduleInstance.findUnique({ where: { id } });
  const mod = existing ? await getModule(existing.moduleId) : null;
  if (!existing || !mod) return { error: t("error.generic") };

  // La version simplifiée de l'admin n'envoie pas les réglages techniques : on ne touche alors qu'à ce qui a été montré.
  const adv = formData.get("__adv") === "1";
  const data: Record<string, unknown> = {
    enabled: formData.get("enabled") === "on",
  };
  // Surnom : envoyé seulement quand il y a plusieurs instances du module ; unique parmi elles.
  if (formData.get("nickname") !== null) {
    const others = (await prisma.moduleInstance.findMany({ where: { moduleId: existing.moduleId, NOT: { id } } })).map((o) => o.nickname).filter((n): n is string => !!n);
    const res = checkNickname(String(formData.get("nickname")), others);
    if (!res.ok) return { error: t(`instances.error.nickname.${res.reason}`) };
    data.nickname = res.value;
  }
  // Épingler au menu / ranger dans Intégrations : un choix différent de ce qui était affiché est mémorisé ; revenir à la règle par défaut l'efface.
  const placement = parsePlacement(formData.get("placement"));
  if (placement && placement !== parsePlacement(formData.get("placement_was"))) {
    if (placement === defaultPlacement(mod.manifest)) await deleteSetting(placementSettingKey(id));
    else await setSetting(placementSettingKey(id), placement);
  }
  if (hasPage(mod.manifest)) data.showInNav = formData.get("showInNav") === "on";

  if (adv) await setSetting(mcpInstanceKey(id), formData.get("mcp") === "on");
  if (adv) data.navOrder = Math.trunc(Number(formData.get("navOrder"))) || 0;

  // Ordre d'affichage des entrées : proposé dans les deux modes pour les modules à contenu.
  if (mod.manifest.content && isSort(formData.get("sort"))) await setSetting(sortSettingKey(id), String(formData.get("sort")));

  if (adv && hasPage(mod.manifest)) {
    const basePath = String(formData.get("basePath") ?? "").trim().toLowerCase();
    const error = await validateBasePath(basePath, id);
    if (error) return { error: t(error) };
    data.basePath = basePath;
  }

  if (adv && mod.manifest.content) {
    const display = String(formData.get("display"));
    if (!(DISPLAYS as readonly string[]).includes(display)) return { error: t("error.generic") };
    Object.assign(data, {
      display,
      clickAction: formData.get("clickAction") === "external" ? "external" : "detail",
      features: JSON.stringify(FEATURES.filter((f) => formData.get(`feature_${f}`) === "on")),
      fieldSchema: JSON.stringify(parseFieldSchema(String(formData.get("fieldSchema") ?? ""))),
      fallbackToDefault: formData.get("fallbackToDefault") === "on",
      allowGoLinks: formData.get("allowGoLinks") === "on",
      exposed: formData.get("exposed") === "on",
    });
  }

  for (const locale of config.locales) {
    const name = String(formData.get(`name_${locale}`) ?? "").trim();
    const description = String(formData.get(`description_${locale}`) ?? "").trim();
    if (!name) {
      if (locale === config.defaultLocale) return { error: t("instances.error.name") };
      await prisma.instanceTranslation.deleteMany({ where: { instanceId: id, locale } });
      continue;
    }
    await prisma.instanceTranslation.upsert({
      where: { instanceId_locale: { instanceId: id, locale } },
      create: { instanceId: id, locale, name, description },
      update: { name, description },
    });
  }

  await prisma.moduleInstance.update({ where: { id }, data });
  await audit(user.email, "instance.update", existing.key);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

/** Réglages déclarés par le manifeste du module, propres à cette instance. */
export async function saveInstanceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const instance = await prisma.moduleInstance.findUnique({ where: { id } });
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) return { error: t("error.generic") };

  const adv = formData.get("__adv") === "1";
  const L = (v: Parameters<typeof localized>[0]) => localized(v, config.defaultLocale, config.defaultLocale);
  const siteByLocale = Object.fromEntries(await Promise.all(config.locales.map(async (l) => { const c = await getSiteConfig(l); return [l, { name: c.name, tagline: c.tagline }] as const; })));
  /** Opérations à appliquer : on contrôle TOUT avant d'écrire quoi que ce soit (une erreur n'enregistre rien). */
  const ops: ({ key: string; locale?: string } & ({ del: true } | { del?: false; value: unknown }))[] = [];

  // Groupes facultatifs : « Retirer » efface tout le groupe ; ouvert, il faut que les champs obligatoires soient remplis.
  const cleared = new Set<string>();
  for (const group of mod.manifest.optionalGroups ?? []) {
    const filled: Record<string, boolean> = {};
    for (const key of group.fields) {
      const f = mod.manifest.settings.find((x) => x.key === key);
      if (!f) continue;
      if (f.advanced && !adv) { filled[key] = true; continue; } // réglage non montré : on ne l'exige pas
      const name = f.translatable ? `s__${key}__${config.defaultLocale}` : `s__${key}`;
      const raw = String(formData.get(name) ?? "").trim();
      filled[key] = raw !== "" || (f.type === "secret" && Boolean((await getSettingByLocale(instanceSettingKey(id, key)))[""]));
    }
    const verdict = judgeGroup(group, formData.get(groupFlagName(group.id)) as string | null, filled);
    if (verdict.action === "error") {
      const names = verdict.missing.map((k) => L(mod.manifest.settings.find((x) => x.key === k)?.label)).join(", ");
      return { error: t("instances.error.groupRequired", { group: L(group.label), fields: names }) };
    }
    if (verdict.action === "clear") {
      for (const key of group.fields) { cleared.add(key); ops.push({ key: instanceSettingKey(id, key), del: true }); }
    }
  }

  for (const field of mod.manifest.settings) {
    if (field.advanced && !adv) continue; // réglage technique non montré : on garde sa valeur
    if (cleared.has(field.key)) continue; // groupe retiré : déjà effacé
    const locales = field.translatable ? config.locales : [""];
    for (const locale of locales) {
      const name = field.translatable ? `s__${field.key}__${locale}` : `s__${field.key}`;
      const key = instanceSettingKey(id, field.key);
      const op = (value: unknown) => ops.push({ key, locale, value });
      const del = () => ops.push({ key, locale, del: true });
      if (field.type === "boolean") { op(formData.get(name) === "on"); continue; }
      const raw = String(formData.get(name) ?? "").trim();
      // Couleur qui suit le thème du site : on ne garde aucune valeur propre, le thème s'applique en direct.
      if (field.type === "color" && themeRef(field.default) && formData.get(`${name}__theme`) === "on") { del(); continue; }
      if (field.type === "color" && raw !== "" && !isHexColor(raw)) return { error: t("error.generic") };
      // Un secret laissé vide est conservé tel quel.
      if (field.type === "secret" && raw === "") continue;
      // Vide, ou identique au défaut qui suit le site (nom, accroche) : rien n'est enregistré, le champ continue de suivre le site.
      if (!shouldStore(field, raw, resolveDefault(field, siteByLocale[field.translatable ? locale : config.defaultLocale] ?? { name: "", tagline: "" }))) { del(); continue; }
      if (field.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { error: t("error.generic") };
        op(n);
      } else if (field.type === "select") {
        if (!field.options?.some((o) => o.value === raw)) return { error: t("error.generic") };
        op(raw);
      } else if (field.type === "video") {
        if (!/^\/uploads\/[0-9a-f-]{36}\.(mp4|webm)$/.test(raw)) return { error: t("error.badUrl") };
        op(raw);
      } else if (field.type === "image") {
        if (!/^(https?:\/\/|\/uploads\/)/i.test(raw)) return { error: t("error.badUrl") };
        op(raw);
      } else if (field.type === "url") {
        if (!/^https?:\/\//i.test(raw)) return { error: t("error.badUrl") };
        op(raw);
      } else if (field.type === "link") {
        if (!isValidLink(raw)) return { error: t("instances.error.link", { field: L(field.label) }) };
        op(raw);
      } else {
        op(raw.slice(0, 5000));
      }
    }
  }
  for (const o of ops) {
    if (o.del) await deleteSetting(o.key, o.locale);
    else await setSetting(o.key, o.value, o.locale);
  }
  await audit(user.email, "instance.settings", instance.key);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

/** « Réessayer » : relance la migration des données d'une instance mise à l'écart. */
export async function retryMigrationAction(id: string): Promise<void> {
  await adminCtx("admin");
  await retryInstanceMigration(id);
  revalidatePath("/", "layout");
  redirect(`/admin/instances/${id}`);
}

export async function deleteInstanceAction(id: string): Promise<void> {
  const { user } = await adminCtx("admin");
  const row = await prisma.moduleInstance.findUnique({ where: { id } });
  if (!row) return;
  await deleteInstance(id);
  await audit(user.email, "instance.delete", row.key);
  revalidatePath("/", "layout");
  redirect("/admin/modules");
}

/**
 * Abonnements d'une instance consommatrice : pour chaque sujet qu'elle digère, quelles
 * instances fournisseuses l'alimentent (et, si le module le permet, quelles étiquettes).
 * Tout coché = « toutes les sources », y compris celles installées plus tard.
 */
export async function saveSources(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx("admin");
  const id = String(formData.get("id") ?? "");
  const instance = await prisma.moduleInstance.findUnique({ where: { id } });
  const mod = instance ? await getModule(instance.moduleId) : null;
  if (!instance || !mod) return { error: t("error.generic") };

  for (const [i, decl] of (mod.manifest.consumes ?? []).entries()) {
    const available = (await providersOf(decl.topic)).map((p) => p.instance.key);
    const chosen = formData.getAll(`sources_${i}`).map(String).filter((k) => available.includes(k));
    const adv = formData.get("__adv") === "1";
    const previous = await getSources(id, decl.topic);
    const tags = !adv
      ? previous.tags
      : decl.tags
      ? String(formData.get(`tags_${i}`) ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];
    await setSources(id, decl.topic, { instances: chosen.length === available.length ? null : chosen, tags });
  }
  await audit(user.email, "instance.sources", instance.key);
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}

