import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";

export const manifest: ParsedManifest = {
  apiVersion: 1,
  id: "feeds",
  name: { en: "RSS feeds", fr: "Flux RSS" },
  version: "1.0.0",
  description: {
    en: "Publishes an RSS feed for your collections, so readers and tools can follow new entries.",
    fr: "Publie un flux RSS pour vos collections, afin que lecteurs et outils suivent les nouveautés.",
  },
  author: "Vitrine",
  license: "MIT",
  icon: "📡",
  defaultEnabled: true,
  permissions: ["slots", "routes"],
  settings: [
    {
      key: "collections",
      type: "text",
      label: { en: "Collections to publish (keys, comma-separated)", fr: "Collections à publier (clés, séparées par des virgules)" },
      help: { en: "Leave empty to publish every public collection.", fr: "Vide = toutes les collections publiques." },
    },
    { key: "limit", type: "number", label: { en: "Entries per feed", fr: "Entrées par flux" }, default: 20 },
  ],
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function selectedKeys(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}

export const definition = defineModule({
  routes: {
    // /m/feeds/rss?c=<collection>&lang=<locale>
    async rss(request, ctx) {
      const url = new URL(request.url);
      const key = url.searchParams.get("c") ?? "";
      const lang = ctx.locales.includes(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang")! : ctx.defaultLocale;
      const allowed = selectedKeys(ctx.setting("collections"));
      const collections = await ctx.api.collections.list(lang);
      const collection = collections.find((c) => c.key === key && (allowed.length === 0 || allowed.includes(c.key)));
      if (!collection) return new Response("Not found", { status: 404 });

      const limit = Math.min(100, Math.max(1, Number(ctx.setting("limit")) || 20));
      const entries = await ctx.api.entries.list({ collection: key, locale: lang, limit });
      const items = entries
        .map((e) => {
          const link = `${ctx.api.siteUrl}${e.path}`;
          return `<item><title>${escapeXml(e.title)}</title><link>${escapeXml(link)}</link><guid>${escapeXml(link)}</guid>${
            e.publishedAt ? `<pubDate>${e.publishedAt.toUTCString()}</pubDate>` : ""
          }<description>${escapeXml(e.summary)}</description></item>`;
        })
        .join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(
        collection.name,
      )}</title><link>${escapeXml(ctx.api.siteUrl)}</link><description>${escapeXml(collection.name)}</description><language>${lang}</language>${items}</channel></rss>`;
      return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
    },
  },
  slots: {
    // Annonce les flux dans <head> pour les lecteurs RSS.
    async "layout.head"(ctx) {
      const allowed = selectedKeys(ctx.setting("collections"));
      const collections = (await ctx.api.collections.list(ctx.locale)).filter(
        (c) => allowed.length === 0 || allowed.includes(c.key),
      );
      return [
        {
          type: "head",
          tags: collections.map((c) => ({
            tag: "link" as const,
            rel: "alternate",
            type: "application/rss+xml",
            title: c.name,
            href: `/m/feeds/rss?c=${encodeURIComponent(c.key)}&lang=${ctx.locale}`,
          })),
        },
      ];
    },
  },
});
