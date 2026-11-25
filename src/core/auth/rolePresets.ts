/**
 * ROLE PRESETS (core 0.49.0): ready-made STARTING POINTS for a custom role, nothing more.
 *
 * A preset is a named list of existing delegable rights, written here as data. Picking one in the "New role" form only FILLS the form (name, description, rights); what is saved is an
 * ordinary custom role created by `createRole` with the usual checks (anti-elevation, no reserved right, no unknown right). There is no link between a role and the preset it started from:
 * editing or removing a preset in a later release never changes a role that exists. A preset adds no privilege level and is never listed anywhere except in the "New role" form;
 * the invitation picker lists roles, so a preset shows up there only once somebody has created the role.
 *
 * A preset names rights of the core (`core:…`) and, for the modules installed on the site, the LOCAL ids of the rights every module declares ("open" = open the module's page,
 * "history" = see its history). Rights reserved to a level (`CORE_RESERVED`) are refused here as a second lock, whatever the data says.
 * Names and one-line descriptions are in the language files (`rolePreset.<id>.name`, `rolePreset.<id>.description`), EN and FR.
 */
import { isReserved, type RightInfo } from "./rights";

export type RolePreset = { id: string; core: readonly string[]; moduleLocals: readonly string[] };

export const ROLE_PRESETS: readonly RolePreset[] = [
  { id: "contributor", core: ["core:entries.edit"], moduleLocals: [] },
  { id: "moderator", core: ["core:entries.edit"], moduleLocals: ["open"] },
  { id: "editor-in-chief", core: ["core:entries.edit", "core:entries.publish", "core:ai.personal"], moduleLocals: ["open", "history"] },
  { id: "reviewer", core: [], moduleLocals: ["open", "history"] },
];

/**
 * The rights a preset proposes on THIS site, for THIS person: only rights that exist in the catalogue, are not reserved, and are held by `held` (a person never proposes a right
 * they do not have). The server checks again when the form is sent: this list is a convenience, not a decision.
 */
export function presetRights(preset: RolePreset, catalogue: readonly RightInfo[], held: ReadonlySet<string>): string[] {
  const wanted = new Set<string>(preset.core.filter((r) => !isReserved(r)));
  for (const r of catalogue) if (r.moduleId && preset.moduleLocals.includes(r.local) && !r.reserved) wanted.add(r.id);
  return catalogue.filter((r) => wanted.has(r.id) && !r.reserved && !isReserved(r.id) && held.has(r.id)).map((r) => r.id).sort();
}
