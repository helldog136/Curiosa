import { prisma } from "@/core/db";
import { TIMED_OUT, withDeadline } from "@/core/deadline";
import { entriesChunk, entryPath } from "@/core/content/entries";
import { FEED_ITEM_SCHEMA, FEED_ITEM_TOPIC } from "@/core/feeds";
import { pickName } from "@/core/instances";
import { hasPublicPage } from "@/core/modules/publicPage";
import { getActiveInstances } from "@/core/modules/registry";
import { collectForCore } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";
import { siteUrl } from "@/core/config";
import { isSafeExternalUrl } from "@/core/url";
import { isOwnAddress } from "./rank";
import { BODY_CHARS, fold, plainText } from "./text";
export { BODY_CHARS };

/**
 * RECHERCHE DANS LE SITE — L'INDEX (docs/PLATFORM.md). Une liste de « fiches » construite À LA DEMANDE à partir de ce qui est PUBLIC, gardée en mémoire un court
 * moment. Rien n'est écrit sur le disque ou en base, rien ne dépend d'une personne qui visite, aucun minuteur : une fiche périmée est simplement relue à la
 * recherche suivante.
 *
 * D'où viennent les fiches (jamais d'un brouillon, d'une publication programmée, d'une entrée expirée) :
 *   - les ENTRÉES publiées des instances à contenu dont la page publique existe (pages, articles…), langue du visiteur avec repli de langue ;
 *   - les éléments `feed.item` que des modules proposent déjà au flux RSS (titre + résumé seulement ; jamais un module qui n'a rien déclaré).
 * Les recherches propres à certains modules (annuaire, agenda, vidéos…) restent telles quelles : leurs filtres ne se retrouvent pas dans une recherche générale.
 *
 * PLAFONDS (testés dans tests/core/search-index.test.mjs) :
 *   - 4 000 fiches d'entrées au plus par langue (les plus récentes d'abord, instance après instance) ; 500 éléments de modules ;
 *   - par fiche : titre 200 caractères, résumé 600, texte cherché 3 000 premiers caractères du corps (≈ 12 Mo de texte plié au plus par langue) ;
 *   - 4 langues gardées en mémoire à la fois (la plus ancienne est oubliée), durée de vie 60 secondes ;
 *   - une lecture de la base = tranches de 250 entrées, jamais tout d'un coup ; un seul calcul à la fois par langue (les autres attendent le même résultat).
 */
export const MAX_ENTRY_DOCS = 4000;
export const MAX_ITEM_DOCS = 500;
export const TITLE_CHARS = 200;
export const SUMMARY_CHARS = 600;
export const INDEX_TTL_MS = 60_000;
/** Quand un module n'a pas répondu à temps, l'index n'est gardé que 10 secondes (il sera refait vite, sans réclamer le module à chaque visite). */
export const PARTIAL_TTL_MS = 10_000;
export const MAX_LOCALES_KEPT = 4;
/** Temps accordé aux modules pour répondre (`feed.item`) : au-delà, la recherche se fait sans eux, jamais d'attente sans borne. */
export const ITEMS_DEADLINE_MS = 1500;
const CHUNK = 250;

export type SearchDoc = {
  id: string;
  /** « entry » : une entrée du cœur (corps cherché, extrait relu dans la base) ; « item » : un élément proposé par un module. */
  kind: "entry" | "item";
  entryId?: string;
  /** Clé de l'instance (pour la filtrer) et son nom lisible dans la langue du visiteur (« Pages », « Blog »…). */
  typeKey: string;
  typeLabel: string;
  title: string;
  summary: string;
  /** Adresse relative au site (`/fr/blog/x`) ou https. */
  url: string;
  external: boolean;
  /** Contenu du site (entrée du cœur, ou adresse qui reste sur le site) : classé avant ce qui mène ailleurs (voir rank.ts). */
  own: boolean;
  /** Langue réellement affichée (peut différer de la langue demandée : repli de langue). */
  locale: string;
  publishedAt: number | null;
  /** Textes pliés (voir text.ts : même longueur que l'original). Le titre, puis le résumé et les étiquettes, puis le début du corps. */
  fTitle: string;
  fSummary: string;
  fBody: string;
};

