import type { Translator } from "@/core/i18n/dictionary";
import { type ExtensionFamily } from "@/core/modules/extensionFamilies";
import { EXTENSIONS_HREF, extensionsFamilyHref } from "@/core/modules/extensionsLinks";

/** Choix de la famille affichée dans « Installées » (liens : l'adresse se partage, le retour arrière fonctionne). Rien à choisir s'il n'y a qu'une famille. */
export function FamilyFilter({ t, present, current }: { t: Translator; present: readonly ExtensionFamily[]; current: ExtensionFamily | null }) {
  if (present.length < 2) return null;
  const chip = (href: string, label: string, active: boolean, testid: string) => (
    <li key={testid}>
      <a href={href} aria-current={active ? "true" : undefined} data-testid={testid}
        className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors ${active ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:border-accent hover:text-accent"}`}>{label}</a>
    </li>
  );
  return (
    <nav aria-label={t("extensions.familyFilter")}>
      <ul className="flex flex-wrap gap-2">
        {chip(EXTENSIONS_HREF, t("extensions.familyAll"), current === null, "family-all")}
        {present.map((f) => chip(extensionsFamilyHref(f), t(`family.${f}`), current === f, `family-${f}`))}
      </ul>
    </nav>
  );
}
