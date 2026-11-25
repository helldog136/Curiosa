"use client";

import { useState } from "react";
import { ActionForm, type ActionState } from "./ActionForm";
import { PLAIN_INPUT } from "./managerHints";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { MoreOptions } from "./MoreOptions";
import { RightsEditor, type RightGroup, type RightsLabels } from "./RightsEditor";
import { ui } from "./ui";

export type PresetOption = { id: string; name: string; description: string; rights: string[] };
export type NewRoleLabels = { start: string; blank: string; startHelp: string; name: string; nameExample: string; description: string; descriptionExample: string; rights: string; more: string; submit: string; pending: string; rightsCount: string };

/**
 * "New role": the short path is a name and, if wanted, a preset to start from. A preset only fills the name, the description and the ticked rights; all of it stays editable and
 * what is sent is the same form as for a role built from scratch (the server checks every right again and keeps no link to the preset).
 */
export function NewRoleForm({ action, presets, groups, rightsLabels, labels }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; presets: PresetOption[]; groups: RightGroup[]; rightsLabels: RightsLabels; labels: NewRoleLabels }) {
  const [preset, setPreset] = useState("");
  const chosen = presets.find((p) => p.id === preset);
  return (
    <ActionForm action={action} submitLabel={labels.submit} pendingLabel={labels.pending} reset className="space-y-4">
      <div>
        <FieldLabel id="role-new-preset" className={ui.label} help={labels.startHelp} text={labels.start}>{labels.start}</FieldLabel>
        <select id="role-new-preset" data-testid="role-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={ui.input}>
          <option value="">{labels.blank}</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}
        </select>
        <HelpBelow help={labels.startHelp} className={ui.help} />
      </div>
      {/* Remounted when the preset changes, so the fields take the preset's values; the person edits them freely after. */}
      <div key={`f-${preset}`} className="space-y-4">
        <div>
          <FieldLabel id="role-new-name" className={ui.label} text={labels.name}>{labels.name}</FieldLabel>
          <input {...PLAIN_INPUT} id="role-new-name" name="name" required maxLength={60} defaultValue={chosen?.name ?? ""} aria-describedby="role-new-name-ex" className={ui.input} />
          <p id="role-new-name-ex" className={ui.help} data-field-example="">{labels.nameExample}</p>
        </div>
        <MoreOptions title={labels.more} defaultOpen={false}>
          <div>
            <FieldLabel id="role-new-description" className={ui.label} text={labels.description}>{labels.description}</FieldLabel>
            <input {...PLAIN_INPUT} id="role-new-description" name="description" maxLength={300} defaultValue={chosen?.description ?? ""} aria-describedby="role-new-description-ex" className={ui.input} />
            <p id="role-new-description-ex" className={ui.help} data-field-example="">{labels.descriptionExample}</p>
          </div>
        </MoreOptions>
        <MoreOptions title={labels.rights} summary={chosen ? labels.rightsCount.replace("{n}", String(chosen.rights.length)) : undefined} defaultOpen={!chosen}>
          <RightsEditor groups={groups} selected={chosen?.rights ?? []} labels={rightsLabels} />
        </MoreOptions>
      </div>
    </ActionForm>
  );
}
