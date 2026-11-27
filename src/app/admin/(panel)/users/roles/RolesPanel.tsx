import { PLAIN_INPUT } from "@/components/admin/managerHints";
import { ActionForm } from "@/components/admin/ActionForm";
import { FieldLabel, Select } from "@/components/admin/Field";
import { Badge } from "@/components/admin/Badge";
import { EmptyState } from "@/components/admin/EmptyState";
import { FormDialog } from "@/components/admin/FormDialog";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { MenuDialog } from "@/components/admin/MenuDialog";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { Panel } from "@/components/admin/Page";
import { RightsMatrix } from "@/components/admin/RightsMatrix";
import { rightsMatrixLabels } from "@/components/admin/brickLabels";
import { RowMenu } from "@/components/admin/RowMenu";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import { NewRoleForm } from "@/components/admin/NewRoleForm";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import { USERS_HREF } from "@/core/adminLinks";
import { rightLabel } from "@/core/auth/describe";
import { presetRights, ROLE_PRESETS } from "@/core/auth/rolePresets";
import type { RightInfo } from "@/core/auth/rights";
import type { RoleSummary } from "@/core/auth/roles";
import { matrixGroups, matrixRoles, roleCopyable, roleEditable, roleGrants, type MatrixText } from "@/core/auth/rolesView";
import { localized } from "@/core/modules/types";
import { createRoleAction, deleteRoleAction, duplicateRoleAction, updateRoleAction } from "../actions";

type Props = { roles: RoleSummary[]; catalogue: RightInfo[]; held: ReadonlySet<string>; isOwner: boolean; t: Translator; locale: string; defaultLocale: string };

/**
 * The roles of the site (C5b): ONE table (role, origin, people) with live search and a « Built-in / Custom » filter, then the access matrix of every role. « Edit » opens a window where the
 * name and the rights (the boxes of the matrix) are set; « ⋯ » holds « Duplicate » and « Delete » (which says who loses the role and who receives which role instead).
 * Only rights the person holds themselves are offered, never a reserved one: the server checks everything again (core/auth/roles.ts). Built-in roles are read-only.
 */
