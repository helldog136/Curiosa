"use server";

import { adminCtx } from "@/core/admin";
import { isCatalogGroup, searchCatalog, type CatalogPage } from "@/core/menuCatalog";

export type SearchReply = { ok: true; page: CatalogPage } | { ok: false };

/** Cherche dans un groupe du catalogue du menu (accents et majuscules ignorés), par pages bornées. Réservé à ceux qui peuvent composer le menu. */
export async function searchMenu(group: string, query: string, cursor: string | null): Promise<SearchReply> {
  const { t, locale, config } = await adminCtx("admin");
  if (!isCatalogGroup(group)) return { ok: false };
  try {
    return { ok: true, page: await searchCatalog(group, query, cursor, { t, locale, defaultLocale: config.defaultLocale }) };
  } catch (error) {
    console.error("[menu] catalog search failed:", (error as Error)?.name);
    return { ok: false };
  }
}
