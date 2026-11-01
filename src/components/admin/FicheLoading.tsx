"use client";

import { useProgressText } from "./ProgressLabels";
import { FicheSkeleton } from "./FicheSkeleton";
import { RouteModal } from "./RouteModal";

/** Ce que `loading.tsx` montre dès le clic : les textes viennent du fournisseur de l'administration (aucune attente côté serveur). Dans la fenêtre, avec son bouton « Fermer ». */
export function FicheLoading({ embedded }: { embedded: boolean }) {
  const p = useProgressText();
  const skeleton = <FicheSkeleton text={p("opening")} embedded={embedded} back={p("ficheBack")} />;
  return embedded ? <RouteModal size="medium" testid="catalogue-modal" label={p("ficheLabel")} closeLabel={p("ficheClose")}>{skeleton}</RouteModal> : skeleton;
}