export type SearchIndex = { docs: SearchDoc[]; builtAt: number; signature: string; /** Il y avait plus de contenu que les plafonds ne le permettent. */ truncated: boolean; ttl: number };

type Slot = { value?: SearchIndex; inflight?: Promise<SearchIndex>; };
// Sur `globalThis` : Next peut charger ce fichier dans plusieurs paquets, et la mémoire doit être UNE SEULE pour tout le processus.
const state = globalThis as unknown as { curiosaSearchIndex?: Map<string, Slot> };
const slots = (): Map<string, Slot> => (state.curiosaSearchIndex ??= new Map());

/** Oublie tout (tests, et après une restauration). */
export function resetSearchIndex(): void { state.curiosaSearchIndex = undefined; }
/** Combien de langues sont gardées en mémoire (tests). */
export function keptLocales(): string[] { return [...slots().keys()]; }

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const isHttp = (u: string) => /^https?:\/\//i.test(u) && isSafeExternalUrl(u);

/** Les instances qu'on cherche : à contenu, avec leur page publique, et non écartées par la personne qui gère le site. */
async function eligibleInstances(exclude: readonly string[]) {
  const skip = new Set(exclude);
  return (await getActiveInstances()).filter((a) => hasPublicPage(a) && a.mod.manifest.content && !skip.has(a.instance.key));
}

/** Les types qu'on peut cocher dans les réglages (toutes les instances à contenu avec page publique), avec leur nom dans la langue demandée. */
export async function searchableTypes(locale: string): Promise<{ key: string; label: string }[]> {
  const { defaultLocale } = await getSiteConfig();
  return (await getActiveInstances()).filter((a) => hasPublicPage(a) && a.mod.manifest.content).map((a) => ({ key: a.instance.key, label: pickName(a.instance, locale, defaultLocale) }));
}

/**
 * Signature du contenu : trois lectures groupées (nombre et dernière modification des entrées publiées et de leurs traductions, des instances), plus ce qui
 * décide de ce qui est cherché. Elle change dès qu'on crée, modifie, supprime, publie ou restaure : l'index en mémoire est alors refait tout de suite.
 */
export async function contentSignature(extra: string): Promise<string> {
  const [entries, translations, instances] = await Promise.all([
    prisma.entry.aggregate({ where: { status: "published" }, _count: { _all: true }, _max: { updatedAt: true, publishedAt: true } }),
    prisma.entryTranslation.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.moduleInstance.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
  ]);
  const t = (d: Date | null | undefined) => d?.getTime() ?? 0;
  return [entries._count._all, t(entries._max.updatedAt), t(entries._max.publishedAt), translations._count._all, t(translations._max.updatedAt), instances._count._all, t(instances._max.updatedAt), extra].join("|");
}

/** Fabrique la fiche d'une entrée. Pure (testée seule). */
export function docFromParts(p: { id: string; kind: SearchDoc["kind"]; entryId?: string; typeKey: string; typeLabel: string; title: string; summary: string; tags?: readonly string[]; body?: string; url: string; external: boolean; /** Par défaut : une entrée, ou une adresse non externe. */ own?: boolean; locale: string; publishedAt: Date | null }): SearchDoc {
  const title = cut(p.title.replace(/\s+/g, " ").trim(), TITLE_CHARS);
  const summary = cut(p.summary.replace(/\s+/g, " ").trim(), SUMMARY_CHARS);
  return {
    id: p.id, kind: p.kind, entryId: p.entryId, typeKey: p.typeKey, typeLabel: p.typeLabel, title, summary, url: p.url, external: p.external, own: p.own ?? (p.kind === "entry" || !p.external), locale: p.locale,
    publishedAt: p.publishedAt ? p.publishedAt.getTime() : null,
    fTitle: fold(title),
    fSummary: fold([summary, ...(p.tags ?? [])].join(" ")),
    fBody: p.body ? fold(cut(plainText(p.body), BODY_CHARS)) : "",
  };
}

