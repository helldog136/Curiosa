import type { OverlayPage } from "@prisma/client";
import { MAX_ELEMENTS_PER_PAGE, MAX_PAGES, MAX_SIDE, MIN_SIDE, NAME_MAX, clampInt, isPlainObject, type OverlayPageData } from "./model";
import { cleanName } from "./pageInput";
import { SECRET_RE, newSecret, secretColumns, unsealSecret } from "./secret";
import { parseElements, toData } from "./store";
import { parseStyle } from "./tokens";

/**
 * Sauvegarde et restauration des pages d'overlay (`data/overlay-pages.json`). Le fichier de sauvegarde est chiffré par le mot de passe de la personne : l'adresse secrète y est
 * donc écrite en clair (comme les autres secrets des réglages), pour que les adresses déjà collées dans OBS fonctionnent encore après une restauration, même sur un autre serveur.
 * Le mode test (volatil) n'est pas sauvegardé. À la restauration, les secrets sont de nouveau empreints et chiffrés, et les limites dures sont de nouveau appliquées.
 */
export type BackupOverlayPage = { id: string; name: string; width: number; height: number; active: boolean; style: unknown; elements: unknown; secret: string | null; createdAt: string };

export function toBackupRows(rows: readonly OverlayPage[]): BackupOverlayPage[] {
  return rows.slice(0, MAX_PAGES).map((r) => {
    const d: OverlayPageData = toData(r);
    return { id: d.id, name: d.name, width: d.width, height: d.height, active: d.active, style: d.style, elements: d.elements, secret: unsealSecret(r.secretSealed), createdAt: r.createdAt.toISOString() };
  });
}

type Created = { id: string; name: string; width: number; height: number; active: boolean; style: string; elements: string; secretHash: string; secretSealed: string; rev: number; createdAt: Date };

/** Lignes à recréer, d'après un fichier de sauvegarde (jamais cru sur parole : valeurs ramenées aux bornes, secrets manquants ou invalides régénérés, doublons écartés, 10 actives au plus). */
export function fromBackupRows(rows: unknown): Created[] {
  if (!Array.isArray(rows)) return [];
  const out: Created[] = [];
  const ids = new Set<string>(), hashes = new Set<string>();
  let active = 0;
  for (const r of rows.slice(0, MAX_PAGES)) {
    if (!isPlainObject(r) || typeof r.id !== "string" || r.id.length === 0 || r.id.length > 40 || ids.has(r.id)) continue;
    const name = cleanName(r.name).slice(0, NAME_MAX);
    if (!name) continue;
    let secret = typeof r.secret === "string" && SECRET_RE.test(r.secret) ? r.secret : newSecret();
    let cols = secretColumns(secret);
    if (hashes.has(cols.secretHash)) { secret = newSecret(); cols = secretColumns(secret); }
    ids.add(r.id); hashes.add(cols.secretHash);
    const wantActive = r.active === true && active < 10;
    if (wantActive) active++;
    const elements = parseElements(JSON.stringify(r.elements ?? [])).slice(0, MAX_ELEMENTS_PER_PAGE);
    const created = typeof r.createdAt === "string" ? new Date(r.createdAt) : new Date();
    out.push({
      id: r.id, name, width: clampInt(r.width, MIN_SIDE, MAX_SIDE, 1920), height: clampInt(r.height, MIN_SIDE, MAX_SIDE, 1080), active: wantActive,
      style: JSON.stringify(parseStyle(r.style)), elements: JSON.stringify(elements), ...cols, rev: 1, createdAt: Number.isNaN(created.getTime()) ? new Date() : created,
    });
  }
  return out;
}
