import type { Translator } from "@/core/i18n/dictionary";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import type { Facet } from "@/core/modules/catalogueFacets";

/**
 * (core 0.33.0) Filter of the extension catalogue by what a module adds settings to: « Ajoute des réglages à : Alertes · Récompenses ». Links (the address is shareable, back works),
 * grouped by sidebar group, each chip with the number of modules. Nothing when no module of the catalogue says where it puts its settings.
 */
export function TopicFacets({ t, facets, current }: { t: Translator; facets: Facet[]; current: string | null }) {
  if (facets.length === 0) return null;
  const groups = [...new Set(facets.map((f) => f.group))];
  const chip = (href: string, label: string, active: boolean, testid: string) => (
    <li key={testid}>
      <a href={href} aria-current={active ? "true" : undefined} data-testid={testid}
        className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${active ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted hover:border-accent hover:text-accent"}`}>{label}</a>
    </li>
  );
  return (
    <nav aria-label={t("catalogue.addsTo")} className="space-y-2" data-testid="topic-facets">
      <p className="text-sm font-medium">{t("catalogue.addsTo")}</p>
      <ul className="flex flex-wrap gap-2">
        {chip(EXTENSIONS_ADD_HREF, t("catalogue.topicAll"), current === null, "topic-all")}
        {groups.flatMap((g) => facets.filter((f) => f.group === g).map((f) => chip(`${EXTENSIONS_ADD_HREF}?topic=${f.id}`, `${g ? `${g} › ` : ""}${f.title} (${f.count})`, current === f.id, `topic-${f.id}`)))}
      </ul>
    </nav>
  );
}