async function build(locale: string, exclude: readonly string[], signature: string): Promise<SearchIndex> {
  const now = Date.now();
  const site = await getSiteConfig();
  const docs: SearchDoc[] = [];
  const urls = new Set<string>();
  let truncated = false;

  for (const { instance } of await eligibleInstances(exclude)) {
    const typeLabel = pickName(instance, locale, site.defaultLocale);
    const external = instance.clickAction === "external";
    for (let skip = 0; ; skip += CHUNK) {
      // Plafond atteint : on ne lit plus qu'UNE entrée de cette instance, juste pour savoir s'il en reste (et le dire).
      const chunk = await entriesChunk({ instance, locale, skip, take: docs.length >= MAX_ENTRY_DOCS ? 1 : CHUNK });
      for (const e of chunk) {
        if (docs.length >= MAX_ENTRY_DOCS) { truncated = true; break; }
        let url: string;
        if (external) { if (!isHttp(e.url ?? "")) continue; url = e.url!; }
        else url = entryPath(e, site.defaultLocale);
        if (urls.has(url)) continue;
        urls.add(url);
        docs.push(docFromParts({ id: `entry:${e.id}`, kind: "entry", entryId: e.id, typeKey: instance.key, typeLabel, title: e.title, summary: e.summary, tags: e.tags, body: e.body, url, external, locale: e.locale, publishedAt: e.publishedAt }));
      }
      if (chunk.length < CHUNK) break;
    }
  }

  // Éléments proposés par des modules (`feed.item`) : ce que le flux RSS publie déjà. Un module lent ou en panne ne retarde jamais la recherche.
  let partial = false;
  const skip = new Set(exclude);
  const active = await getActiveInstances();
  const got = await withDeadline(() => collectForCore(FEED_ITEM_TOPIC, FEED_ITEM_SCHEMA, { locale, limit: 200 }), ITEMS_DEADLINE_MS).catch((): typeof TIMED_OUT => TIMED_OUT);
  if (got === TIMED_OUT) partial = true;
  else {
    let count = 0;
    for (const i of got) {
      if (count >= MAX_ITEM_DOCS) { truncated = true; break; }
      const key = i.source.instance;
      if (skip.has(key)) continue;
      const url = String(i.url);
      if (!(url.startsWith("/") && !url.startsWith("//")) && !isHttp(url)) continue;
      const date = typeof i.publishedAt === "string" ? new Date(i.publishedAt) : null;
      const publishedAt = date && !Number.isNaN(date.getTime()) ? date : null;
      if (publishedAt && publishedAt.getTime() > now) continue; // annoncé pour plus tard : pas encore public
      if (urls.has(url)) continue;
      urls.add(url);
      const owner = active.find((a) => a.instance.key === key);
      const own = isOwnAddress(url, siteUrl);
      docs.push(docFromParts({ id: `item:${String(i.id ?? `${key}:${url}`)}`, kind: "item", typeKey: key, typeLabel: owner ? pickName(owner.instance, locale, site.defaultLocale) : key, title: String(i.title), summary: String(i.summary ?? ""), url, external: !own, own, locale, publishedAt }));
      count++;
    }
  }
  return { docs, builtAt: now, signature, truncated, ttl: partial ? PARTIAL_TTL_MS : INDEX_TTL_MS };
}

/**
 * L'index de cette langue : celui de la mémoire s'il est récent ET si le contenu n'a pas changé depuis ; sinon refait (un seul calcul à la fois, les demandes
 * simultanées attendent le même résultat). `exclude` : les instances écartées par les réglages (elles font partie de la signature).
 */
export async function getSearchIndex(locale: string, exclude: readonly string[] = [], now: number = Date.now()): Promise<SearchIndex> {
  const eligible = (await eligibleInstances(exclude)).map((a) => `${a.instance.key}@${a.instance.basePath}`).join(",");
  const signature = await contentSignature(`${locale}|${eligible}|${[...exclude].sort().join(",")}`);
  const map = slots();
  const slot = map.get(locale) ?? {};
  if (slot.value && slot.value.signature === signature && now - slot.value.builtAt < slot.value.ttl) return slot.value;
  if (slot.inflight) return slot.inflight;
  const work = build(locale, exclude, signature).then(
    (value) => {
      const current = map.get(locale) ?? {};
      current.value = value; current.inflight = undefined;
      map.delete(locale); map.set(locale, current); // le plus récemment refait passe en dernier
      while (map.size > MAX_LOCALES_KEPT) map.delete(map.keys().next().value as string);
      return value;
    },
    (error) => { const current = map.get(locale); if (current) current.inflight = undefined; throw error; },
  );
  slot.inflight = work;
  map.set(locale, slot);
  return work;
}
