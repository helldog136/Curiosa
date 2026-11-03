"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { audit } from "@/core/permissions";
import { PER_PAGE_DEFAULT, PER_PAGE_MAX, PER_PAGE_MIN, isSearchPlacement } from "@/core/search/config";
import { searchableTypes } from "@/core/search";
import { deleteSetting, setSetting } from "@/core/settings";
import type { ActionState } from "@/components/admin/ActionForm";

/**
 * Réglages de la recherche dans le site (docs/PLATFORM.md). Les trois options (où placer le champ, résultats par page, contenus cherchés) sont toujours envoyées,
 * repliées ou non : rien n'est perdu. Une valeur invalide n'enregistre RIEN et l'erreur s'affiche sous le champ, avec un exemple.
 */
export async function saveSearch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, locale } = await adminCtx("admin");
  const enabled = formData.get("searchEnabled") === "on";

  const place = String(formData.get("searchPlacement") ?? "header");
  if (!isSearchPlacement(place)) return { errors: { searchPlacement: t("error.generic") } };

  // Résultats par page : vide = la valeur d'origine (10) ; sinon un entier de 5 à 50.
  const rawPerPage = String(formData.get("searchPerPage") ?? "").trim();
  let perPage: number | null = null;
  if (rawPerPage !== "") {
    perPage = /^\d{1,3}$/.test(rawPerPage) ? Number(rawPerPage) : NaN;
    if (!(perPage >= PER_PAGE_MIN && perPage <= PER_PAGE_MAX)) return { errors: { searchPerPage: t("settings.searchPerPageError", { min: PER_PAGE_MIN, max: PER_PAGE_MAX, example: PER_PAGE_DEFAULT }) } };
  }

  // Contenus cherchés : ce qui est décoché est écarté. Au moins un doit rester coché (sinon la recherche ne trouverait jamais rien).
  const types = await searchableTypes(locale);
  let exclude: string[] = [];
  if (formData.get("searchTypes__multi") === "1" && types.length > 0) {
    const kept = new Set(formData.getAll("searchTypes").map(String));
    exclude = types.filter((x) => !kept.has(x.key)).map((x) => x.key);
    if (exclude.length === types.length) return { errors: { searchTypes__group: t("settings.searchTypesError", { example: types[0]!.label }) } };
  }

  await setSetting("search.enabled", enabled);
  await setSetting("search.placement", place);
  if (perPage === null) await deleteSetting("search.perPage"); else await setSetting("search.perPage", perPage);
  if (exclude.length === 0) await deleteSetting("search.exclude"); else await setSetting("search.exclude", exclude);
  await audit(user.email, "settings.search");
  revalidatePath("/", "layout");
  return { ok: t("settings.searchSaved") };
}
