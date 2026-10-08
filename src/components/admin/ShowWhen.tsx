"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Affiche son contenu seulement quand le choix `field` du même formulaire (une liste `<select name>` ou un groupe de boutons radio) vaut `equals`.
 * Utile pour les réglages d'une option (« Personnalisé » → ses réglages fins). Les champs masqués restent dans le formulaire et sont envoyés avec :
 * revenir à un autre choix puis enregistrer ne fait perdre aucune valeur déjà saisie. `initial` = valeur affichée au chargement (évite un clignotement).
 */
export function ShowWhen({ field, equals, initial, children }: { field: string; equals: string; initial: string; children: React.ReactNode }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const els = form.elements.namedItem(field);
      if (!els) return;
      // un seul élément (select) ou plusieurs (radios)
      if (els instanceof RadioNodeList) setValue(els.value);
      else setValue((els as HTMLSelectElement | HTMLInputElement).value);
    };
    read();
    form.addEventListener("change", read);
    form.addEventListener("input", read);
    return () => { form.removeEventListener("change", read); form.removeEventListener("input", read); };
  }, [field]);
  return <div ref={ref} hidden={value !== equals}>{children}</div>;
}
