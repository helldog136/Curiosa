"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { setSetting, type NavItem, type NavLeaf } from "@/core/settings";
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
  const seen = new Set<string>();

  /** Un lien ou une page : `null` si l'élément est vide ou en double (ignoré), ou un message d'erreur. */
  const leaf = (entry: Record<string, unknown>): NavLeaf | { error: string } | null => {
    if (entry?.k === "page") {
      const page = known.get(String(entry.id));
      if (!page || seen.has(page.id)) return null;
      seen.add(page.id);
      const label: Record<string, string> = {};
      for (const l of config.locales) label[l] = titles.find((x) => x.entryId === page.id && x.locale === l)?.title ?? page.title;
      return { href: page.href, label };
    }
    if (entry?.k === "link") {
      const href = String(entry.href ?? "").trim();
      const labels = (entry.label && typeof entry.label === "object" ? entry.label : {}) as Record<string, unknown>;
      const label: Record<string, string> = {};
      for (const l of config.locales) { const v = String(labels[l] ?? "").trim().slice(0, 80); if (v) label[l] = v; }
      // Un lien entièrement vide (ajouté puis laissé tel quel) est simplement ignoré.
      if (!href && Object.keys(label).length === 0) return null;
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!href || (!internal && !isSafeExternalUrl(href))) return { error: t("error.badUrl") };
      if (Object.keys(label).length === 0) return { error: t("navigation.error.label") };
      return { href, label };
    }
    return null;
  };

  const items: NavItem[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    if (entry?.k === "group") {
      // Un groupe (menu déroulant) : un seul niveau, jamais de groupe dans un groupe ; sans élément il est ignoré ; il lui faut un nom.
      const children: NavLeaf[] = [];
      const kids = Array.isArray(entry.items) ? (entry.items as Record<string, unknown>[]).slice(0, MAX_ITEMS) : [];
      for (const kid of kids) {
        const r = leaf(kid);
        if (r && "error" in r) return { error: r.error };
        if (r) children.push(r);
      }
      const labels = (entry.label && typeof entry.label === "object" ? entry.label : {}) as Record<string, unknown>;
      const label: Record<string, string> = {};
      for (const l of config.locales) { const v = String(labels[l] ?? "").trim().slice(0, 80); if (v) label[l] = v; }
      if (children.length === 0) continue;
      if (Object.keys(label).length === 0) return { error: t("navigation.error.label") };
      items.push({ href: "", label, children });
      continue;
    }
    const r = leaf(entry);
    if (r && "error" in r) return { error: r.error };
    if (r) items.push(r);
  }
  await setSetting("nav.custom", items);
  await audit(user.email, "navigation.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
