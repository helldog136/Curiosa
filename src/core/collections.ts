import { cache } from "react";
import type { Collection, CollectionTranslation } from "@prisma/client";
import { prisma } from "./db";

/** Champs de base qu'une collection peut activer dans l'éditeur d'entrée. */
export const FEATURES = ["cover", "icon", "summary", "body", "url", "code", "expiresAt", "featured"] as const;
export type Feature = (typeof FEATURES)[number];

export const DISPLAYS = ["cards", "list", "links", "codes"] as const;
export type Display = (typeof DISPLAYS)[number];

export type FieldDef = { key: string; label: string; type: "text" | "url" | "number" | "boolean" };

export type CollectionView = {
  id: string;
  key: string;
  basePath: string;
  display: Display;
  clickAction: "detail" | "external";
  features: Feature[];
  fieldSchema: FieldDef[];
  showInNav: boolean;
  navOrder: number;
  published: boolean;
  fallbackToDefault: boolean;
  allowGoLinks: boolean;
  names: Record<string, string>;
  descriptions: Record<string, string>;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toCollectionView(c: Collection & { translations: CollectionTranslation[] }): CollectionView {
  const names: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const tr of c.translations) {
    names[tr.locale] = tr.name;
    descriptions[tr.locale] = tr.description;
  }
  return {
    id: c.id,
    key: c.key,
    basePath: c.basePath,
    display: (DISPLAYS as readonly string[]).includes(c.display) ? (c.display as Display) : "cards",
    clickAction: c.clickAction === "external" ? "external" : "detail",
    features: parseJson<string[]>(c.features, []).filter((f): f is Feature =>
      (FEATURES as readonly string[]).includes(f),
    ),
    fieldSchema: parseJson<FieldDef[]>(c.fieldSchema, []),
    showInNav: c.showInNav,
    navOrder: c.navOrder,
    published: c.published,
    fallbackToDefault: c.fallbackToDefault,
    allowGoLinks: c.allowGoLinks,
    names,
    descriptions,
  };
}

export const listCollections = cache(async (): Promise<CollectionView[]> => {
  const rows = await prisma.collection.findMany({
    include: { translations: true },
    orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toCollectionView);
});

export async function getCollectionByKey(key: string): Promise<CollectionView | undefined> {
  return (await listCollections()).find((c) => c.key === key);
}

export async function getCollectionById(id: string): Promise<CollectionView | undefined> {
  return (await listCollections()).find((c) => c.id === id);
}

/** Nom affiché : langue demandée → langue par défaut → première disponible → clé. */
export function pickName(c: CollectionView, locale: string, defaultLocale: string): string {
  return c.names[locale] || c.names[defaultLocale] || Object.values(c.names)[0] || c.key;
}

export function pickDescription(c: CollectionView, locale: string, defaultLocale: string): string {
  return c.descriptions[locale] || c.descriptions[defaultLocale] || "";
}
