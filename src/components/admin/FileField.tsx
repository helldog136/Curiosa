import type { AdminField } from "@/core/blocks";
import { ui } from "./ui";

/** Champ fichier d'un formulaire d'admin de module (`kind: "file"`). L'envoi lui-même est fait par `FileBlockForm` (route dédiée du cœur, pas une action serveur). */
export function FileField({ f }: { f: AdminField }) {
  return (
    <div>
      <label className={ui.label} htmlFor={`f_${f.name}`}>{f.label}</label>
      <input id={`f_${f.name}`} name={f.name} type="file" accept={f.accept} required={f.required} className={ui.input} />
      {f.help && <p className={ui.help}>{f.help}</p>}
    </div>
  );
}
