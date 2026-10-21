"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { setSetting, type NavItem, type NavLeaf } from "@/core/settings";
import { isSafeExternalUrl, normalizeLinkInput } from "@/core/url";
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

  /** Un lien ou une page : `null` si l'élément est vide ou en double (ignoré), ou l'erreur d'un champ (`field` : `href` ou `label`) à afficher sous ce champ. */
  const leaf = (entry: Record<string, unknown>): NavLeaf | { field: "href" | "label"; error: string } | null => {
    if (entry?.k === "page") {
      const page = known.get(String(entry.id));
      if (!page || seen.has(page.id)) return null;
      seen.add(page.id);
      const label: Record<string, string> = {};
      for (const l of config.locales) label[l] = titles.find((x) => x.entryId === page.id && x.locale === l)?.title ?? page.title;
      return { href: page.href, label };
    }
    if (entry?.k === "link") {
      // Indulgent avant d'être strict : « www.monsite.be/contact » devient https://www.monsite.be/contact, « /contact » reste la page du site.
      const href = normalizeLinkInput(String(entry.href ?? ""));
      const labels = (entry.label && typeof entry.label === "object" ? entry.label : {}) as Record<string, unknown>;
      const label: Record<string, string> = {};
      for (const l of config.locales) { const v = String(labels[l] ?? "").trim().slice(0, 80); if (v) label[l] = v; }
      // Un lien entièrement vide (ajouté puis laissé tel quel) est simplement ignoré.
      if (!href && Object.keys(label).length === 0) return null;
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!href || (!internal && !isSafeExternalUrl(href))) return { field: "href", error: t("error.badLink") };
      if (Object.keys(label).length === 0) return { field: "label", error: t("navigation.error.label") };
      return { href, label };
    }
    return null;
  };

  const items: NavItem[] = [];
  /** Erreur d'un champ d'une ligne : le chemin (`items.2.href`, `items.1.items.0.href`) dit sous quel champ l'afficher. */
  const at = (path: string, r: { field: string; error: string }) => ({ errors: { [`${path}.${r.field === "label" ? "label" : "href"}`]: r.error } });
  const rows = raw as Record<string, unknown>[];
  for (let index = 0; index < rows.length; index++) {
    const entry = rows[index]!;
    if (entry?.k === "group") {
      // Un groupe (menu déroulant) : un seul niveau, jamais de groupe dans un groupe ; sans élément il est ignoré ; il lui faut un nom.
      const children: NavLeaf[] = [];
      const kids = Array.isArray(entry.items) ? (entry.items as Record<string, unknown>[]).slice(0, MAX_ITEMS) : [];
      for (let k = 0; k < kids.length; k++) {
        const r = leaf(kids[k]!);
        if (r && "error" in r) return at(`items.${index}.items.${k}`, r);
        if (r) children.push(r);
      }
      const labels = (entry.label && typeof entry.label === "object" ? entry.label : {}) as Record<string, unknown>;
      const label: Record<string, string> = {};
      for (const l of config.locales) { const v = String(labels[l] ?? "").trim().slice(0, 80); if (v) label[l] = v; }
      if (children.length === 0) continue;
      if (Object.keys(label).length === 0) return { errors: { [`items.${index}.label`]: t("navigation.error.label") } };
      items.push({ href: "", label, children });
      continue;
    }
    const r = leaf(entry);
    if (r && "error" in r) return at(`items.${index}`, r);
    if (r) items.push(r);
  }
  await setSetting("nav.custom", items);
  await audit(user.email, "navigation.update");
  revalidatePath("/", "layout");
  return { ok: t("action.saved") };
}
