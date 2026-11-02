import { prisma } from "@/core/db";
import { getActiveInstances } from "@/core/modules/registry";
import { getInstanceLabeler } from "@/core/modules/labels";
import { localized } from "@/core/modules/types";
import { returnAddressUrl } from "@/core/modules/addressDecl";
import { urlAccessIds } from "@/core/services/mcp/tokens";
import { effectiveType } from "@/core/modules/manifest";

/**
 * LISTE DE CONTRÔLE D'UN CHANGEMENT DE DOMAINE (page « Adresse du site »). Tout est LECTURE SEULE et BORNÉ : on compte ce qui existe sur CE site et on liste les adresses publiques à
 * mettre à jour ; rien n'est modifié, aucun service tiers n'est contacté. Aucun secret ne sort d'ici : les jetons des assistants et les adresses secrètes des overlays ne sont que
 * COMPTÉS ; la recherche de l'ancien domaine ne rend que des emplacements (titre + lien vers la page d'administration), jamais la valeur d'un réglage.
 */

/** Au plus ce nombre de résultats par rubrique de la recherche de l'ancien domaine (la page dit « et d'autres » au-delà). */
export const CONTENT_HITS_MAX = 30;

export type ReturnAddressItem = { instanceKey: string; instance: string; service: string; where: string; oldUrl: string; newUrl: string; href: string };
export type AddressUseItem = { instanceKey: string; instance: string; label: string; where: string; href: string };
export type ContentKind = "entry" | "redirect" | "menu" | "settings" | "home" | "social" | "module";
export type ContentHit = { kind: ContentKind; title: string; detail: string; href: string };

export type Checklist = {
  passkeys: { keys: number; people: number };
  shortLinks: { total: number; active: number };
  returns: ReturnAddressItem[];
  uses: AddressUseItem[];
  assistants: { byAddress: number; active: number };
  overlays: { pages: number; sources: number };
  content: { hits: ContentHit[]; more: boolean };
};

