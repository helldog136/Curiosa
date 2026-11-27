import type { Translator } from "@/core/i18n/dictionary";
import { savePlaceSection } from "@/app/admin/(panel)/instances/actions";
import { AccountDialog } from "./AccountDialog";
import { SectionFields, type LoadedSection, type SiteConfigLite } from "./PlaceSection";

/** The window that edits the address of one account: the same fields and the same save as the card of the page that produces it. */
export async function AccountEditor({ loaded, closeHref, t, locale, config, advanced }: { loaded: LoadedSection; closeHref: string; t: Translator; locale: string; config: SiteConfigLite; advanced: boolean }) {
  const name = loaded.section.siblings ? `${loaded.section.title} · ${loaded.section.instanceLabel}` : loaded.section.title;
  return (
    <AccountDialog title={t("connections.dialog.title", { name })} closeLabel={t("modal.close")} cancelLabel={t("editDialog.cancel")} closeHref={closeHref}
      guard={{ message: t("editDialog.message"), discard: t("editDialog.discard"), keep: t("editDialog.keep") }} action={savePlaceSection} submitLabel={t("connections.dialog.save")}>
      <SectionFields loaded={loaded} t={t} locale={locale} config={config} advanced={advanced} />
    </AccountDialog>
  );
}
