import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { getSiteConfig } from "@/core/settings";
import { searchSite } from "@/core/search/service";
import { QUERY_MAX_CHARS } from "@/core/search/text";
import { SearchView } from "@/components/site/SearchView";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** La page de résultats ne s'indexe pas (une page par saisie possible) ; ses liens, eux, se suivent. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = makeTranslator(await getVisitorLocale());
  const q = (await searchParams).q;
  const text = (Array.isArray(q) ? q[0] : q)?.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX_CHARS);
  return { title: text ? t("site.search.metaTitle", { q: text }) : t("site.search.title"), robots: { index: false, follow: true } };
}

/**
 * Recherche dans le site : fonctionne sans JavaScript (formulaire GET `?q=`), ne garde rien (ni cookie, ni journal des recherches), jamais de brouillon.
 * Désactivée dans les réglages : la page n'existe pas (404), comme avant la fonction.
 */
export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const locale = await getVisitorLocale();
  const outcome = await searchSite({ q: params.q, page: params.page, locale, source: await headers() });
  if (outcome.kind === "disabled") notFound();
  return <SearchView outcome={outcome} locale={locale} defaultLocale={(await getSiteConfig()).defaultLocale} t={makeTranslator(locale)} />;
}
