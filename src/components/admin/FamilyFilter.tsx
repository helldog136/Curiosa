import type { Translator } from "@/core/i18n/dictionary";
import { type ExtensionFamily } from "@/core/modules/extensionFamilies";
import { EXTENSIONS_HREF, extensionsFamilyHref } from "@/core/modules/extensionsLinks";

/** Choix de la famille affichée dans « Installées » (liens : l'adresse se partage, le retour arrière fonctionne). Rien à choisir s'il n'y a qu'une famille. */
export function FamilyFilter({ t, present, current, counts }: { t: Translator; present: readonly ExtensionFamily[]; current: ExtensionFamily | null; /** Modules per family, written inside each pill. */ counts?: Partial<Record<ExtensionFamily | "all", number>> }) {
  if (present.length < 2) return null;
  const chip = (href: string, label: string, active: boolean, testid: string, count?: number) => (
    <li key={testid}>
      <a href={href} aria-current={active ? "true" : undefined} data-testid={testid}
        className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${active ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:border-accent hover:text-accent"}`}>{label}{count !== undefined && <span className={`ml-1.5 ${active ? "opacity-80" : "text-muted"}`}>{count}</span>}</a>
    </li>
  );
  return (
    <nav aria-label={t("extensions.familyFilter")}>
      <ul className="flex flex-wrap gap-2">
        {chip(EXTENSIONS_HREF, t("extensions.familyAll"), current === null, "family-all", counts?.all)}
        {present.map((f) => chip(extensionsFamilyHref(f), t(`family.${f}`), current === f, `family-${f}`, counts?.[f]))}
      </ul>
    </nav>
  );
}
