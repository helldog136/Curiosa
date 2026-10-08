"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { setSetting, type NavItem } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";
import type { ActionState } from "@/components/admin/ActionForm";
import { listMenuPages } from "./pages";

const MAX_ITEMS = 40;

/**
 * Enregistre le menu : une liste ordonnée qui mélange pages du site et liens libres. Pour une page, l'adresse et les libellés viennent de
 * la base (jamais du navigateur) ; pour un lien, l'adresse est validée et au moins un libellé est exigé.
 */
export async function saveNavigation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t, config } = await adminCtx("admin");
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get("items") ?? "[]")); } catch { return { error: t("error.generic") }; }
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return { error: t("error.generic") };

  const known = new Map((await listMenuPages(config.defaultLocale)).map((p) => [p.id, p]));
  const titles = await prisma.entryTranslation.findMany({ where: { entryId: { in: [...known.keys()] } }, select: { entryId: true, locale: true, title: true } });
  const items: NavItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw as Record<string, unknown>[]) {
    if (entry?.k === "page") {
      const page = known.get(String(entry.id));
      if (!page || seen.has(page.id)) continue;
      seen.add(page.id);
      const label: Record<string, string> = {};
      for (const l of config.locales) label[l] = titles.find((x) => x.entryId === page.id && x.locale === l)?.title ?? page.title;
      items.push({ href: page.href, label });
    } else if (entry?.k === "link") {
      const href = String(entry.href ?? "").trim();
      const labels = (entry.label && typeof entry.label === "object" ? entry.label : {}) as Record<string, unknown>;
      const label: Record<string, string> = {};
      for (const l of config.locales) { const v = String(labels[l] ?? "").trim().slice(0, 80); if (v) label[l] = v; }
      // Un lien entièrement vide (ajouté puis laissé tel quel) est simplement ignoré.
      if (!href && Object.keys(label).length === 0) continue;
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!href || (!internal && !isSafeExternalUrl(href))) return { error: t("error.badUrl") };
      if (Object.keys(label).length === 0) return { error: t("navigation.error.label") };
      items.push({ href, label });
    }
  }
  await setSetting("nav.custom", items);
  await audit(user.email, "navigation.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