/** Les réglages du cœur qui portent un texte lisible par le public ou de la mise en page : seuls ceux-là sont cherchés, et rangés sous une page d'administration. */
const SETTING_HOMES: { re: RegExp; kind: ContentKind; href: string }[] = [
  { re: /^nav\./, kind: "menu", href: "/admin/navigation" },
  { re: /^home\./, kind: "home", href: "/admin/home" },
  { re: /^social\./, kind: "social", href: "/admin/social" },
  { re: /^(?:site|footer|privacy)\./, kind: "settings", href: "/admin/settings" },
];
/** Un réglage dont le nom évoque un secret n'est JAMAIS lu, même s'il est rangé sous une page connue. */
const SECRET_NAME = /secret|token|passw|credential|sealed|hash|salt|auth|smtp|mail\.pass/i;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Les entrées, liens courts, menu et réglages qui contiennent `host` (nom de domaine de l'ancienne adresse), en lecture seule et bornés. */
export async function findOldAddressInContent(host: string, locale: string, defaultLocale: string): Promise<{ hits: ContentHit[]; more: boolean }> {
  const needle = host.toLowerCase();
  if (!needle || needle.length > 253) return { hits: [], more: false };
  const hits: ContentHit[] = [];
  let more = false;
  const take = <T>(rows: T[]): T[] => { if (rows.length > CONTENT_HITS_MAX) more = true; return rows.slice(0, CONTENT_HITS_MAX); };

  // Entrées (pages, articles, liens…) : titre, résumé, texte, adresse du lien et champs libres. Les brouillons comptent : l'équipe d'administration les voit déjà.
  const trans = await prisma.entryTranslation.findMany({
    where: { OR: [{ title: { contains: needle } }, { summary: { contains: needle } }, { body: { contains: needle } }] },
    select: { entryId: true, locale: true, title: true, entry: { select: { instance: { select: { key: true } } } } },
    orderBy: { updatedAt: "desc" }, take: CONTENT_HITS_MAX + 1,
  });
  const seen = new Set<string>();
  for (const tr of take(trans)) {
    if (seen.has(tr.entryId)) continue;
    seen.add(tr.entryId);
    hits.push({ kind: "entry", title: clip(tr.title || "—", 80), detail: tr.entry.instance.key, href: `/admin/entries/${tr.entryId}?locale=${encodeURIComponent(tr.locale)}` });
  }
  const linked = await prisma.entry.findMany({
    where: { OR: [{ url: { contains: needle } }, { fields: { contains: needle } }, { cover: { contains: needle } }], id: { notIn: [...seen] } },
    select: { id: true, sourceLocale: true, instance: { select: { key: true } }, translations: { select: { locale: true, title: true } } },
    orderBy: { updatedAt: "desc" }, take: CONTENT_HITS_MAX + 1,
  });
  for (const e of take(linked)) {
    const main = e.translations.find((x) => x.locale === defaultLocale) ?? e.translations[0];
    hits.push({ kind: "entry", title: clip(main?.title || "—", 80), detail: e.instance.key, href: `/admin/entries/${e.id}${main ? `?locale=${encodeURIComponent(main.locale)}` : ""}` });
  }

  // Liens courts dont la DESTINATION est l'ancien domaine (le lien court lui-même, lui, continue de marcher).
  const redirects = await prisma.redirect.findMany({ where: { targetUrl: { contains: needle } }, select: { id: true, path: true }, orderBy: { path: "asc" }, take: CONTENT_HITS_MAX + 1 });
  for (const r of take(redirects)) hits.push({ kind: "redirect", title: `/${r.path}`, detail: "", href: `/admin/redirects/${r.id}` });

  // Réglages : seulement ceux d'une page connue, jamais un réglage secret ; ceux d'une instance de module sont rangés sous la page de l'instance, sauf les champs « secret ».
  const settings = await prisma.setting.findMany({ where: { value: { contains: needle } }, select: { key: true }, take: 300 });
  const seenSetting = new Set<string>();
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const grouped: ContentHit[] = [];
  for (const { key } of settings) {
    if (SECRET_NAME.test(key)) continue;
    const m = /^instance\.([^.]+)\.([^.]+)$/.exec(key);
    if (m) {
      const found = active.find((a) => a.instance.id === m[1]);
      const field = found?.mod.manifest.settings.find((f) => f.key === m[2]);
      if (!found || !field || field.type === "secret" || SECRET_NAME.test(field.key)) continue;
      const id = `module:${found.instance.id}`;
      if (seenSetting.has(id)) continue;
      seenSetting.add(id);
      grouped.push({ kind: "module", title: clip(labeler.label(found.instance), 80), detail: clip(localized(field.label, locale, defaultLocale), 80), href: `/admin/instances/${found.instance.id}` });
      continue;
    }
    const home = SETTING_HOMES.find((h) => h.re.test(key));
    if (!home || seenSetting.has(home.href)) continue;
    seenSetting.add(home.href);
    grouped.push({ kind: home.kind, title: "", detail: "", href: home.href });
  }
  hits.push(...take(grouped));
  return { hits, more };
}

/** Ce que ce site possède réellement et qui dépend de son adresse. `oldBase` : l'adresse actuelle ; `newBase` : la nouvelle (ou la même, après le changement). */
export async function buildChecklist(opts: { oldBase: string; newBase: string; oldHost: string; locale: string; defaultLocale: string }): Promise<Checklist> {
  const { oldBase, newBase, oldHost, locale, defaultLocale } = opts;
  const [keys, people, shortTotal, shortActive, tokens, pages] = await Promise.all([
    prisma.passkey.count(),
    prisma.passkey.groupBy({ by: ["userId"] }).then((g) => g.length),
    prisma.redirect.count(),
    prisma.redirect.count({ where: { active: true } }),
    prisma.apiToken.findMany({ where: { revokedAt: null }, select: { id: true } }),
    prisma.overlayPage.count(),
  ]);
  const byAddress = new Set(await urlAccessIds());
  const active = await getActiveInstances();
  const labeler = await getInstanceLabeler(locale, defaultLocale);

  const returns: ReturnAddressItem[] = [];
  const uses: AddressUseItem[] = [];
  let sources = 0;
  for (const { instance, mod } of active) {
    const name = labeler.label(instance);
    const href = `/admin/instances/${instance.id}`;
    for (const a of mod.manifest.returnAddresses ?? []) {
      returns.push({
        instanceKey: instance.key, instance: name, service: localized(a.label, locale, defaultLocale), where: localized(a.where, locale, defaultLocale), href,
        oldUrl: returnAddressUrl(oldBase, a.path, instance.key), newUrl: returnAddressUrl(newBase, a.path, instance.key),
      });
    }
    for (const u of mod.manifest.siteAddressUses ?? []) uses.push({ instanceKey: instance.key, instance: name, label: localized(u.label, locale, defaultLocale), where: localized(u.where, locale, defaultLocale), href });
    if (effectiveType(mod.manifest) === "overlay") sources += 1;
  }
  return {
    passkeys: { keys, people },
    shortLinks: { total: shortTotal, active: shortActive },
    returns, uses,
    assistants: { byAddress: tokens.filter((t) => byAddress.has(t.id)).length, active: tokens.length },
    overlays: { pages, sources },
    content: await findOldAddressInContent(oldHost, locale, defaultLocale),
  };
}
