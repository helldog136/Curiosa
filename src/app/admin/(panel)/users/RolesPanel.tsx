import { ActionForm } from "@/components/admin/ActionForm";
import { FieldLabel, Select } from "@/components/admin/Field";
import { Badge } from "@/components/admin/Badge";
import { FormDialog } from "@/components/admin/FormDialog";
import { HelpBelow } from "@/components/admin/HelpTip";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { DangerZone, Panel } from "@/components/admin/Page";
import { RightsEditor, type RightGroup } from "@/components/admin/RightsEditor";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import { rightLabel } from "@/core/auth/describe";
import type { RightInfo } from "@/core/auth/rights";
import type { RoleSummary } from "@/core/auth/roles";
import { localized } from "@/core/modules/types";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

type Props = { roles: RoleSummary[]; catalogue: RightInfo[]; held: ReadonlySet<string>; isOwner: boolean; t: Translator; locale: string; defaultLocale: string };

/**
 * Onglet « Rôles » de la page Équipe (propriétaire et coordinateur technique) : UN tableau (rôle, origine, personnes) avec recherche en direct et filtre
 * « Prédéfinis / Personnalisés » ; « Modifier » et « Créer un rôle » ouvrent une boîte où les droits sont rangés par module, repliés, avec une recherche. Seuls les
 * droits délégables sont proposés : jamais un droit réservé au propriétaire. Le serveur revérifie tout (core/auth/roles.ts).
 */
