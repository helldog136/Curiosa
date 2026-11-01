import type { Translator } from "@/core/i18n/dictionary";

/** Textes de la barre flottante d'enregistrement (voir ActionForm) : les pages les passent au formulaire. */
export type FloatingLabels = { dirty: string; discard: string; discardConfirm: string; saved: string; leave: string };

export const floatingLabels = (t: Translator): FloatingLabels => ({
  dirty: t("floating.dirty"), discard: t("floating.discard"), discardConfirm: t("floating.discardConfirm"), saved: t("floating.saved"), leave: t("floating.leave"),
});
