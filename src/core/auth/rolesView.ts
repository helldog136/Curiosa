/**
 * ROLES VIEW, pure part (C5b): turns the rights catalogue and the roles into what the access matrix draws. No database, no React. The rules of who may grant what stay in
 * `roles.ts`; this file only decides what is OFFERED, and every offer is checked again by the server.
 *  - a role that can be edited is offered only the rights the person editing holds themselves, never a reserved one;
 *  - the overview lists every right (reserved ones too, as « cannot be delegated ») so that the matrix tells the whole story;
 *  - the grants of a built-in role are computed (`systemRights`), those of a custom role are read from its stored list, reserved or unknown entries dropped.
 */
import type { MatrixGroup, MatrixRight, MatrixRole } from "@/core/adminkit/rightsMatrix";
import { delegableRights, systemRights, isSystemKey, type RightInfo } from "./rights";
import type { RoleSummary } from "./roles";

export type MatrixText = {
  /** Title of the group of the site's own rights. */
  coreTitle: string;
  /** Title of the group of the rights that stay with the owner and technical coordination. */
  reservedTitle: string;
  /** Title of the group of one module (its name). */
  moduleTitle: (right: RightInfo) => string;
  /** Label of one right, inside its group. */
  label: (right: RightInfo) => string;
  help?: (right: RightInfo) => string | undefined;
};

/** The rows of the matrix: core rights, then the reserved ones (when `reserved`), then one group per module. `keep` narrows the offer (the rights the editor holds). */
export function matrixGroups(catalogue: readonly RightInfo[], text: MatrixText, opts: { reserved: boolean; keep?: (r: RightInfo) => boolean }): MatrixGroup[] {
  const keep = (r: RightInfo) => (r.reserved ? opts.reserved : true) && (opts.keep ? opts.keep(r) : true);
  const item = (r: RightInfo): MatrixRight => ({ id: r.id, label: text.label(r), help: text.help?.(r), sensitive: r.sensitive || undefined, reserved: r.reserved || undefined });
  const groups: MatrixGroup[] = [];
  const core = catalogue.filter((r) => !r.moduleId && !r.reserved && keep(r));
  if (core.length) groups.push({ id: "core", title: text.coreTitle, rights: core.map(item) });
  const reserved = catalogue.filter((r) => !r.moduleId && r.reserved && keep(r));
  if (reserved.length) groups.push({ id: "reserved", title: text.reservedTitle, rights: reserved.map(item) });
  for (const r of catalogue) {
    if (!r.moduleId || !keep(r)) continue;
    let g = groups.find((x) => x.id === `m-${r.moduleId}`);
    if (!g) groups.push((g = { id: `m-${r.moduleId}`, title: text.moduleTitle(r), rights: [] }));
    g.rights.push(item(r));
  }
  return groups;
}

/** The roles as the matrix columns (a number of people, never a name). */
export const matrixRoles = (roles: readonly RoleSummary[], name: (r: RoleSummary) => string): MatrixRole[] => roles.map((r) => ({ id: r.id, name: name(r), system: r.system || undefined, people: r.users }));

/** What each role holds: built-in roles by their level, custom roles by their stored list (delegable and known rights only). */
export function roleGrants(roles: readonly RoleSummary[], catalogue: RightInfo[]): Record<string, string[]> {
  const ok = delegableRights(catalogue);
  const out: Record<string, string[]> = {};
  for (const r of roles) out[r.id] = r.system || isSystemKey(r.key) ? (isSystemKey(r.key) ? [...systemRights(r.key, catalogue)] : []) : r.rights.filter((x) => ok.has(x));
  return out;
}

/** May this person edit this role from the page? Custom only, and only when they hold every right of it (the server decides the same way). */
export const roleEditable = (role: Pick<RoleSummary, "system" | "key" | "rights">, held: ReadonlySet<string>): boolean => !role.system && !isSystemKey(role.key) && role.rights.every((x) => held.has(x));

/** May this person copy this role? Never the owner role; they must hold every delegable right of it (the server decides the same way). */
export function roleCopyable(role: Pick<RoleSummary, "system" | "key" | "rights">, held: ReadonlySet<string>, catalogue: RightInfo[]): boolean {
  if (role.key === "owner") return false;
  const rights = isSystemKey(role.key) ? [...systemRights(role.key, catalogue)].filter((r) => delegableRights(catalogue).has(r)) : role.rights;
  return rights.every((x) => held.has(x));
}
