import { activePreviewTokens, skinPreviewTokens } from "@/core/skins/appearanceView";
import type { Translator } from "@/core/i18n/dictionary";
import { EntryPreview } from "./EntryPreview";
import { APPEARANCE_HREF } from "@/core/adminLinks";

/** Aperçu de l'éditeur d'entrée avec le skin du site (voir EntryPreview). Le nom du skin vient de la langue de l'administration. */
export async function EntryPreviewBox({ t, locale, pageSkinIds = [] }: { t: Translator; locale: string; pageSkinIds?: string[] }) {
  const p = await activePreviewTokens();
  const name = locale === "fr" ? p.name.fr : p.name.en;
  const pageSkins: Record<string, { name: string; modes: typeof p.modes }> = {};
  for (const id of pageSkinIds) { const k = await skinPreviewTokens(id); if (k) pageSkins[id] = { name: locale === "fr" ? k.name.fr : k.name.en, modes: k.modes }; }
  return (
    <EntryPreview modes={p.modes} pageSkins={pageSkinIds.length ? pageSkins : undefined} href={APPEARANCE_HREF}
      labels={{ title: t("appearance.entryPreview.title", { name }), titleFor: t("appearance.entryPreview.title", { name: "{name}" }), help: t("appearance.entryPreview.help"), empty: t("appearance.entryPreview.empty"), light: t("appearance.mode.light"), dark: t("appearance.mode.dark"), change: t("appearance.entryPreview.change"), modes: t("appearance.modes") }} />
  );
}