export function RolesPanel({ roles, catalogue, held, isOwner, t, locale, defaultLocale }: Props) {
  // On ne propose que les droits que l'on possède soi-même (anti-élévation ; le serveur le revérifie).
  const delegable = catalogue.filter((r) => !r.reserved && held.has(r.id));
  // Dans le groupe d'un module, le nom du module n'est pas répété devant chaque droit.
  const label = (r: RightInfo) => (r.moduleId && r.local !== "open" && r.local !== "history" ? localized(r.label ?? r.local, locale, defaultLocale) || r.local : rightLabel(r, t, locale, defaultLocale));
  const item = (r: RightInfo) => ({ id: r.id, label: label(r), help: r.help ? localized(r.help, locale, defaultLocale) : undefined, sensitive: r.sensitive });
  const groups: RightGroup[] = [{ id: "core", title: t("roles.group.core"), rights: delegable.filter((r) => !r.moduleId).map(item) }];
  for (const r of delegable) {
    if (!r.moduleId) continue;
    let g = groups.find((x) => x.id === r.moduleId);
    if (!g) groups.push((g = { id: r.moduleId, title: localized(r.moduleName ?? r.moduleId, locale, defaultLocale) || r.moduleId, rights: [] }));
    g.rights.push(item(r));
  }
  const shownGroups = groups.filter((g) => g.rights.length > 0);
  const rightsLabels = {
    search: t("roles.rights.search"), none: t("search.none"), clear: t("search.clear"), checkAll: t("roles.rights.checkAll"), uncheckAll: t("roles.rights.uncheckAll"),
    sensitive: t("roles.sensitive"), count: t("roles.rights.count"), chosen: t("roles.rights.chosen"),
  };
  const custom = roles.filter((r) => !r.system);
  const name = (r: RoleSummary) => (r.system ? t(`role.${r.key}`) : r.name);
  const describe = (r: RoleSummary) => (r.system ? t(`roles.system.${r.key}`) : r.description || t("roles.noDescription"));
  // Plusieurs formulaires sur la page : chaque champ a son propre identifiant (le libellé désigne toujours le bon champ).
  const field = (id: string, fieldName: string, text: string, opts: { value?: string; required?: boolean; help?: string; example?: string } = {}) => (
    <div>
      <FieldLabel id={id} className={ui.label} help={opts.help} text={text}>{text}</FieldLabel>
      <input id={id} name={fieldName} defaultValue={opts.value} required={opts.required} maxLength={fieldName === "name" ? 60 : 300} aria-describedby={opts.example ? `${id}-ex` : undefined} className={ui.input} />
      <HelpBelow help={opts.help} className={ui.help} />
      {opts.example && <p id={`${id}-ex`} className={ui.help} data-field-example="">{opts.example}</p>}
    </div>
  );

  const rows: TableRow[] = roles.map((r) => {
    const editable = !r.system && r.rights.every((x) => held.has(x));
    return {
      key: r.id,
      testid: "role-row",
      search: [name(r), describe(r), r.system ? t("roles.origin.system") : t("roles.origin.custom")],
      filters: { origin: r.system ? "system" : "custom" },
      titles: { role: `${name(r)} — ${describe(r)}` },
      cells: {
        role: <>
          <span className="block truncate font-medium">{name(r)}</span>
          <span className="block truncate text-muted">{describe(r)}</span>
        </>,
        origin: <Badge tone={r.system ? "info" : "accent"}>{r.system ? t("roles.origin.system") : t("roles.origin.custom")}</Badge>,
        people: <span className="whitespace-nowrap">{t("roles.members", { n: r.users })}</span>,
      },
      actions: editable ? (
        <FormDialog trigger={t("roles.editShort")} triggerLabel={t("roles.edit") + " : " + r.name} title={t("roles.editTitle", { name: r.name })} closeLabel={t("roles.close")} wide testid="role-edit-open">
          <div className="space-y-6">
            <ActionForm action={updateRoleAction.bind(null, r.id)} submitLabel={t("roles.save")} pendingLabel={t("progress.saving")} className="space-y-4">
              {field(`role-${r.id}-name`, "name", t("roles.name"), { value: r.name, required: true, example: t("roles.nameExample") })}
              <MoreOptions title={t("roles.more")} summary={r.description || undefined} defaultOpen={!!r.description}>
                {field(`role-${r.id}-description`, "description", t("roles.description"), { value: r.description, example: t("roles.descriptionExample") })}
              </MoreOptions>
              <RightsEditor groups={shownGroups} selected={r.rights} labels={rightsLabels} />
            </ActionForm>
            <DangerZone title={t("users.moreActions")}>
              <ActionForm action={deleteRoleAction.bind(null, r.id)} submitLabel={t("roles.delete")} pendingLabel={t("progress.deleting")} confirm={r.users > 0 ? t("roles.deleteConfirm", { name: r.name, n: r.users }) : t("roles.deleteConfirmUnused", { name: r.name })} className="w-full space-y-3">
                {r.users > 0 ? (
                  <Select name="replacement" label={t("roles.replacement", { n: r.users })} help={t("roles.replacementHelp")}
                    options={roles.filter((x) => x.id !== r.id && x.key !== "owner" && (isOwner || x.key !== "coordinator") && (x.system || x.rights.every((y) => held.has(y)))).map((x) => ({ value: x.id, label: name(x) }))} />
                ) : <p className="text-sm text-muted">{t("roles.deleteUnused")}</p>}
              </ActionForm>
            </DangerZone>
          </div>
        </FormDialog>
      ) : null,
    };
  });

  return (
    <div className="space-y-8" data-testid="roles">
      <Panel title={t("roles.title")} help={t("roles.help")}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <LiveSearch scope="roles" placeholder={t("roles.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
              filters={[{ key: "origin", allLabel: t("roles.filter.all"), options: [
                { value: "system", label: t("roles.filter.system"), count: roles.length - custom.length },
                ...(custom.length > 0 ? [{ value: "custom", label: t("roles.filter.custom"), count: custom.length }] : []),
              ] }]} />
          </div>
          <div>
            <FormDialog trigger={t("roles.new")} title={t("roles.new")} intro={t("roles.newHelp")} closeLabel={t("roles.close")} wide testid="role-new-open">
              <ActionForm action={createRoleAction} submitLabel={t("roles.create")} pendingLabel={t("progress.creating")} reset className="space-y-4">
                {field("role-new-name", "name", t("roles.name"), { required: true, example: t("roles.nameExample") })}
                <MoreOptions title={t("roles.more")}>
                  {field("role-new-description", "description", t("roles.description"), { example: t("roles.descriptionExample") })}
                </MoreOptions>
                <RightsEditor groups={shownGroups} selected={[]} labels={rightsLabels} />
              </ActionForm>
            </FormDialog>
          </div>
        </div>
        <RowTable scope="roles" actionsLabel={t("users.actions")}
          columns={[
            { key: "role", label: t("roles.col.role"), width: "w-[48%]" },
            { key: "origin", label: t("roles.col.origin"), width: "w-[18%]" },
            { key: "people", label: t("roles.col.people"), width: "w-[14%]" },
          ]}
          rows={rows} />
        {custom.length === 0 && <p className="text-sm text-muted">{t("roles.none")}</p>}
      </Panel>
    </div>
  );
}
