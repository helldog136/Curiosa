import { prisma } from "@/core/db";
import { cleanTitle, rawgCandidates, rawgCover, type RawgCandidates } from "@/core/services/rawg";
import { dismissDoubtful, forgetAllFixes, MAX_FIX_TITLE, forgetFix, rawgImagePath, readToCheck, saveFix, type Fix } from "@/core/services/rawgFixes";
import { titleKey } from "@/core/services/rawgMatch";

/**
 * CORRIGER UNE JAQUETTE — les opérations communes à l'écran d'administration et aux outils MCP (un seul chemin, donc les mêmes règles partout).
 *
 * Règles : le titre est borné (120 caractères) ; le choix d'un jeu se fait par son NUMÉRO RAWG et l'image vient de la réponse de RAWG (jamais d'une adresse
 * envoyée par la personne) ; une image donnée à la main doit être une adresse `https://media.rawg.io/media/…` (rien n'est téléchargé : le cœur garde l'adresse) ;
 * au plus 1000 corrections ; une cadence limitée par personne (ou par jeton) pour les lectures chez RAWG comme pour les écritures.
 */
export type FixError = "title" | "full" | "candidate" | "image" | "rate" | "nothing" | "no-key" | "refused" | "unreachable";
export type FixOutcome = { ok: true; fix: Fix } | { ok: false; error: FixError };

const RATE = { read: { max: 30, perMs: 60_000 }, write: { max: 60, perMs: 60_000 } } as const;
const hits = new Map<string, number[]>();
/** Prend une place dans la cadence de cette personne ; faux si elle a trop demandé. Mémoire bornée (500 personnes ou jetons au plus). */
export function takeRate(who: string, kind: keyof typeof RATE, now = Date.now()): boolean {
  const key = `${kind}:${who.slice(0, 80)}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE[kind].perMs);
  if (recent.length >= RATE[kind].max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > 500) hits.delete(hits.keys().next().value as string);
  return true;
}
export function resetRawgRate(): void { hits.clear(); }

/** Le titre tel qu'il sera gardé : nettoyé, jamais vide ni plus long que 120 caractères. */
export function checkTitle(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 400) return null;
  const title = cleanTitle(input, MAX_FIX_TITLE + 1);
  return title && title.length <= MAX_FIX_TITLE && titleKey(title) ? title : null;
}

/** Les jeux proposés pour ce titre (6 au plus), à la demande. */
export async function candidatesFor(who: string, title: string, search?: string): Promise<RawgCandidates | { status: "rate"; candidates: [] }> {
  if (!takeRate(who, "read")) return { status: "rate", candidates: [] };
  return rawgCandidates(title, search);
}

/** « C'est ce jeu » : garde le jeu de numéro `rawgId` parmi les propositions de RAWG pour ce titre (ou pour `search`). */
export async function chooseGame(who: string, rawTitle: string, rawgId: number, search?: string): Promise<FixOutcome> {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!Number.isSafeInteger(rawgId) || rawgId <= 0) return { ok: false, error: "candidate" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const found = await rawgCandidates(title, search);
  if (found.status === "no-key" || found.status === "refused" || found.status === "unreachable") return { ok: false, error: found.status };
  const game = found.candidates.find((c) => c.id === rawgId);
  const img = game ? rawgImagePath(game.url) : null;
  if (!game) return { ok: false, error: "candidate" };
  if (!img) return { ok: false, error: "image" };
  return finish(await saveFix(title, { kind: "game", rawgId: game.id, name: game.name, img }));
}

/** « Aucune jaquette » : ce titre n'aura plus de jaquette. */
export async function chooseNone(who: string, rawTitle: string): Promise<FixOutcome> {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  return finish(await saveFix(title, { kind: "none" }));
}

/** Une image de RAWG choisie à la main (adresse `https://media.rawg.io/media/…` uniquement). */
export async function chooseImage(who: string, rawTitle: string, address: string): Promise<FixOutcome> {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  const img = rawgImagePath(typeof address === "string" ? address.trim() : "");
  if (!img) return { ok: false, error: "image" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  return finish(await saveFix(title, { kind: "image", img }));
}

/** « Ce choix est bon » : garde le jeu actuellement trouvé pour ce titre, tel quel, et le retire de la liste. */
export async function confirmCurrent(who: string, rawTitle: string): Promise<FixOutcome> {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const key = titleKey(title);
  const entry = (await readToCheck()).find((d) => d.key === key);
  if (entry) return finish(await saveFix(entry.title, entry.rawgId ? { kind: "game", rawgId: entry.rawgId, name: entry.name, img: entry.img } : { kind: "image", img: entry.img, name: entry.name }));
  // Pas dans la liste (page ouverte à la main) : on garde ce que RAWG donne en ce moment.
  const now = await rawgCover(title);
  if (now.status !== "found" || !now.url) return { ok: false, error: now.status === "none" ? "nothing" : now.status === "found" ? "image" : now.status };
  const img = rawgImagePath(now.url);
  if (!img) return { ok: false, error: "image" };
  return finish(await saveFix(title, now.id ? { kind: "game", rawgId: now.id, name: now.name ?? "", img } : { kind: "image", img, name: now.name }));
}

/** Oublie la correction d'un titre (clé normalisée) : le titre retrouve le choix automatique. */
export async function forget(who: string, key: string): Promise<boolean> {
  if (typeof key !== "string" || key.length > 160 || !takeRate(who, "write")) return false;
  return forgetFix(key);
}
export async function forgetAll(who: string): Promise<number | null> {
  return takeRate(who, "write") ? forgetAllFixes() : null;
}
/** Retire un titre de la liste sans le corriger (rarement utile : la liste se vide d'elle-même). */
export const dismiss = dismissDoubtful;

function finish(r: Awaited<ReturnType<typeof saveFix>>): FixOutcome {
  return r.ok ? r : { ok: false, error: r.error };
}

/** Une ligne d'audit lisible (titre et choix, jamais de secret). */
export async function auditFix(actor: string, action: "rawg.fix" | "rawg.fix.forget" | "rawg.fix.forgetAll", target: string): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target: target.slice(0, 300) } }).catch(() => {});
}

export const fixSummary = (f: Fix): string => `${f.title} → ${f.kind === "none" ? "no cover" : f.kind === "image" ? "image" : `${f.name ?? ""} #${f.rawgId ?? ""}`}`.slice(0, 300);

/** Adresse stable de l'écran de correction d'un titre (pour qu'un module écrive « Ce n'est pas le bon jeu ? »). Le titre est lu et validé côté serveur. */
export const RAWG_FIX_PATH = "/admin/settings/rawg-covers";
export const rawgFixUrl = (title: string): string => `${RAWG_FIX_PATH}?titre=${encodeURIComponent(cleanTitle(title))}`;
