import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db";
import { MODULES_DIR } from "./config";
import { parseManifest } from "./modules/manifest";

/**
 * EN-TÊTE « Permissions-Policy » (cœur 0.2.12). Caméra et micro sont TOUJOURS fermés. La position du visiteur n'est permise qu'au site lui-même (`self`,
 * jamais un tiers, jamais un joker) ET seulement si au moins un module installé la demande (permission `visitor.geolocation` de son module.json).
 * Sinon `geolocation=()`. Principe du moindre privilège : un site sans module qui en a besoin n'ouvre rien.
 *
 * OÙ : next.config.mjs pose la valeur FERMÉE sur tout le site (admin, API, fichiers compris) ; le proxy (src/proxy.ts) ne l'ouvre que sur les pages publiques
 * qu'il traite, et seulement si ce garde répond « oui ». Le proxy ne doit pas lire la base à chaque page : le garde garde sa réponse en mémoire (TTL court),
 * la recalcule dès qu'un module est installé, mis à jour ou désinstallé (`forgetModule`, `resetModuleRegistry`) et retombe sur FERMÉ au moindre doute
 * (base ou fichier illisible, délai dépassé, manifeste invalide). Un module installé = actif (il n'y a plus d'état intermédiaire depuis la 0.1.20).
 */
export const GEOLOCATION_PERMISSION = "visitor.geolocation";

export const POLICY_CLOSED = "camera=(), microphone=(), geolocation=()";
export const POLICY_GEOLOCATION = "camera=(), microphone=(), geolocation=(self)";

export const policyValue = (geolocationOpen: boolean): string => (geolocationOpen ? POLICY_GEOLOCATION : POLICY_CLOSED);

/** Ce module.json (texte brut) déclare-t-il le besoin ? Un manifeste invalide ne déclare rien (le cœur ne chargerait pas ce module). */
export function declaresGeolocation(raw: unknown): boolean {
  const parsed = parseManifest(raw);
  return parsed.ok && parsed.manifest.permissions.includes(GEOLOCATION_PERMISSION);
}

export type PolicyGate = { isOpen(): Promise<boolean>; invalidate(): void };

const TTL_MS = 30_000;
const RETRY_MS = 5_000;

/** Garde avec cache. `load` répond « au moins un module le demande ? » ; toute exception = fermé (et nouvelle tentative rapide). */
export function createPolicyGate(load: () => Promise<boolean>, opts: { ttlMs?: number; retryMs?: number; now?: () => number } = {}): PolicyGate {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;
  const now = opts.now ?? Date.now;
  let value = false;
  let expires = 0;
  let loading: Promise<void> | null = null;
  let generation = 0;
  const refresh = (): Promise<void> => {
    if (loading) return loading;
    const mine = generation;
    loading = (async () => {
      let next = false;
      let ttl = retryMs;
      try { next = (await load()) === true; ttl = ttlMs; } catch { next = false; }
      // Une invalidation arrivée pendant la lecture : cette réponse est peut-être périmée, on la sert mais on la relira tout de suite.
      value = next;
      expires = mine === generation ? now() + ttl : 0;
    })().finally(() => { loading = null; });
    return loading;
  };
  return {
    async isOpen() {
      if (now() >= expires) await refresh();
      return value;
    },
    invalidate() { generation++; expires = 0; },
  };
}

/** Lecture réelle : les modules installés (table Module) dont le module.json valide déclare la permission. Au plus 500 modules lus. */
async function loadFromDisk(): Promise<boolean> {
  const rows = await prisma.module.findMany({ select: { id: true }, take: 500 });
  for (const { id } of rows) {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) continue;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(MODULES_DIR, id, "module.json"), "utf8")); } catch { continue; } // module absent ou illisible : il ne tourne pas
    if (declaresGeolocation(raw)) return true;
  }
  return false;
}

const g = globalThis as unknown as { curiosaPolicyGate?: PolicyGate };
const gate = (): PolicyGate => (g.curiosaPolicyGate ??= createPolicyGate(loadFromDisk));

/** À appeler quand un module est installé, mis à jour, réinstallé ou désinstallé : la prochaine page vue relit. */
export function invalidatePermissionsPolicy(): void { gate().invalidate(); }

/** La position du visiteur peut-elle être permise sur les pages publiques ? Faux au moindre doute. */
export function geolocationOpen(): Promise<boolean> { return gate().isOpen().catch(() => false); }
