import { wordmark } from "@/components/brand/wordmark";
import { CREDIT_URL, creditSiteUrl } from "@/core/credit";

/**
 * Le nom « Curiosa » en lien vers le projet, TEL QU'IL APPARAÎT partout : crédit du pied de page du site public et pied de l'administration (même mot, même rendu).
 *
 * Il porte la pièce verrouillée `brand-mark` et le repère `data-curiosa-wordmark` : aucun skin ne peut en changer la police, la casse, l'espacement ni le soulignement
 * (src/core/skins/brand.ts, docs/SKINS.md « Ce qu'un skin ne peut jamais changer : le nom Curiosa »). Sa couleur reste celle que le skin donne au pied.
 * À utiliser pour TOUT nouvel endroit où le nom de Curiosa est écrit : ne jamais réécrire ce lien à la main.
 * `locale` (pied de page public) : le lien va à la page du projet dans la langue de la personne qui visite (`creditSiteUrl`). Sans `locale` (administration) : le dépôt du projet.
 */
export function CuriosaMark({ newTab = false, locale }: { newTab?: boolean; locale?: string }) {
  return (
    <a
      href={locale === undefined ? CREDIT_URL : creditSiteUrl(locale)}
      {...(newTab ? { target: "_blank" } : {})}
      rel="noopener"
      data-skin-part="brand-mark"
      data-curiosa-wordmark=""
      className={`${wordmark.className} ${wordmark.variable} text-[1.15em] underline underline-offset-2 hover:text-fg`}
    >
      Curiosa
    </a>
  );
}
