import { isDarkBackground, pickLogo } from "../logos";
import { getBrand } from "@/core/brand";
import { siteUrl } from "@/core/config";
import { moduleJsonLd } from "@/core/seo";
import { entryPath, listEntries } from "@/core/content/entries";
import { getInstanceByKey, listInstances, pickName, type InstanceView } from "@/core/instances";
import { isMailConfigured, sendMail } from "@/core/services/mail";
import { sharedNet } from "@/core/services/net";
import { qrSvg } from "@/core/services/qr";
import { isRawgConfigured, rawgCover } from "@/core/services/rawg";
import { renderPng, type PngSpec } from "@/core/services/render";
import { createStore } from "@/core/services/store";
import { collect, collectPage } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";
import { remainingBudgetMs } from "./budget";
import { callService, callServiceAll, providersOf, serviceAvailable } from "./dependencies";
import { getActiveInstances, getModule, type ActiveInstance } from "./registry";
import type { ModuleApi } from "./types";

/**
 * `ctx.api` : tout ce que le cœur met à disposition d'un module. Un module n'importe jamais rien du
 * cœur : il n'a que cet objet. Deux familles, volontairement distinctes :
 *
 *   SERVICES (helpers génériques, src/core/services/) — indépendants de toute fonctionnalité
 *     qr      générateur de QR code
 *     png     rendu d'une image PNG à partir d'une arborescence de boîtes
 *     store   stockage privé de l'instance
 *     mail    envoi d'e-mails au nom du site (SMTP réglé dans l'admin)
 *     rawg    jaquettes de jeux (clé RAWG réglée une fois dans l'admin ; permission « rawg »)
 *     topics  échange d'informations typées entre modules
 *     net     client réseau neutre et borné (délai, pauses 429, quota, disjoncteur, file bornée, santé) ; aucun fournisseur connu du cœur
 *     services  appel du service d'un autre module (`call` : maître, ou l'instance `provider` choisie ; `providers` : qui l'offre ; `callAll` : toutes les instances d'un service `each`)
 *     (MCP : pas d'appel côté module ; un module déclare ses actions `mcp`, le cœur les expose)
 *
 *   LECTURE DU SITE (en lecture seule, pour que les modules s'articulent avec le reste)
 *     site, brand (identité visuelle), instances, entries
 *
 * Voir docs/PLATFORM.md.
 */
/** Marge laissée à la section pour afficher son repli quand un appel réseau épuise le temps de la page. */
const NET_PAGE_MARGIN_MS = 500;

export function makeApi(instance: InstanceView, locale: string, permissions: readonly string[] = []): ModuleApi {
  const rawgAllowed = permissions.includes("rawg");
  /**
   * L'instance appelante, pour un appel de service. Une instance mise à l'écart (migration échouée) ne tourne pas, SAUF pendant sa propre
   * migration (« Réessayer ») : elle doit alors pouvoir appeler les services dont elle dépend, d'où le repli sur son module chargé.
   */
  const consumer = async (): Promise<Pick<ActiveInstance, "mod" | "instance"> | null> => {
    const live = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
    if (live) return live;
    const mod = await getModule(instance.moduleId).catch(() => null);
    return mod ? { mod, instance } : null;
  };
  return {
    siteUrl,

    seo: { jsonLd: (data) => { const ld = moduleJsonLd(data); return ld ? { tag: "script", jsonLd: ld } : null; } },

    // ── SERVICES du cœur ────────────────────────────────────────────────────────
    qr: qrSvg,
    png: (spec) => renderPng(spec as PngSpec, siteUrl),
    services: {
      available: serviceAvailable,
      async providers(service) {
        const me = await consumer();
        return me ? providersOf(me, service, locale) : [];
      },
      async call(service, method, args, opts) {
        const me = await consumer();
        const provider = opts && typeof opts === "object" && opts.provider !== undefined ? String(opts.provider) : undefined;
        return me ? callService(me, service, method, args, locale, { provider }) : { ok: false, reason: "unavailable" };
      },
      async callAll(service, method, args) {
        const me = await consumer();
        return me ? callServiceAll(me, service, method, args, locale) : [];
      },
    },
    store: createStore(instance.id),
    mail: { configured: isMailConfigured, send: (message) => sendMail(message, instance.key) },
    // Sans la permission « rawg » : comme s'il n'y avait pas de clé (le module ne peut ni l'utiliser ni la deviner).
    rawg: {
      configured: async () => rawgAllowed && (await isRawgConfigured()),
      cover: async (title) => (rawgAllowed ? rawgCover(title) : { status: "no-key", url: null }),
    },
    net: {
      // Dans une page publique : le délai ne dépasse pas le temps restant de la page, moins une marge pour que le module affiche son repli.
      request: (req) => {
        const left = remainingBudgetMs();
        return sharedNet().request(req, { module: instance.moduleId, budgetMs: left === null ? null : left - NET_PAGE_MARGIN_MS });
      },
      health: async () => sharedNet().health(),
      budgetMs: remainingBudgetMs,
    },
    topics: {
      async collect(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? collect(consumer, topic, { limit: opts?.limit, from: opts?.from, to: opts?.to, locale }) : [];
      },
      async collectPage(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? collectPage(consumer, topic, { limit: opts?.limit, cursor: opts?.cursor, from: opts?.from, to: opts?.to, locale }) : { items: [], next: null };
      },
    },

    // ── LECTURE du site ─────────────────────────────────────────────────────────
    async site(loc) {
      const c = await getSiteConfig(loc);
      return { name: c.name, tagline: c.tagline, logo: pickLogo(c.logos, "any", isDarkBackground(c.background)) };
    },
    brand: (loc) => getBrand(loc ?? locale),
    instances: {
      async list({ locale: loc, module } = {}) {
        const config = await getSiteConfig();
        return (await listInstances())
          .filter((i) => !module || i.moduleId === module)
          .map((i) => ({ id: i.id, key: i.key, module: i.moduleId, basePath: i.basePath, name: pickName(i, loc ?? config.defaultLocale, config.defaultLocale), adminPath: `/admin/instances/${i.id}` }));
      },
    },
    entries: {
      async list({ instance: key, locale: loc, limit } = {}) {
        const config = await getSiteConfig();
        const target = key ? await getInstanceByKey(key) : instance;
        if (!target) return [];
        const views = await listEntries({ instance: target, locale: loc ?? config.defaultLocale, limit });
        return views.map((e) => ({
          id: e.id, slug: e.slug, cover: e.cover, icon: e.icon, tags: e.tags, fields: e.fields,
          title: e.title, summary: e.summary, body: e.body, url: e.url, code: e.code,
          path: entryPath(e, config.defaultLocale), publishedAt: e.publishedAt,
        }));
      },
    },
  };
}
