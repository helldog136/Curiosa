import { prisma } from "@/core/db";
import { visitorFingerprint } from "@/core/modules/visitorFingerprint";
import { getSearchIndex } from "./index";
import { countSearch } from "./limit";
import { MAX_RESULTS, rankDocs } from "./rank";
import { getSearchSettings } from "./settings";
import { excerptFor } from "./excerpt";
import { highlight, parseQuery, type Segment } from "./text";

/**
 * RECHERCHE DANS LE SITE — le service : de la saisie d'un visiteur à une page de résultats. Aucune écriture nulle part (ni base, ni fichier, ni cookie), aucune
 * trace de ce qui a été cherché ; la seule mémoire est l'index (court, public) et le compteur de débit (une minute, voir limit.ts).
 */
export type ResultItem = {
  id: string;
  title: Segment[];
  typeLabel: string;
  url: string;
  external: boolean;
  /** Langue de l'élément quand elle diffère de celle de la page (repli de langue) : posée en `lang` pour les lecteurs d'écran. */
  lang: string | null;
  date: Date | null;
  excerpt: Segment[];
};

export type SearchOutcome =
  | { kind: "disabled" }
  /** Aucune saisie utilisable : la page montre le champ et un mot d'aide. */
  | { kind: "empty" }
  | { kind: "limited"; shown: string; retryAfterSeconds: number }
  | {
      kind: "results"; shown: string; trimmed: boolean; items: ResultItem[];
      /** Fiches qui répondent, au total ; `reachable` : celles qu'on peut parcourir (au plus MAX_RESULTS). */
      total: number; reachable: number; page: number; pages: number; perPage: number;
      /** Le contenu dépassait les plafonds de l'index : certaines anciennes entrées ne sont pas cherchées. */
      indexTruncated: boolean;
    };

/** Numéro de page lu dans l'adresse : entier ≥ 1, sinon 1 (jamais d'erreur). */
export function pageNumber(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && /^[1-9]\d{0,5}$/.test(v) ? Number(v) : 1;
}

export async function searchSite(input: { q: unknown; page: unknown; locale: string; source: unknown; now?: number }): Promise<SearchOutcome> {
  const settings = await getSearchSettings();
  if (!settings.enabled) return { kind: "disabled" };
  const query = parseQuery(input.q);
  if (query.kind === "empty") return { kind: "empty" };
  const now = input.now ?? Date.now();
  const verdict = countSearch(visitorFingerprint("core.search", input.source, "q", now), now);
  if (!verdict.ok) return { kind: "limited", shown: query.shown, retryAfterSeconds: verdict.retryAfterSeconds };

  const index = await getSearchIndex(input.locale, settings.exclude, now);
  const ranked = rankDocs(index.docs, query.words, MAX_RESULTS);
  const perPage = settings.perPage;
  const pages = Math.max(1, Math.ceil(ranked.hits.length / perPage));
  const page = Math.min(pageNumber(input.page), pages);
  const slice = ranked.hits.slice((page - 1) * perPage, page * perPage);

  // Les corps des seules fiches affichées (50 au plus), relus pour que l'extrait garde les accents et la casse d'origine.
  const ids = slice.filter((h) => h.doc.kind === "entry").map((h) => h.doc.entryId!);
  const bodies = new Map<string, string>();
  if (ids.length > 0) {
    for (const row of await prisma.entryTranslation.findMany({ where: { entryId: { in: ids } }, select: { entryId: true, locale: true, body: true } })) bodies.set(`${row.entryId}|${row.locale}`, row.body);
  }
  const items: ResultItem[] = slice.map(({ doc }) => ({
    id: doc.id,
    title: highlight(doc.title, query.words),
    typeLabel: doc.typeLabel,
    url: doc.url,
    external: doc.external,
    lang: doc.locale !== input.locale ? doc.locale : null,
    date: doc.publishedAt === null ? null : new Date(doc.publishedAt),
    excerpt: excerptFor(doc.summary, doc.kind === "entry" ? (bodies.get(`${doc.entryId}|${doc.locale}`) ?? "") : "", query.words),
  }));
  return { kind: "results", shown: query.shown, trimmed: query.trimmed, items, total: ranked.total, reachable: ranked.hits.length, page, pages, perPage, indexTruncated: index.truncated };
}
