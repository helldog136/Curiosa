import QRCode from "qrcode";

/**
 * SERVICE « QR code » — offert aux modules par le cœur (`ctx.api.qr`).
 * Générique : ne sait rien du site ni des modules. Renvoie un SVG à fond transparent.
 */
export async function qrSvg(text: string): Promise<string> {
  // Correction d'erreur minimale : moins de modules pour une même URL, donc des « pixels » plus gros à l'écran.
  return QRCode.toString(String(text).slice(0, 2000), {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "L",
    color: { dark: "#000000", light: "#0000" },
  });
}
