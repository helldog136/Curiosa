import { getBrand } from "@/core/brand";
import { siteUrl } from "@/core/config";
import { entryPath, listEntries } from "@/core/content/entries";
import { getInstanceByKey, listInstances, pickName, type InstanceView } from "@/core/instances";
import { isMailConfigured, sendMail } from "@/core/services/mail";
import { qrSvg } from "@/core/services/qr";
import { renderPng, type PngSpec } from "@/core/services/render";
import { createStore } from "@/core/services/store";
import { collect } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";
import { callService, serviceAvailable } from "./dependencies";
import { getActiveInstances } from "./registry";
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
 *     topics  échange d'informations typées entre modules
 *     (MCP : pas d'appel côté module ; un module déclare ses actions `mcp`, le cœur les expose)
 *
 *   LECTURE DU SITE (en lecture seule, pour que les modules s'articulent avec le reste)
 *     site, brand (identité visuelle), instances, entries
 *
 * Voir docs/PLATFORM.md.
 */
export function makeApi(instance: InstanceView, locale: string): ModuleApi {
  return {
    siteUrl,

    // ── SERVICES du cœur ────────────────────────────────────────────────────────
    qr: qrSvg,
    png: (spec) => renderPng(spec as PngSpec, siteUrl),
    services: {
      available: serviceAvailable,
      async call(service, method, args) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? callService(consumer, service, method, args, locale) : { ok: false, reason: "unavailable" };
      },
    },
    store: createStore(instance.id),
    mail: { configured: isMailConfigured, send: (message) => sendMail(message, instance.key) },
    topics: {
      async collect(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        return consumer ? collect(consumer, topic, { limit: opts?.limit, locale }) : [];
      },
    },

    // ── LECTURE du site ─────────────────────────────────────────────────────────
    async site(loc) {
      const c = await getSiteConfig(loc);
      return { name: c.name, tagline: c.tagline, logo: c.logo };
    },
    brand: (loc) => getBrand(loc ?? locale),
    instances: {
      async list({ locale: loc, module } = {}) {
        const config = await getSiteConfig();
        return (await listInstances())
          .filter((i) => i.enabled && (!module || i.moduleId === module))
          .map((i) => ({ key: i.key, module: i.moduleId, basePath: i.basePath, name: pickName(i, loc ?? config.defaultLocale, config.defaultLocale) }));
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
          title: e.title, summary: e.summary, url: e.url, code: e.code,
          path: entryPath(e, config.defaultLocale), publishedAt: e.publishedAt,
        }));
      },
    },
  };
}
