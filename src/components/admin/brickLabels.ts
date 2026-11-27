import type { Translator } from "@/core/i18n/dictionary";
import type { ChecklistLabels } from "./ChecklistCard";
import type { RightsMatrixLabels } from "./RightsMatrix";

/** The texts of the C3c bricks, translated by the page (the bricks hold no text of their own). */
export function rightsMatrixLabels(t: Translator): RightsMatrixLabels {
  return {
    region: t("bricks.rights.region"), corner: t("bricks.rights.corner"), yes: t("bricks.rights.yes"), no: t("bricks.rights.no"), locked: t("bricks.rights.locked"),
    sensitive: t("bricks.rights.sensitive"), system: t("bricks.rights.system"), people: t("bricks.rights.people"), peopleOne: t("bricks.rights.peopleOne"),
    count: t("bricks.rights.count"), chosen: t("bricks.rights.chosen"), cell: t("bricks.rights.cell"),
  };
}

export function checklistLabels(t: Translator): ChecklistLabels {
  return { done: t("bricks.checklist.done"), todo: t("bricks.checklist.todo"), progress: t("bricks.checklist.progress") };
}
