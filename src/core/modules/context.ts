import QRCode from "qrcode";
import { prisma } from "../db";
import { siteUrl } from "../config";
import { getSiteConfig, getSetting } from "../settings";
import { entryPath, listEntries } from "../entries";
import { getInstanceByKey, listInstances, pickName, type InstanceView } from "../instances";
import { makeTranslator } from "../i18n/dictionary";
import { collect } from "./topics";
import { getActiveInstances, type LoadedModule } from "./registry";
import type { ModuleApi, ModuleContext } from "./types";

export function instanceSettingKey(instanceId: string, key: string): string {
  return `instance.${instanceId}.${key}`;
}

function makeApi(instance: InstanceView, mod: LoadedModule, locale: string): ModuleApi {
  return {
    siteUrl,
    topics: {
      async collect(topic, opts) {
        const consumer = (await getActiveInstances()).find((a) => a.instance.id === instance.id);
        if (!consumer) return [];
        return collect(consumer, topic, { limit: opts?.limit, locale });
      },
    },
    entries: {
      async list({ instance: key, locale, limit } = {}) {
        const config = await getSiteConfig();
        const target = key ? await getInstanceByKey(key) : instance;
        if (!target) return [];
        const views = await listEntries({ instance: target, locale: locale ?? config.defaultLocale, limit });
        return views.map((e) => ({
          id: e.id,
          slug: e.slug,
          cover: e.cover,
          icon: e.icon,
          tags: e.tags,
          fields: e.fields,
          title: e.title,
          summary: e.summary,
          url: e.url,
          code: e.code,
          path: entryPath(e, config.defaultLocale),
          publishedAt: e.publishedAt,
        }));
      },
    },
    async site(locale) {
      const c = await getSiteConfig(locale);
      return { name: c.name, tagline: c.tagline, logo: c.logo };
    },
    instances: {
      async list({ locale, module } = {}) {
        const config = await getSiteConfig();
        return (await listInstances())
          .filter((i) => i.enabled && (!module || i.moduleId === module))
          .map((i) => ({
            key: i.key,
            module: i.moduleId,
            basePath: i.basePath,
            name: pickName(i, locale ?? config.defaultLocale, config.defaultLocale),
          }));
      },
    },
    async qr(text) {
      // Correction d'erreur minimale : moins de modules pour une même URL, donc des « pixels » plus gros à l'écran.
      return QRCode.toString(String(text).slice(0, 2000), { type: "svg", margin: 0, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#0000" } });
    },
    store: {
      async get(id) {
        const r = await prisma.moduleRecord.findFirst({ where: { id, instanceId: instance.id } });
        return r ? { id: r.id, createdAt: r.createdAt, data: JSON.parse(r.data) } : null;
      },
      async update(id, data) {
        const res = await prisma.moduleRecord.updateMany({ where: { id, instanceId: instance.id }, data: { data: JSON.stringify(data) } });
        return res.count > 0;
      },
      async add(collection, data) {
        const row = await prisma.moduleRecord.create({
          data: { instanceId: instance.id, collection, data: JSON.stringify(data) },
        });
        return row.id;
      },
      async list(collection, opts) {
        const rows = await prisma.moduleRecord.findMany({
          where: { instanceId: instance.id, collection },
          orderBy: { createdAt: "desc" },
          take: opts?.limit ?? 100,
        });
        return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, data: JSON.parse(r.data) }));
      },
      async remove(id) {
        await prisma.moduleRecord.deleteMany({ where: { id, instanceId: instance.id } });
      },
      count(collection) {
        return prisma.moduleRecord.count({ where: { instanceId: instance.id, collection } });
      },
    },
  };
}

/** Contexte d'exécution d'un module pour une instance donnée. */
export async function buildContext(mod: LoadedModule, instance: InstanceView, locale?: string): Promise<ModuleContext> {
  const config = await getSiteConfig();
  const loc = locale ?? config.defaultLocale;

  const values: Record<string, unknown> = {};
  for (const field of mod.manifest.settings) {
    const stored = await getSetting(instanceSettingKey(instance.id, field.key), loc);
    values[field.key] = stored ?? field.default;
  }

  const dict = (code: string) => mod.locales[code] ?? {};
  const ui = makeTranslator(loc);
  return {
    moduleId: mod.manifest.id,
    instance: { id: instance.id, key: instance.key, basePath: instance.basePath, name: pickName(instance, loc, config.defaultLocale) },
    locale: loc,
    defaultLocale: config.defaultLocale,
    locales: config.locales,
    setting: <T = string>(key: string) => values[key] as T | undefined,
    t(key, vars) {
      let text = dict(loc)[key] ?? dict(config.defaultLocale)[key] ?? dict("en")[key];
      if (text === undefined) return ui(key, vars);
      for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
    api: makeApi(instance, mod, loc),
  };
}
