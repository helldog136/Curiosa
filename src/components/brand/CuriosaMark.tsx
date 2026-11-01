import { wordmark } from "@/components/brand/wordmark";
import { CREDIT_URL } from "@/core/credit";

/**
 * Le nom « Curiosa » en lien vers le projet, TEL QU'IL APPARAÎT partout : crédit du pied de page du site public et pied de l'administration (même mot, même rendu).
 *
 * Il porte la pièce verrouillée `brand-mark` et le repère `data-curiosa-wordmark` : aucun skin ne peut en changer la police, la casse, l'espacement ni le soulignement
 * (src/core/skins/brand.ts, docs/SKINS.md « Ce qu'un skin ne peut jamais changer : le nom Curiosa »). Sa couleur reste celle que le skin donne au pied.
 * À utiliser pour TOUT nouvel endroit où le nom de Curiosa est écrit : ne jamais réécrire ce lien à la main.
 */
export function CuriosaMark({ newTab = false }: { newTab?: boolean }) {
  return (
    <a
      href={CREDIT_URL}
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
