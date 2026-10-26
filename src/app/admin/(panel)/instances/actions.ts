"use server";

import { retryInstanceMigration } from "@/core/modules/dataMigrations";
import { isHexColor, themeRef } from "@/core/color";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { DISPLAYS, FEATURES, getInstanceById } from "@/core/instances";
import { removeInstance, validateBasePath } from "@/core/instanceService";
import { noticeFor, removalNoticeHref } from "@/core/modules/removal";
import { checkNickname } from "@/core/instanceLabel";
import { instanceSettingKey } from "@/core/modules/context";
import { hasPage } from "@/core/modules/manifest";
import { menuEligible } from "@/core/modules/menuEligibility";
import { setInstanceInMenu } from "@/core/menuStore";
import { defaultPlacement, parsePlacement, placementSettingKey, placementsFor } from "@/core/modules/menuPlacement";
import { groupFlagName, judgeGroup } from "@/core/modules/groups";
import { checkFieldInput, checkMultiInput, resolveDefault, shouldStore } from "@/core/modules/settingValues";
import { localized } from "@/core/modules/types";
import { getModule } from "@/core/modules/registry";
import { forgetChoices, validateChoices, type ChoiceField } from "@/core/modules/choice";
import { getSources, providersOf, setSources } from "@/core/services/topics";
import { audit } from "@/core/permissions";
import { deleteSetting, getSettingByLocale, getSiteConfig, setSetting } from "@/core/settings";
import { mcpInstanceKey } from "@/core/modules/mcpProvider";
import { isSort, sortSettingKey } from "@/core/content/sort";
import type { ActionState } from "@/components/admin/ActionForm";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { planTabs, settingTab } from "@/core/modules/tabs";

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
  const data: Record<string, unknown> = {};
  // Surnom : envoyé seulement quand il y a plusieurs instances du module ; unique parmi elles.
  if (formData.get("nickname") !== null) {
    const others = (await prisma.moduleInstance.findMany({ where: { moduleId: existing.moduleId, NOT: { id } } })).map((o) => o.nickname).filter((n): n is string => !!n);
    const res = checkNickname(String(formData.get("nickname")), others);
    if (!res.ok) return { errors: { nickname: t(`instances.error.nickname.${res.reason}`) } };
    data.nickname = res.value;
  }
  // Épingler au menu / ranger dans Intégrations : un choix différent de ce qui était affiché est mémorisé ; revenir à la règle par défaut l'efface.
  const placement = parsePlacement(formData.get("placement"));
  if (placement && placementsFor(mod.manifest).includes(placement) && placement !== parsePlacement(formData.get("placement_was"))) {
    if (placement === defaultPlacement(mod.manifest)) await deleteSetting(placementSettingKey(id));
    else await setSetting(placementSettingKey(id), placement);
  }
  // « Afficher dans le menu de mon site » : la case ajoute la page à la fin du menu ou la retire. Le menu (page « Menu du site ») est la seule source de vérité ;
  // la colonne `showInNav` n'est plus lue par le site, on la tient à jour pour qu'un retour à une version plus ancienne garde le même menu.
  if (menuEligible(mod.manifest) && formData.get("nav_was") !== null) {
    const want = formData.get("showInNav") === "on";
    if (want !== (formData.get("nav_was") === "1")) {
      if (!(await setInstanceInMenu(id, want))) return { errors: { showInNav: t("navigation.totalFull") } };
      data.showInNav = want;
    }
  }

  if (adv) await setSetting(mcpInstanceKey(id), formData.get("mcp") === "on");

  // Ordre d'affichage des entrées : proposé dans les deux modes pour les modules à contenu.
  if (mod.manifest.content && isSort(formData.get("sort"))) await setSetting(sortSettingKey(id), String(formData.get("sort")));

  if (adv && hasPage(mod.manifest)) {
    const basePath = String(formData.get("basePath") ?? "").trim().toLowerCase();
    const error = await validateBasePath(basePath, id);
    if (error) return { errors: { basePath: t(error) } };
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
      if (locale === config.defaultLocale) return { errors: { [`name_${locale}`]: t("instances.error.name") } };
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
  // Page en onglets (0.2.2) : chaque onglet envoie SES réglages (`__tab`) ; seuls ceux-là sont lus, les autres gardent leur valeur. Sans `__tab` : tous, comme avant.
  const tab = formData.get("__tab");
  const plan = planTabs(mod.manifest.tabs);
  const inForm = (f: { tab?: string }) => typeof tab !== "string" || settingTab(plan, f) === tab;
  const fields = mod.manifest.settings.filter(inForm);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, config.defaultLocale, config.defaultLocale);
  const siteByLocale = Object.fromEntries(await Promise.all(config.locales.map(async (l) => { const c = await getSiteConfig(l); return [l, { name: c.name, tagline: c.tagline }] as const; })));
  /** Opérations à appliquer : on contrôle TOUT avant d'écrire quoi que ce soit (une erreur n'enregistre rien). */
  const ops: ({ key: string; locale?: string } & ({ del: true } | { del?: false; value: unknown }))[] = [];

  // Groupes facultatifs : « Retirer » efface tout le groupe ; ouvert, il faut que les champs obligatoires soient remplis.
  const cleared = new Set<string>();
  for (const group of mod.manifest.optionalGroups ?? []) {
    // Un groupe est entièrement dans un onglet (règle du manifeste) : on ne juge que ceux de cet onglet.
    if (!group.fields.some((k) => fields.some((f) => f.key === k))) continue;
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
      const message = t("instances.error.groupRequired", { group: L(group.label), fields: names });
      // Sous chaque champ manquant (nom du champ dans le formulaire) ; le message dit aussi lesquels.
      const errors = Object.fromEntries(verdict.missing.map((k) => { const f = mod.manifest.settings.find((x) => x.key === k); return [f?.translatable ? `s__${k}__${config.defaultLocale}` : `s__${k}`, message]; }));
      return { errors };
    }
    if (verdict.action === "clear") {
      for (const key of group.fields) { cleared.add(key); ops.push({ key: instanceSettingKey(id, key), del: true }); }
    }
  }

  /** Réglages « choix parmi » à revérifier auprès de leur fournisseur (asynchrone, borné) avant toute écriture. */
  const choices: { field: ChoiceField; raw: string; key: string }[] = [];
  for (const field of fields) {
    if (field.advanced && !adv) continue; // réglage technique non montré : on garde sa valeur
    if (cleared.has(field.key)) continue; // groupe retiré : déjà effacé
    if (field.type === "choice") {
      // Masqué (aucune ou une seule option, fournisseur muet) : rien n'est envoyé, la valeur est gardée. Inchangé : gardé sans revérifier.
      if (formData.get(`s__${field.key}__choice`) !== "1") continue;
      const key = instanceSettingKey(id, field.key);
      const raw = String(formData.get(`s__${field.key}`) ?? "").trim();
      const current = (await getSettingByLocale(key))[""];
      if (raw === (typeof current === "string" ? current.trim() : "")) continue;
      if (raw === "") ops.push({ key, locale: "", del: true });
      else choices.push({ field, raw, key });
      continue;
    }
    // Plusieurs choix (0.3.0) : des cases à cocher ; le marqueur `__multi` dit que le champ était à l'écran (une liste vide n'envoie rien d'autre).
    if (field.type === "multichoice") {
      if (formData.get(`s__${field.key}__multi`) !== "1") continue;
      const checked = checkMultiInput(field, formData.getAll(`s__${field.key}`).map(String));
      if (!checked.ok) {
        const n = checked.reason === "multichoiceMin" ? field.minChoices ?? 0 : field.maxChoices ?? (field.options ?? []).length;
        const message = checked.reason === "multichoice" ? t("instances.error.multiUnknown", { field: L(field.label) }) : t(checked.reason === "multichoiceMin" ? "instances.error.multiMin" : "instances.error.multiMax", { field: L(field.label), n });
        return { errors: { [`s__${field.key}__group`]: message } };
      }
      ops.push({ key: instanceSettingKey(id, field.key), locale: "", value: checked.value });
      continue;
    }
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
      if (field.type === "color" && raw !== "" && !isHexColor(raw)) return { errors: { [name]: t("error.generic") } };
      // Un secret laissé vide est conservé tel quel.
      if (field.type === "secret" && raw === "") continue;
      // Vide, ou identique au défaut qui suit le site (nom, accroche) : rien n'est enregistré, le champ continue de suivre le site.
      if (!shouldStore(field, raw, resolveDefault(field, siteByLocale[field.translatable ? locale : config.defaultLocale] ?? { name: "", tagline: "" }))) { del(); continue; }
      const checked = checkFieldInput(field, raw);
      if (!checked.ok) {
        const { reason } = checked;
        // Sous le champ fautif (et l'onglet qui le contient s'ouvre de lui-même s'il était caché).
        return { errors: { [name]: reason === "link" ? t("instances.error.link", { field: L(field.label) }) : reason === "video" || reason === "image" || reason === "url" ? t("error.badUrl") : t("error.generic") } };
      }
      op(checked.value);
    }
  }
  // Le navigateur n'envoie qu'un identifiant : on revérifie qu'il est une option actuelle (3 s par champ, 5 s en tout). Délai dépassé : on n'enregistre RIEN.
  if (choices.length) {
    const view = await getInstanceById(id);
    if (!view) return { error: t("error.generic") };
    const checks = await validateChoices({ mod, instance: view }, choices.map((c) => ({ field: c.field, raw: c.raw })), { locale: config.defaultLocale });
    for (const c of choices) {
      const check = checks.get(c.field.key);
      if (!check?.ok) return { errors: { [`s__${c.field.key}`]: t(check?.reason === "timeout" ? "choice.error.verify" : "choice.error.unknown", { field: L(mod.manifest.settings.find((f) => f.key === c.field.key)?.label) }) } };
      // L'unique option n'est jamais écrite : elle reste résolue à l'exécution (une deuxième option fera réapparaître le sélecteur).
      ops.push(check.store === null ? { key: c.key, locale: "", del: true } : { key: c.key, locale: "", value: check.store });
    }
  }
  for (const o of ops) {
    if (o.del) await deleteSetting(o.key, o.locale);
    else await setSetting(o.key, o.value, o.locale);
  }
  forgetChoices(id);
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

/** Retire une instance : « Retirer et garder mes données » (rangées, retrouvables) ou « Retirer et tout effacer » (irréversible). */
export async function deleteInstanceAction(id: string, keepData: boolean): Promise<void> {
  const { user, locale, config } = await adminCtx("admin");
  const row = await prisma.moduleInstance.findUnique({ where: { id } });
  if (!row) return;
  const mod = await getModule(row.moduleId).catch(() => null);
  const name = mod ? localized(mod.manifest.name, locale, config.defaultLocale) : row.key;
  if (!(await removeInstance(id, { keepData }))) return;
  await audit(user.email, keepData ? "instance.retire" : "instance.delete", row.key);
  revalidatePath("/", "layout");
  redirect(removalNoticeHref(EXTENSIONS_HREF, { notice: noticeFor(keepData), name }));
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

