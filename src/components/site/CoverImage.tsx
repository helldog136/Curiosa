/* eslint-disable @next/next/no-img-element -- le site n'optimise aucune image avec Next : le serveur fabrique lui-même la version cadrée (/uploads) */
import { refRatio } from "@/core/imageCrop";

/**
 * Image de couverture d'une entrée, au ratio choisi par la personne (jamais figé à 16:9, jamais déformée).
 *  - `article` : en grand sur la page ; hauteur bornée (32 rem, 75 % de l'écran) pour qu'une image haute ne prenne pas tout un téléphone, centrée si elle est plus étroite que la colonne ;
 *  - `card` : dans une liste ; pleine largeur de la carte, hauteur bornée à 18 rem (une image très haute y est centrée plutôt que d'allonger la carte).
 * Le ratio d'un cadrage est connu d'avance (`width`/`height`) : la place est réservée avant le chargement. Sans cadrage, l'image garde son propre ratio.
 */
export function CoverImage({ src, variant }: { src: string; variant: "article" | "card" }) {
  const ratio = refRatio(src);
  const dims = ratio ? { width: 1600, height: Math.max(1, Math.round(1600 / ratio)) } : {};
  return variant === "article"
    ? <img src={src} alt="" {...dims} className="mx-auto h-auto max-h-[min(32rem,75vh)] w-auto max-w-full rounded-xl object-contain" data-cover="article" data-skin-part="cover" />
    : <img src={src} alt="" loading="lazy" {...dims} className="h-auto max-h-72 w-full object-cover" data-cover="card" data-skin-part="cover" />;
}
