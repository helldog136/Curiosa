import { prisma } from "../db";
import { siteUrl } from "../config";
import { listCollections, pickName } from "../collections";
import { entryPath, listEntries } from "../entries";
import { getSetting, getSiteConfig } from "../settings";
import { makeTranslator } from "../i18n/dictionary";
import type { LoadedModule } from "./registry";
import type { ModuleApi, ModuleContext } from "./types";

export function moduleSettingKey(moduleId: string, key: string): string {
  return `module.${moduleId}.${key}`;
}

function makeApi(moduleId: string): ModuleApi {
  return {
    siteUrl,
    entries: {
      async list({ collection, locale, limit }) {
        const config = await getSiteConfig();
        const views = await listEntries({ collection, locale: locale ?? config.defaultLocale, limit });
        return views.map((e) => ({
          title: e.title,
          summary: e.summary,
          url: e.url,
          code: e.code,
          path: entryPath(e, config.defaultLocale),
          publishedAt: e.publishedAt,
        }));
      },
    },
    collections: {
      async list(locale) {
        const config = await getSiteConfig();
        return (await listCollections())
          .filter((c) => c.published)
          .map((c) => ({
            key: c.key,
            basePath: c.basePath,
            name: pickName(c, locale ?? config.defaultLocale, config.defaultLocale),
          }));
      },
    },
    store: {
      async add(collection, data) {
        const row = await prisma.moduleRecord.create({
          data: { moduleId, collection, data: JSON.stringify(data) },
        });
        return row.id;
      },
      async list(collection, opts) {
        const rows = await prisma.moduleRecord.findMany({
          where: { moduleId, collection },
          orderBy: { createdAt: "desc" },
          take: opts?.limit ?? 100,
        });
        return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, data: JSON.parse(r.data) }));
      },
      async remove(id) {
        await prisma.moduleRecord.deleteMany({ where: { id, moduleId } });
      },
      count(collection) {
        return prisma.moduleRecord.count({ where: { moduleId, collection } });
      },
    },
  };
}

export async function buildContext(mod: LoadedModule, locale?: string): Promise<ModuleContext> {
  const config = await getSiteConfig();
  const loc = locale ?? config.defaultLocale;
  const id = mod.manifest.id;

  const values: Record<string, unknown> = {};
  for (const field of mod.manifest.settings) {
    const stored = await getSetting(moduleSettingKey(id, field.key), loc);
    values[field.key] = stored ?? field.default;
  }

  const dict = (code: string) => mod.locales[code] ?? {};
  const ui = makeTranslator(loc);
  return {
    moduleId: id,
    locale: loc,
    defaultLocale: config.defaultLocale,
    locales: config.locales,
    setting: <T = string>(key: string) => values[key] as T | undefined,
    t(key, vars) {
      let text = dict(loc)[key] ?? dict(config.defaultLocale)[key] ?? dict("en")[key];
      if (text === undefined) return ui(key, vars) === key ? key : ui(key, vars);
      for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
    api: makeApi(id),
  };
}
