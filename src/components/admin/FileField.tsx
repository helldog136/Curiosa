import type { AdminField } from "@/core/blocks";
import { ui } from "./ui";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { FileButton } from "./FileButton";

/** Champ fichier d'un formulaire d'admin de module (`kind: "file"`). L'envoi lui-même est fait par `FileBlockForm` (route dédiée du cœur, pas une action serveur). */
export function FileField({ f }: { f: AdminField }) {
  return (
    <div>
      <FieldLabel id={`f_${f.name}`} className={ui.label} help={f.help} text={f.label}>{f.label}</FieldLabel>
      <FileButton id={`f_${f.name}`} name={f.name} accept={typeof f.accept === "string" ? f.accept : undefined} required={f.required} />
      <HelpBelow help={f.help} className={ui.help} />
    </div>
  );
}
