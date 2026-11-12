import type { Translator } from "@/core/i18n/dictionary";
import type { RemovalImpact } from "@/core/modules/removalImpact";
import type { RemoveWindowLabels } from "./RemoveWindow";

/** The texts of the removal window, written once on the server. `scope`: removing the whole module, or one copy of it (the module stays installed). */
export function removeWindowLabels(t: Translator, o: { scope: "module" | "instance"; name: string; impact: RemovalImpact }): RemoveWindowLabels {
  const { name } = o;
  return {
    button: t(o.scope === "module" ? "danger.button.module" : "danger.button.instance", { name }),
    lostHeading: t("danger.lostHeading"),
    lost: [t(o.scope === "module" ? "danger.lost.module" : "danger.lost.instance", { name })],
    impact: [{ label: t("danger.impact.items"), value: o.impact.items }, { label: t("danger.impact.files"), value: o.impact.files }],
    noData: t("danger.impact.none"),
    choice: t("danger.choice"),
    keep: t("danger.keep"),
    keepHelp: t("danger.keepHelp"),
    erase: t("danger.erase"),
    eraseWarning: t("danger.eraseWarning"),
    checkbox: t("danger.checkbox", { name }),
    typeName: t("danger.typeName"),
    example: t("field.example", { example: name }),
    submitKeep: t("danger.submitKeep", { name }),
    submitErase: t("danger.submitErase", { name }),
    cancel: t("editDialog.cancel"),
    close: t("modal.close"),
  };
}
