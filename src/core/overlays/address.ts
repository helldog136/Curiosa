import type { OverlayElementDecl } from "./decl";
import type { OptionValues, OverlayStyle } from "./model";
import { OPTION_PARAM_PREFIX, PARAM_PREFIX } from "./tokens";
import type { FrameLayout } from "./layout";

/**
 * Adresse d'un élément : ce que le module répond, nettoyé et complété par le cœur. Pur.
 * Le module ne peut répondre que par un CHEMIN du site (jamais une adresse externe : l'élément n'a ainsi aucun accès hors du site, et la politique de sécurité de la page
 * le sait d'avance). Les paramètres `ov-*` et `opt-*` sont à nous : ceux que le module aurait mis sont retirés puis remplacés.
 */
const PATH_RE = /^\/[A-Za-z0-9._~/%:@+=-]{0,400}$/;
export const MAX_ADDRESS = 2000;

export function parseAddress(raw: unknown): { path: string; search: URLSearchParams } | null {
  const url = raw && typeof raw === "object" ? (raw as { url?: unknown }).url : undefined;
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_ADDRESS || /[\s\\\u0000-\u001f\u007f]/.test(url) || url.startsWith("//") || url.includes("#")) return null;
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  if (!PATH_RE.test(path) || path.split("/").some((s) => s === "..")) return null;
  try { return { path, search: new URLSearchParams(q === -1 ? "" : url.slice(q + 1)) }; } catch { return null; }
}

export type AddressInput = { decl: OverlayElementDecl; layout: FrameLayout; style: OverlayStyle; options: OptionValues; lang: string };

/** Adresse finale (chemin + paramètres). `demo` : ajoute `ov-demo=1` (contenu d'exemple du mode test, seulement pour un élément qui le déclare). */
export function finalAddress(base: { path: string; search: URLSearchParams }, i: AddressInput, demo = false): string {
  const p = new URLSearchParams();
  for (const [k, v] of base.search) if (!k.startsWith(PARAM_PREFIX) && !k.startsWith(OPTION_PARAM_PREFIX)) p.append(k, v);
  p.set("ov-w", String(i.layout.iframeW));
  p.set("ov-h", String(i.layout.iframeH));
  p.set("ov-fit", i.decl.fit);
  p.set("ov-lang", i.lang);
  if (i.decl.followsStyle) { p.set("ov-text", i.style.text); p.set("ov-surface", i.style.background); p.set("ov-corners", i.style.corners); }
  for (const [k, v] of Object.entries(i.options)) p.set(`${OPTION_PARAM_PREFIX}${k}`, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  if (demo && i.decl.demo) p.set("ov-demo", "1");
  const s = p.toString();
  return s ? `${base.path}?${s}` : base.path;
}
