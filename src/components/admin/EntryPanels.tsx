import { Blocks } from "@/components/site/Blocks";
import type { Translator } from "@/core/i18n/dictionary";
import { panelAnchor } from "@/core/modules/entryPanels";
import { loadEntryPanels } from "@/core/modules/entryPanelsLoad";
import type { EntryPanelView } from "@/core/modules/types";
import { ui } from "./ui";

/**
 * Les sections que d'autres modules ajoutent à l'éditeur d'une entrée (voir core/modules/entryPanels.ts). Chacune est un bloc repliable, ouvert d'office, avec son propre
 * bouton : elle s'enregistre sans recharger la page (la position de défilement et les sections ouvertes ou fermées ne bougent pas). À placer HORS du formulaire de l'entrée.
 */
export async function EntryPanels({ entryId, locale, defaultLocale, view, t }: { entryId: string; locale: string; defaultLocale: string; view: EntryPanelView; t: Translator }) {
  const panels = await loadEntryPanels(entryId, locale, defaultLocale, view);
  if (!panels.length) return null;
  return (
    <div className="space-y-6">
      {panels.map((p) => {
        const anchor = panelAnchor(p.instanceKey, p.panelId);
        return (
          <section key={anchor} id={anchor} aria-labelledby={`${anchor}-title`} className="scroll-mt-20">
            <details open className={`${ui.card} group`}>
              <summary className="cursor-pointer list-none text-[15px] font-medium">
                <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90" aria-hidden>›</span>
                <h2 id={`${anchor}-title`} className="inline text-[15px] font-semibold">{p.title}</h2>
              </summary>
              <div className="mt-4 space-y-4">
                {p.help && <p className="text-[13px] text-muted">{p.help}</p>}
                {p.failed
                  ? <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{t("entries.panel.failed")}</p>
                  : <Blocks blocks={p.blocks} locale={locale} adminEntry={{ instanceId: p.instanceId, panelId: p.panelId, entryId }} />}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
