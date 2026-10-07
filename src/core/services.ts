import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { uniqueSlug } from "./entries";
import { slugify } from "./slug";

type Db = PrismaClient | Prisma.TransactionClient;

export type NewEntry = {
  instanceId: string;
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
  tags?: string[];
  position?: number;
  fields?: Record<string, unknown>;
  authorId?: string | null;
};

export async function createEntry(db: Db, input: NewEntry) {
  const slug = await uniqueSlug(db, input.instanceId, input.locale, slugify(input.slug || input.title));
  const status = input.status ?? "draft";
  return db.entry.create({
    data: {
      instanceId: input.instanceId,
      status,
      publishedAt: status === "published" ? new Date() : null,
      cover: input.cover ?? null,
      icon: input.icon ?? null,
      url: input.url ?? null,
      code: input.code ?? null,
      expiresAt: input.expiresAt ?? null,
      featured: input.featured ?? false,
      tags: JSON.stringify(input.tags ?? []),
      position: input.position ?? 0,
      fields: JSON.stringify(input.fields ?? {}),
      sourceLocale: input.locale,
      authorId: input.authorId ?? null,
      translations: {
        create: {
          instanceId: input.instanceId,
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
