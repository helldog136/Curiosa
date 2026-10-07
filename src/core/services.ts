import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { uniqueSlug } from "./entries";
import { presetName, type CollectionPreset } from "./presets";
import { slugify } from "./slug";

type Db = PrismaClient | Prisma.TransactionClient;

export async function createCollectionFromPreset(db: Db, preset: CollectionPreset, locales: string[], overrides?: { key?: string; basePath?: string }) {
  const count = await db.collection.count();
  return db.collection.create({
    data: {
      key: overrides?.key ?? preset.key,
      basePath: overrides?.basePath ?? preset.basePath,
      display: preset.display,
      clickAction: preset.clickAction,
      features: JSON.stringify(preset.features),
      showInNav: preset.showInNav,
      allowGoLinks: preset.allowGoLinks,
      navOrder: count,
      translations: {
        create: locales.map((locale) => ({
          locale,
          name: presetName(preset, locale),
          description: preset.descriptions[locale] ?? preset.descriptions.en ?? "",
        })),
      },
    },
  });
}

export type NewEntry = {
  collectionId: string;
  locale: string;
  title: string;
  slug?: string;
  summary?: string;
  body?: string;
  status?: "draft" | "published";
  cover?: string | null;
  icon?: string | null;
  url?: string | null;
  code?: string | null;
  expiresAt?: Date | null;
  featured?: boolean;
  position?: number;
  fields?: Record<string, unknown>;
  authorId?: string | null;
};

export async function createEntry(db: Db, input: NewEntry) {
  const slug = await uniqueSlug(db, input.collectionId, input.locale, slugify(input.slug || input.title));
  const status = input.status ?? "draft";
  return db.entry.create({
    data: {
      collectionId: input.collectionId,
      status,
      publishedAt: status === "published" ? new Date() : null,
      cover: input.cover ?? null,
      icon: input.icon ?? null,
      url: input.url ?? null,
      code: input.code ?? null,
      expiresAt: input.expiresAt ?? null,
      featured: input.featured ?? false,
      position: input.position ?? 0,
      fields: JSON.stringify(input.fields ?? {}),
      sourceLocale: input.locale,
      authorId: input.authorId ?? null,
      translations: {
        create: {
          collectionId: input.collectionId,
          locale: input.locale,
          slug,
          title: input.title,
          summary: input.summary ?? "",
          body: input.body ?? "",
        },
      },
    },
  });
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}
