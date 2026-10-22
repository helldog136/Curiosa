import crypto from "node:crypto";
import { clientIp } from "../auth/clientIp";

/**
 * `ctx.api.visitor.fingerprint(request, scope?)` : une EMPREINTE du visiteur pour les limites de débit et le comptage des modules, au lieu de lire
 * eux-mêmes `X-Forwarded-For` (dont le début est inventé par le visiteur). L'adresse vient de `clientIp` : l'entrée que NOTRE proxy a ajoutée à la fin
 * de l'en-tête (règle de docs/SECURITE.md, `CURIOSA_TRUSTED_PROXIES`), jamais la première ; une adresse IPv6 compte pour tout son réseau /64.
 * - Non réversible : HMAC-SHA-256 avec un SEL tiré au hasard, gardé en mémoire seulement (jamais écrit sur disque, jamais envoyé) ; l'adresse n'est
 *   ni gardée ni journalisée, et le résultat ne permet pas de la retrouver.
 * - Sel renouvelé chaque jour (UTC) ; l'ancien est oublié tout de suite : les empreintes d'hier ne se comparent plus à celles d'aujourd'hui.
 * - Cloisonnée : l'empreinte dépend aussi du module et de `scope`, donc deux modules ne peuvent pas recouper leurs visiteurs.
 * - Mémoire bornée : le cœur ne garde RIEN par visiteur (le sel seul, 32 octets). Les compteurs, eux, restent au module, qui doit les borner.
 */
const DAY_MS = 86_400_000;
const SCOPE_MAX = 64;
const FINGERPRINT_CHARS = 22; // 132 bits en base64url

type Holder = { day: number; salt: Buffer };
// Sur `globalThis` : Next peut charger ce fichier dans plusieurs paquets, et le sel doit être UN SEUL pour tout le processus.
const state = globalThis as unknown as { curiosaVisitorSalt?: Holder };

function saltFor(now: number): Buffer {
  const day = Math.floor(now / DAY_MS);
  if (!state.curiosaVisitorSalt || state.curiosaVisitorSalt.day !== day) state.curiosaVisitorSalt = { day, salt: crypto.randomBytes(32) };
  return state.curiosaVisitorSalt.salt;
}

/** Remet le sel à zéro (tests seulement). */
export function resetVisitorSalt(): void {
  state.curiosaVisitorSalt = undefined;
}

/** Les en-têtes d'une requête (`Request`) ou directement un `Headers` ; autre chose = pas d'en-tête (un visiteur « local »). */
function headersOf(source: unknown): { get(name: string): string | null } | null {
  if (source && typeof source === "object") {
    const h = (source as { headers?: unknown }).headers ?? source;
    if (h && typeof (h as { get?: unknown }).get === "function") return h as { get(name: string): string | null };
  }
  return null;
}

export function visitorFingerprint(moduleId: string, source: unknown, scope?: string, now: number = Date.now()): string {
  const headers = headersOf(source);
  const ip = clientIp((name) => headers?.get(name));
  const label = String(scope ?? "").slice(0, SCOPE_MAX);
  return crypto.createHmac("sha256", saltFor(now)).update(`${moduleId}\n${label}\n${ip}`).digest("base64url").slice(0, FINGERPRINT_CHARS);
}
