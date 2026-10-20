import localFont from "next/font/local";

/**
 * La police du nom « Curiosa » (Fraunces italique, SIL Open Font License : curiosa-wordmark.OFL.txt).
 * Le fichier ne contient que les lettres de ce mot (≈ 2 Ko) : le crédit de bas de page ne coûte rien au chargement.
 */
export const wordmark = localFont({
  src: "./curiosa-wordmark.woff2",
  weight: "600",
  style: "italic",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
