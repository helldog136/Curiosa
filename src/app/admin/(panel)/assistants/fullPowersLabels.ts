import type { Translator } from "@/core/i18n/dictionary";
import type { FullPowersLabels } from "@/components/admin/FullPowersWindow";

/** The texts of the full powers window, translated on the server. */
export function fullPowersLabels(t: Translator, name: string): FullPowersLabels {
  return {
    open: t("fullpowers.open"),
    title: t("fullpowers.dialog.title", { name }),
    warning: t("fullpowers.dialog.warning"),
    allowsTitle: t("fullpowers.dialog.allowsTitle"),
    allows: [1, 2, 3, 4].map((n) => t(`fullpowers.dialog.allows.${n}`)),
    outsideTitle: t("fullpowers.dialog.outsideTitle"),
    outside: [1, 2, 3, 4, 5].map((n) => t(`fullpowers.dialog.outside.${n}`)),
    typeName: t("fullpowers.dialog.typeName"),
    example: t("fullpowers.dialog.example", { name }),
    submit: t("fullpowers.dialog.submit"),
    cancel: t("fullpowers.dialog.cancel"),
    close: t("fullpowers.dialog.close"),
  };
}
