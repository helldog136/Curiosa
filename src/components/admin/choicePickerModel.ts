// Sélecteur « choix parmi » (ChoicePicker) : la logique sans React (clavier, annonces, bouton « Créer »), testée telle quelle dans node.

export type PickerItem = { id: string; label: string; hint?: string };

/** Textes du sélecteur (traduits côté serveur, passés au composant client). `{label}`, `{count}` sont remplacés ici. */
export type PickerStrings = {
  search: string; placeholder: string; current: string; noneChosen: string; clear: string; more: string; loading: string;
  resultsNone: string; resultsOne: string; resultsMany: string; resultsMore: string;
  create: string; created: string; selected: string; cleared: string; unreachable: string;
};

export const fill = (text: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);

const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Propose « Créer « X » » ? Seulement si le réglage le permet, que le texte fait 1 à 100 caractères et qu'aucun résultat ne porte déjà ce nom. */
export function showCreate(q: string, items: readonly PickerItem[], canCreate: boolean): boolean {
  const want = norm(q);
  return canCreate && want.length > 0 && q.trim().length <= 100 && !items.some((i) => norm(i.label) === want);
}

/** Nombre d'options navigables au clavier (résultats + « Créer » éventuel). */
export const optionCount = (items: readonly PickerItem[], create: boolean): number => items.length + (create ? 1 : 0);

/**
 * Touche pressée dans le champ de recherche (motif « combobox » de l'ARIA) :
 *   ↓ / ↑ : option suivante / précédente (en boucle ; ouvre la liste si elle est fermée) ; Début / Fin : première / dernière ;
 *   Entrée : choisit l'option active (sans envoyer le formulaire) ; Échap : ferme la liste. Autre touche : rien (null).
 */
export type KeyIntent = { type: "move"; active: number } | { type: "select"; index: number } | { type: "close" } | { type: "open" } | null;
export function keyIntent(key: string, state: { open: boolean; active: number; count: number }): KeyIntent {
  const { open, active, count } = state;
  switch (key) {
    case "ArrowDown":
      if (!open) return { type: "open" };
      return count ? { type: "move", active: active < 0 || active >= count - 1 ? 0 : active + 1 } : null;
    case "ArrowUp":
      if (!open) return { type: "open" };
      return count ? { type: "move", active: active <= 0 ? count - 1 : active - 1 } : null;
    case "Home": return open && count ? { type: "move", active: 0 } : null;
    case "End": return open && count ? { type: "move", active: count - 1 } : null;
    case "Enter": return open && active >= 0 && active < count ? { type: "select", index: active } : null;
    case "Escape": return open ? { type: "close" } : null;
    default: return null;
  }
}

/** Ce que la zone `aria-live` annonce après une recherche. */
export function announce(s: PickerStrings, r: { loading: boolean; count: number; more: boolean; error?: boolean }): string {
  if (r.error) return s.unreachable;
  if (r.loading) return s.loading;
  if (r.count === 0) return s.resultsNone;
  if (r.more) return fill(s.resultsMore, { count: r.count });
  return r.count === 1 ? s.resultsOne : fill(s.resultsMany, { count: r.count });
}

/** Ajoute une page aux résultats (« Afficher plus »), sans doublon. */
export function mergePage(prev: readonly PickerItem[], page: readonly PickerItem[], append: boolean): PickerItem[] {
  if (!append) return [...page];
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...page.filter((i) => !seen.has(i.id))];
}

/** Identifiant DOM d'une option (pour `aria-activedescendant`). */
export const optionDomId = (base: string, index: number): string => `${base}-opt-${index}`;
