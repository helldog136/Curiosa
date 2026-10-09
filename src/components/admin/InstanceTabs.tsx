import type { Translator } from "@/core/i18n/dictionary";

/** En-tête commun des sous-pages d'une instance : nom + onglets Contenu / Réglages. */
export function InstanceTabs({ t, id, keyName, name, icon, active, content, canConfigure }: {
  t: Translator; id: string; keyName: string; name: string; icon: string; active: "entries" | "settings"; content: boolean; canConfigure: boolean;
}) {
  const tab = (href: string, label: string, on: boolean) => (
    <a href={href} aria-current={on ? "page" : undefined}
      className={`border-b-2 px-3 py-2 text-sm ${on ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg"}`}>{label}</a>
  );
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{icon} {name}</h1>
      {content && canConfigure && (
        <nav className="flex gap-2 border-b border-line" aria-label={name}>
          {tab(`/admin/entries?c=${keyName}`, t("tabs.content"), active === "entries")}
          {tab(`/admin/instances/${id}`, t("tabs.settings"), active === "settings")}
        </nav>
      )}
    </div>
  );
}
