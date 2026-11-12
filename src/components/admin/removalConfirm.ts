/** The gesture that arms the red button of the removal window (pure, tested without a browser). */
export type RemovalMode = "keep" | "erase";

/** Compare names the way a person types them: no case, no accents, no extra spaces. */
const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * "keep" (data set aside, reversible): the checkbox must be ticked. "erase" (final): the typed text must be the name. An empty name can never be confirmed by typing
 * nothing: the typed text must also be non-empty.
 */
export function removalConfirmed(mode: RemovalMode, o: { checked: boolean; typed: string; name: string }): boolean {
  if (mode === "keep") return o.checked;
  const typed = plain(o.typed);
  return typed !== "" && typed === plain(o.name);
}
