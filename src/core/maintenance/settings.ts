import { prisma } from "@/core/db";

/**
 * Réglages de la maintenance par IA, tous modifiables par le propriétaire seulement (voir app/admin/(panel)/maintenance-ia).
 *  - validation : par jeton, « human » (DÉFAUT : une demande en attente, un humain approuve) ou « direct » (l'action s'exécute tout de suite) ;
 *  - avertissement : « admin » (DÉFAUT : pastille et encadrés dans l'admin) ou « email » (aussi un e-mail au propriétaire) ;
 *  - dernière visite de la page « Maintenance par IA » (pour savoir ce que le propriétaire n'a pas encore vu).
 * Lus directement en base (pas via le cache de requête) : un réglage change d'effet à la requête suivante.
 */
export type ApprovalMode = "human" | "direct";
export type NotifyMode = "admin" | "email";

const KEYS = { approval: "maintenance.approval", notify: "maintenance.notify", seen: "maintenance.seenAt" } as const;

async function read<T>(key: string): Promise<T | undefined> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } } });
  if (!row) return undefined;
  try { return JSON.parse(row.value) as T; } catch { return undefined; }
}
async function write(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
}

export async function getApprovalModes(): Promise<Record<string, ApprovalMode>> {
  const v = await read<Record<string, unknown>>(KEYS.approval);
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, m]) => m === "direct")) as Record<string, ApprovalMode>;
}

/** Sans réglage explicite : validation humaine. */
export async function getApprovalMode(tokenId: string | undefined): Promise<ApprovalMode> {
  return tokenId && (await getApprovalModes())[tokenId] === "direct" ? "direct" : "human";
}

export async function setApprovalMode(tokenId: string, mode: ApprovalMode): Promise<void> {
  const all = await getApprovalModes();
  if (mode === "direct") all[tokenId] = "direct"; else delete all[tokenId];
  await write(KEYS.approval, all);
}

export async function getNotifyMode(): Promise<NotifyMode> {
  return (await read<string>(KEYS.notify)) === "email" ? "email" : "admin";
}
export async function setNotifyMode(mode: NotifyMode): Promise<void> {
  await write(KEYS.notify, mode === "email" ? "email" : "admin");
}

export async function getSeenAt(): Promise<number> {
  return Number(await read<number>(KEYS.seen)) || 0;
}
export async function markSeen(now = Date.now()): Promise<void> {
  await write(KEYS.seen, now);
}
