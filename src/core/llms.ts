import { siteUrl } from "@/core/config";
import { hasPublicPage } from "./modules/publicPage";
import { collectFeedItems } from "@/core/feeds";
import { getActiveInstances } from "@/core/modules/registry";
import { makeTranslator } from "@/core/i18n/dictionary";
import { pageUrl } from "@/core/seo";
import { loadSocialLinks } from "@/core/social";
import { getSiteConfig } from "@/core/settings";
import { pickDescription, pickName } from "@/core/instances";
import { pageDeclarations } from "@/core/modules/pageDeclarations";

/**
 * /llms.txt — une présentation du site en texte simple, pensée pour les assistants IA (standard « llms.txt » :
 * titre, citation, puis des sections de liens avec une courte description).
 * Construite UNIQUEMENT à partir de ce qui est déjà public sur le site : réglages d'identité, pages et entrées publiées,
 * éléments que les modules proposent au flux, liens des réseaux sociaux. Jamais d'e-mail, de brouillon ni de page non publiée.
 */
export type LlmsLink = { title: string; url: string; description?: string };
export type LlmsSection = { title: string; links: LlmsLink[] };
export type LlmsDoc = { name: string; summary?: string; about?: string; sections: LlmsSection[] };

export const LLMS_MAX_BYTES = 40_000;
export const LLMS_MAX_LINKS_PER_SECTION = 40;
export const LLMS_MAX_LINKS = 120;

/** Une ligne de texte sûre : sans retour à la ligne, sans HTML ni syntaxe de lien, bornée. */
export function plain(text: string, max: number): string {
  const t = String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const label = (s: string) => plain(s, 120).replace(/[[\]]/g, "") || "—";
const safeUrl = (u: string) => u.replace(/[\s()<>]/g, (c) => encodeURIComponent(c));

/** Titre d'un chemin déclaré par un module (« /legal/cookie-policy » → « Cookie policy ») : le cœur ne connaît que l'adresse. */
export function pathTitle(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : path;
}

/** Écrit le fichier. Pure et déterministe ; ne dépasse jamais `LLMS_MAX_BYTES` (les dernières sections sont coupées). */
export function renderLlmsTxt(doc: LlmsDoc): string {
  const head = [`# ${label(doc.name)}`];
  if (doc.summary) head.push("", `> ${plain(doc.summary, 300)}`);
  if (doc.about) head.push("", plain(doc.about, 600));
  let out = head.join("\n") + "\n";
  let links = 0;
  for (const section of doc.sections) {
    const lines: string[] = [];
    for (const l of section.links.slice(0, LLMS_MAX_LINKS_PER_SECTION)) {
      if (links >= LLMS_MAX_LINKS) break;
      links++;
      lines.push(`- [${label(l.title)}](${safeUrl(l.url)})${l.description ? `: ${plain(l.description, 160)}` : ""}`);
    }
    if (!lines.length) continue;
    const block = `\n## ${plain(section.title, 80)}\n\n${lines.join("\n")}\n`;
    if (Buffer.byteLength(out + block) > LLMS_MAX_BYTES) break;
    out += block;
  }
  return out;
}

/** Le fichier d'une langue (une langue activée du site). */
export async function buildLlmsTxt(locale: string): Promise<string> {
  const base = await getSiteConfig();
  const loc = base.locales.includes(locale) ? locale : base.defaultLocale;
  const config = await getSiteConfig(loc);
  const t = makeTranslator(loc);
  const at = (path: string) => pageUrl(siteUrl, loc, base.defaultLocale, path);

  const pages: LlmsLink[] = [{ title: t("llms.home"), url: at("/") }];
  for (const active of (await getActiveInstances()).filter((a) => hasPublicPage(a) && !!a.instance.basePath)) {
    const { instance } = active;
    // (0.3.0) Un module qui le demande (`sitemapFromPage`) peut se déclarer « noindex » ou ajouter des chemins de sa page ; les autres : aucune différence.
    const declared = await pageDeclarations(active, base.defaultLocale);
    if (declared.noindex) continue;
    pages.push({ title: pickName(instance, loc, base.defaultLocale), url: at(`/${instance.basePath}`), description: pickDescription(instance, loc, base.defaultLocale) });
    for (const path of declared.paths) pages.push({ title: pathTitle(path), url: at(path), description: pickName(instance, loc, base.defaultLocale) });
  }

  const items = await collectFeedItems({ locale: loc, limit: 40 });
  const latest: LlmsLink[] = items.map((i) => ({ title: i.title, url: i.link, description: i.summary }));

  const social: LlmsLink[] = (await loadSocialLinks(loc)).map((s) => ({ title: s.label, url: s.href }));

  return renderLlmsTxt({
    name: config.name,
    summary: config.tagline,
    about: config.about,
    sections: [
      { title: t("llms.pages"), links: pages },
      { title: t("llms.latest"), links: latest },
      { title: t("llms.elsewhere"), links: social },
      // « Optional » : nom réservé par le standard (informations secondaires qu'un lecteur pressé peut ignorer).
      {
        title: "Optional",
        links: [
          { title: t("llms.feed"), url: `${siteUrl}/feed.xml?lang=${loc}` },
          { title: t("llms.sitemap"), url: `${siteUrl}/sitemap.xml` },
          { title: t("privacy.title"), url: at("/privacy") },
        ],
      },
    ],
  });
}
