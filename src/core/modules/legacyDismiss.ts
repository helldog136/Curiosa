import { prisma } from "@/core/db";

/**
 * « Garder tel quel » (page Entretien) : un module copié par une très ancienne version de Curiosa que le catalogue ne propose plus ne passera jamais
 * seul au catalogue. L'administrateur peut le retirer (en gardant ses données), ou dire qu'il le garde tel quel : il ne retient alors plus la mise à
 * niveau. Règle : le marqueur `core.legacyCleared` peut être posé quand les seules lignes héritées restantes sont des modules ABSENTS du catalogue que
 * l'administrateur a ainsi gardés (ou qu'il a retirés : leur ligne n'existe plus). Liste d'identifiants dans un réglage, bornée.
 */
export const DISMISSED_KEY = "core.legacyDismissed";
export const DISMISSED_MAX = 50;

export async function readDismissed(): Promise<string[]> {
  const raw = (await prisma.setting.findUnique({ where: { key_locale: { key: DISMISSED_KEY, locale: "" } } }).catch(() => null))?.value;
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, DISMISSED_MAX) : [];
  } catch { return []; }
}

async function write(list: string[]): Promise<void> {
  const value = JSON.stringify([...new Set(list)].sort().slice(0, DISMISSED_MAX));
  await prisma.setting.upsert({ where: { key_locale: { key: DISMISSED_KEY, locale: "" } }, create: { key: DISMISSED_KEY, locale: "", value }, update: { value } });
}

export async function dismissLegacyRow(id: string): Promise<void> { await write([...(await readDismissed()), id]); }
export async function undoDismissLegacyRow(id: string): Promise<void> { await write((await readDismissed()).filter((x) => x !== id)); }
