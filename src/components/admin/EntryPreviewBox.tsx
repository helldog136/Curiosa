import { activePreviewTokens } from "@/core/skins/appearanceView";
import type { Translator } from "@/core/i18n/dictionary";
import { EntryPreview } from "./EntryPreview";

/** Aperçu de l'éditeur d'entrée avec le skin du site (voir EntryPreview). Le nom du skin vient de la langue de l'administration. */
export async function EntryPreviewBox({ t, locale }: { t: Translator; locale: string }) {
  const p = await activePreviewTokens();
  const name = locale === "fr" ? p.name.fr : p.name.en;
  return (
    <EntryPreview modes={p.modes} href="/admin/appearance"
      labels={{ title: t("appearance.entryPreview.title", { name }), help: t("appearance.entryPreview.help"), empty: t("appearance.entryPreview.empty"), light: t("appearance.mode.light"), dark: t("appearance.mode.dark"), change: t("appearance.entryPreview.change"), modes: t("appearance.modes") }} />
  );
}
