import { ActionForm } from "@/components/admin/ActionForm";
import { Select } from "@/components/admin/Field";
import { Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import { rightLabel } from "@/core/auth/describe";
import type { RightInfo } from "@/core/auth/rights";
import type { RoleSummary } from "@/core/auth/roles";
import { localized } from "@/core/modules/types";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

type Props = { roles: RoleSummary[]; catalogue: RightInfo[]; held: ReadonlySet<string>; isOwner: boolean; t: Translator; locale: string; defaultLocale: string };

/**
 * Onglet « Rôles » de la page Équipe (propriétaire et coordinateur technique) : les rôles prédéfinis (non modifiables, expliqués en une phrase), les rôles personnalisés
 * (nom, phrase, cases à cocher par module en mots simples), et « Nouveau rôle ». Seuls les droits délégables sont proposés : jamais un droit réservé
 * au propriétaire. Le serveur revérifie tout (core/auth/roles.ts).
 */
export function RolesPanel({ roles, catalogue, held, isOwner, t, locale, defaultLocale }: Props) {
  // On ne propose que les droits que l'on possède soi-même (anti-élévation ; le serveur le revérifie).
  const delegable = catalogue.filter((r) => !r.reserved && held.has(r.id));
  const groups: { id: string; title: string; rights: RightInfo[] }[] = [{ id: "core", title: t("roles.group.core"), rights: delegable.filter((r) => !r.moduleId) }];
  for (const r of delegable) {
    if (!r.moduleId) continue;
    let g = groups.find((x) => x.id === r.moduleId);
    if (!g) groups.push((g = { id: r.moduleId, title: localized(r.moduleName ?? r.moduleId, locale, defaultLocale) || r.moduleId, rights: [] }));
    g.rights.push(r);
  }
  const custom = roles.filter((r) => !r.system);
  // Plusieurs formulaires sur la page : chaque champ a son propre identifiant (le libellé désigne toujours le bon champ).
  const field = (id: string, name: string, label: string, opts: { value?: string; required?: boolean; help?: string; placeholder?: string } = {}) => (
    <div>
      <label className={ui.label} htmlFor={id}>{label}</label>
      <input id={id} name={name} defaultValue={opts.value} required={opts.required} placeholder={opts.placeholder} maxLength={name === "name" ? 60 : 300} className={ui.input} />
      {opts.help && <p className={ui.help}>{opts.help}</p>}
    </div>
  );
  const name = (r: RoleSummary) => (r.system ? t(`role.${r.key}`) : r.name);

  const rightsFields = (selected: string[]) => (
    <div className="space-y-4">
      {groups.map((g) => (
        <fieldset key={g.id} className="space-y-1.5">
          <legend className="text-sm font-semibold">{g.title}</legend>
          {g.rights.map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="right" value={r.id} defaultChecked={selected.includes(r.id)} className="mt-0.5 h-4 w-4 accent-[var(--v-accent)]" />
              <span>
                {rightLabel(r, t, locale, defaultLocale)}
                {r.sensitive && <span className={`${ui.chipWarn} ml-2`}>{t("roles.sensitive")}</span>}
                {r.help && <span className="block text-muted">{localized(r.help, locale, defaultLocale)}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );

  return (
    <div className="space-y-8" data-testid="roles">
      <Panel title={t("roles.title")} help={t("roles.help")}>
        <ul className="divide-y divide-line">
          {roles.map((r) => (
            <li key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid="role-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{name(r)}{r.system && <span className={`${ui.chip} ml-2`}>{t("roles.builtIn")}</span>}</p>
                <p className="text-sm text-muted">{t("roles.members", { n: r.users })}</p>
              </div>
              <p className="text-sm text-muted">{r.system ? t(`roles.system.${r.key}`) : r.description || t("roles.noDescription")}</p>
              {!r.system && r.rights.every((x) => held.has(x)) && (
                <details className={ui.card}>
                  <summary className="cursor-pointer font-medium">{t("roles.edit")}</summary>
                  <div className="mt-4 space-y-6">
                    <ActionForm action={updateRoleAction.bind(null, r.id)} submitLabel={t("action.save")} className="space-y-4">
                      {field(`role-${r.id}-name`, "name", t("roles.name"), { value: r.name, required: true })}
                      {field(`role-${r.id}-description`, "description", t("roles.description"), { value: r.description, help: t("roles.descriptionHelp") })}
                      {rightsFields(r.rights)}
                    </ActionForm>
                    <ActionForm action={deleteRoleAction.bind(null, r.id)} submitLabel={t("roles.delete")} pendingLabel={t("progress.deleting")} confirm={t("roles.deleteConfirm", { name: r.name })} className="space-y-3 border-t border-line pt-4">
                      {r.users > 0 ? (
                        <Select name="replacement" label={t("roles.replacement", { n: r.users })} help={t("roles.replacementHelp")}
                          options={roles.filter((x) => x.id !== r.id && x.key !== "owner" && (isOwner || x.key !== "coordinator") && (x.system || x.rights.every((y) => held.has(y)))).map((x) => ({ value: x.id, label: name(x) }))} />
                      ) : <p className="text-sm text-muted">{t("roles.deleteUnused")}</p>}
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
        {custom.length === 0 && <p className="mt-4 text-sm text-muted">{t("roles.none")}</p>}
      </Panel>

      <Panel title={t("roles.new")} help={t("roles.newHelp")}>
        <ActionForm action={createRoleAction} submitLabel={t("roles.create")} pendingLabel={t("progress.creating")} reset className="space-y-4">
          {field("role-new-name", "name", t("roles.name"), { required: true, placeholder: t("roles.namePlaceholder") })}
          {field("role-new-description", "description", t("roles.description"), { help: t("roles.descriptionHelp") })}
          {rightsFields([])}
        </ActionForm>
      </Panel>
    </div>
  );
}
