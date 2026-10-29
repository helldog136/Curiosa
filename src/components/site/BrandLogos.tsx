/* eslint-disable @next/next/no-img-element */
/**
 * Les images de la marque dans l'en-tête. Le logo horizontal contient déjà le nom ; sans lui, l'icône (ou rien) et le nom écrit. Sur petit écran : l'icône si on en a une.
 * Quand le site propose la bascule clair/sombre et qu'un logo a deux variantes (clair + sombre), les DEUX images sont rendues (`data-for="light"` / `"dark"`) et
 * le CSS du cœur (globals.css) montre celle du mode effectif : un skin n'y touche pas (docs/SKINS.md §3.8).
 */
export type LogoVariants = [light: string, dark: string];

export function BrandLogos({ name, wide, icon, wideVariants, iconVariants }: { name: string; wide: string | null; icon: string | null; wideVariants: LogoVariants | null; iconVariants: LogoVariants | null }) {
  // Sur petit écran l'icône remplace le logo horizontal (quand les deux existent) : règles `data-logo` / `data-paired` de la feuille du cœur (globals.css).
  const wideClass = "h-9 w-auto max-w-[14rem] object-contain";
  const iconClass = "h-9 w-9 object-contain";
  const wideAttrs = { "data-logo": "wide", "data-paired": icon ? "" : undefined };
  const iconAttrs = { "data-logo": "icon", "data-paired": wide ? "" : undefined };
  return (
    <>
      {wide && (wideVariants
        ? (["light", "dark"] as const).map((m, i) => <img key={m} src={wideVariants[i]} data-for={m} {...wideAttrs} alt={name} className={wideClass} />)
        : <img src={wide} {...wideAttrs} alt={name} className={wideClass} />)}
      {icon && (iconVariants
        ? (["light", "dark"] as const).map((m, i) => <img key={m} src={iconVariants[i]} data-for={m} {...iconAttrs} alt="" className={iconClass} />)
        : <img src={icon} {...iconAttrs} alt="" className={iconClass} />)}
    </>
  );
}