export function RolesPanel({ roles, catalogue, held, isOwner, t, locale, defaultLocale }: Props) {
  const matrixLabels = rightsMatrixLabels(t);
  // Inside the group of a module, the module name is not repeated before each right.
  const text: MatrixText = {
    coreTitle: t("roles.group.core"),
    reservedTitle: t("roles.group.reserved"),
    moduleTitle: (r) => localized(r.moduleName ?? r.moduleId ?? "", locale, defaultLocale) || r.moduleId || "",
    label: (r) => (r.moduleId && r.local !== "open" && r.local !== "history" ? localized(r.label ?? r.local, locale, defaultLocale) || r.local : rightLabel(r, t, locale, defaultLocale)),
    help: (r) => (r.help ? localized(r.help, locale, defaultLocale) : undefined),
  };
  // What may be ticked: the rights the person holds, none reserved (the server refuses the rest, even from a crafted form).
  const editGroups = matrixGroups(catalogue, text, { reserved: false, keep: (r) => held.has(r.id) });
  const overviewGroups = matrixGroups(catalogue, text, { reserved: true });
  const custom = roles.filter((r) => !r.system);
  const name = (r: RoleSummary) => (r.system ? t(`role.${r.key}`) : r.name);
  const describe = (r: RoleSummary) => (r.system ? t(`roles.system.${r.key}`) : r.description || t("roles.noDescription"));
  // Several forms on the page: every field has its own id (a label always points to the right field).
  const field = (id: string, fieldName: string, label: string, opts: { value?: string; required?: boolean; example?: string; error?: boolean } = {}) => (
    <div>
      <FieldLabel id={id} className={ui.label} text={label}>{label}</FieldLabel>
      <input {...PLAIN_INPUT} id={id} name={fieldName} defaultValue={opts.value} required={opts.required} maxLength={fieldName === "name" ? 60 : 300} aria-describedby={opts.example ? `${id}-ex` : undefined} className={ui.input} />
      {opts.example && <p id={`${id}-ex`} className={ui.help} data-field-example="">{opts.example}</p>}
    </div>
  );

  const createDialog = (
    <FormDialog primary trigger={t("roles.new")} title={t("roles.new")} closeLabel={t("roles.close")} wide testid="role-new-open">
      <NewRoleForm action={createRoleAction} groups={editGroups} matrixLabels={matrixLabels}
        presets={ROLE_PRESETS.map((p) => ({ id: p.id, name: t(`rolePreset.${p.id}.name`), description: t(`rolePreset.${p.id}.description`), rights: presetRights(p, catalogue, held) }))}
        labels={{ start: t("roles.preset.start"), blank: t("roles.preset.blank"), startHelp: t("roles.preset.help"), name: t("roles.name"), nameExample: t("roles.nameExample"), description: t("roles.description"), descriptionExample: t("roles.descriptionExample"), rights: t("roles.preset.rights"), column: t("roles.new.column"), more: t("roles.more"), submit: t("roles.create"), pending: t("progress.creating"), rightsCount: t("roles.rights.chosen") }} />
    </FormDialog>
  );

  const rows: TableRow[] = roles.map((r) => {
    const editable = roleEditable(r, held);
    const copyable = roleCopyable(r, held, catalogue);
    const label = name(r);
    const replacements = roles.filter((x) => x.id !== r.id && x.key !== "owner" && (isOwner || x.key !== "coordinator") && (x.system || x.rights.every((y) => held.has(y))));
    return {
      key: r.id,
      testid: "role-row",
      search: [label, describe(r), r.system ? t("roles.origin.system") : t("roles.origin.custom")],
      filters: { origin: r.system ? "system" : "custom" },
      titles: { role: `${label} — ${describe(r)}` },
      cells: {
        role: <>
          <span className="block truncate font-medium">{label}</span>
          <span className="block truncate text-muted">{describe(r)}</span>
        </>,
        origin: <Badge tone={r.system ? "info" : "accent"}>{r.system ? t("roles.origin.system") : t("roles.origin.custom")}</Badge>,
        people: r.users > 0
          ? <a href={`${USERS_HREF}?q=${encodeURIComponent(label)}`} className="whitespace-nowrap text-accent underline underline-offset-2" data-testid="role-people">{t(r.users === 1 ? "roles.members.one" : "roles.members", { n: r.users })}</a>
          : <span className="whitespace-nowrap text-muted">{t("roles.members", { n: 0 })}</span>,
      },
      actions: (
        <>
          {editable && (
            <FormDialog trigger={t("roles.editShort")} triggerLabel={`${t("roles.edit")} : ${r.name}`} title={t("roles.editTitle", { name: r.name })} closeLabel={t("roles.close")} wide testid="role-edit-open">
              <ActionForm action={updateRoleAction.bind(null, r.id)} submitLabel={t("roles.save")} pendingLabel={t("progress.saving")} className="space-y-4">
                {field(`role-${r.id}-name`, "name", t("roles.name"), { value: r.name, required: true, example: t("roles.nameExample") })}
                <MoreOptions title={t("roles.more")} summary={r.description || undefined} defaultOpen={!!r.description}>
                  {field(`role-${r.id}-description`, "description", t("roles.description"), { value: r.description, example: t("roles.descriptionExample") })}
                </MoreOptions>
                <RightsMatrix roles={[{ id: r.id, name: r.name, people: r.users }]} groups={editGroups} grants={{ [r.id]: r.rights }} editRoleId={r.id} labels={matrixLabels}
                  defaultOpen={editGroups.filter((g) => g.rights.some((x) => r.rights.includes(x.id))).map((g) => g.id)} testid="rights-matrix-edit" />
              </ActionForm>
            </FormDialog>
          )}
          {(copyable || editable) && (
            <RowMenu label={t("users.menu.open", { name: label })}>
              {copyable && (
                <MenuDialog trigger={t("roles.duplicate")} title={t("roles.duplicateTitle", { name: label })} closeLabel={t("roles.close")} testid="role-duplicate-open">
                  <ActionForm action={duplicateRoleAction.bind(null, r.id)} submitLabel={t("roles.duplicateSubmit")} pendingLabel={t("progress.creating")}>
                    {field(`role-${r.id}-copy`, "name", t("roles.name"), { value: t("roles.copyName", { name: label }).slice(0, 60), required: true, example: t("roles.nameExample") })}
                  </ActionForm>
                </MenuDialog>
              )}
              {editable && (
                <MenuDialog danger trigger={t("roles.delete")} title={t("roles.deleteTitle", { name: r.name })} closeLabel={t("roles.close")} testid="role-delete-open">
                  <p className="text-sm leading-6" data-testid="role-delete-loss">{r.users > 0 ? t(r.users === 1 ? "roles.deleteLoses.one" : "roles.deleteLoses", { n: r.users, name: r.name }) : t("roles.deleteUnused")}</p>
                  <ActionForm action={deleteRoleAction.bind(null, r.id)} submitLabel={t("roles.delete")} danger pendingLabel={t("progress.deleting")} confirm={r.users > 0 ? t("roles.deleteConfirm", { name: r.name }) : t("roles.deleteConfirmUnused", { name: r.name })} className="w-full space-y-3">
                    {r.users > 0 && <Select name="replacement" label={t("roles.replacement", { n: r.users })} options={replacements.map((x) => ({ value: x.id, label: name(x) }))} />}
                  </ActionForm>
                </MenuDialog>
              )}
            </RowMenu>
          )}
        </>
      ),
    };
  });

  return (
    <div className="space-y-8" data-testid="roles">
      <Panel title={t("roles.title")} testid="roles-list">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <LiveSearch scope="roles" placeholder={t("roles.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
              filters={[{ key: "origin", allLabel: t("roles.filter.all"), options: [
                { value: "system", label: t("roles.filter.system"), count: roles.length - custom.length },
                ...(custom.length > 0 ? [{ value: "custom", label: t("roles.filter.custom"), count: custom.length }] : []),
              ] }]} />
          </div>
          {custom.length > 0 && <div>{createDialog}</div>}
        </div>
        <RowTable scope="roles" actionsLabel={t("users.actions")}
          columns={[
            { key: "role", label: t("roles.col.role"), width: "w-[46%]" },
            { key: "origin", label: t("roles.col.origin"), width: "w-[16%]" },
            { key: "people", label: t("roles.col.people"), width: "w-[16%]" },
          ]}
          rows={rows} />
        {custom.length === 0 && <EmptyState title={t("roles.none")} action={createDialog} testid="roles-empty" />}
      </Panel>
      <Panel title={t("roles.matrix.title")} testid="roles-matrix">
        <RightsMatrix roles={matrixRoles(roles, name)} groups={overviewGroups} grants={roleGrants(roles, catalogue)} labels={matrixLabels} testid="rights-matrix-overview" />
      </Panel>
    </div>
  );
}
