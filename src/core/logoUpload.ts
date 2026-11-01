import { storeUpload } from "@/core/services/uploads";
import { LOGO_SVG_LIMITS, sanitizeSvg } from "@/core/svg";

/** Un SVG est du texte : reconnu à sa balise racine. Jamais enregistré tel quel (voir `saveSvgUpload`). */
export const looksLikeSvg = (buf: Buffer): boolean => /^\s*(<\?xml[\s\S]{0,400}?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.subarray(0, 1200).toString("utf8").replace(/^\uFEFF/, ""));

export type SvgUploadResult = { url: string } | { error: "format" } | { error: "svg"; detail: string };

/**
 * Envoi d'un SVG (logos seulement) : le dessin est relu élément par élément et RÉÉCRIT à partir de ce qui est reconnu (voir core/svg.ts) ;
 * ce qui est enregistré est la version nettoyée, jamais le fichier reçu. Scripts, styles, textes, images intégrées et liens externes sont refusés
 * avec un message précis.
 */
export async function saveSvgUpload(buf: Buffer): Promise<SvgUploadResult> {
  if (!looksLikeSvg(buf)) return { error: "format" };
  const result = sanitizeSvg(buf.toString("utf8"), undefined, "contain", "center", LOGO_SVG_LIMITS);
  if (!result.ok) return { error: "svg", detail: result.error };
  return { url: await storeUpload(result.svg, "svg") };
}
