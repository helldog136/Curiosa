import { cache } from "react";
import type { InstanceTranslation, ModuleInstance } from "@prisma/client";
import { prisma } from "./db";

/** Champs de base qu'une instance à contenu peut activer dans l'éditeur d'entrée. */
export const FEATURES = ["cover", "icon", "summary", "body", "url", "code", "expiresAt", "featured", "tags"] as const;
export type Feature = (typeof FEATURES)[number];

export const DISPLAYS = ["cards", "list", "links", "codes"] as const;
export type Display = (typeof DISPLAYS)[number];

/** Champ personnalisé. `ref` : référence vers un élément d'un autre module (liste déroulante alimentée par le sujet `topic`). */
export type FieldDef = { key: string; label: string; type: "text" | "url" | "number" | "boolean" | "ref"; topic?: string };

/** Une instance de module : un exemplaire configuré (un blog, une liste de réseaux…). */
export type InstanceView = {
  id: string;
  moduleId: string;
  key: string;
  /** Chemin public où l'instance est montée ("" = racine, null = pas de page). */
  basePath: string | null;
  enabled: boolean;
  showInNav: boolean;
  navOrder: number;
  display: Display;
  clickAction: "detail" | "external";
  features: Feature[];
  fieldSchema: FieldDef[];
  fallbackToDefault: boolean;
  allowGoLinks: boolean;
  /** Entrées proposées aux autres modules (sujet core.entry). */
  exposed: boolean;
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

export function toInstanceView(c: ModuleInstance & { translations: InstanceTranslation[] }): InstanceView {
  const names: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const tr of c.translations) {
    names[tr.locale] = tr.name;
    descriptions[tr.locale] = tr.description;
  }
  return {
    id: c.id,
    moduleId: c.moduleId,
    key: c.key,
    basePath: c.basePath,
    enabled: c.enabled,
    showInNav: c.showInNav,
    navOrder: c.navOrder,
    display: (DISPLAYS as readonly string[]).includes(c.display) ? (c.display as Display) : "cards",
    clickAction: c.clickAction === "external" ? "external" : "detail",
    features: parseJson<string[]>(c.features, []).filter((f): f is Feature => (FEATURES as readonly string[]).includes(f)),
    fieldSchema: parseJson<FieldDef[]>(c.fieldSchema, []),
    fallbackToDefault: c.fallbackToDefault,
    allowGoLinks: c.allowGoLinks,
    exposed: c.exposed,
    names,
    descriptions,
  };
}

export const listInstances = cache(async (): Promise<InstanceView[]> => {
  const rows = await prisma.moduleInstance.findMany({
    include: { translations: true },
    orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toInstanceView);
});

export async function getInstanceByKey(key: string): Promise<InstanceView | undefined> {
  return (await listInstances()).find((c) => c.key === key);
}

export async function getInstanceById(id: string): Promise<InstanceView | undefined> {
  return (await listInstances()).find((c) => c.id === id);
}

/** Nom affiché : langue demandée → langue par défaut → première disponible → clé. */
export function pickName(c: Pick<InstanceView, "names" | "key">, locale: string, defaultLocale: string): string {
  return c.names[locale] || c.names[defaultLocale] || Object.values(c.names)[0] || c.key;
}

export function pickDescription(c: Pick<InstanceView, "descriptions">, locale: string, defaultLocale: string): string {
  return c.descriptions[locale] || c.descriptions[defaultLocale] || "";
}
