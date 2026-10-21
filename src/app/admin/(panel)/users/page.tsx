import { adminCtx } from "@/core/admin";
import { isOwner as ownerCheck } from "@/core/auth/access";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Select, TextField } from "@/components/admin/Field";
import { Callout, DangerZone, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { isEmailLocked, formatUntil } from "@/core/auth/lockout";
import { getSetting } from "@/core/settings";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { TemporaryPasswordButton } from "@/components/admin/TemporaryPasswordButton";
import { Tabs } from "@/components/admin/Tabs";
import { currentCatalogue, levelOf } from "@/core/auth/access";
import { describeAccess, rightsOf } from "@/core/auth/describe";
import { parseStoredRights } from "@/core/auth/rights";
import { listRoles } from "@/core/auth/roles";
import { createUser, deleteUser, resetUserTwoFactor, revokeUserSessions, setRequireTwoFactor, setTemporaryPassword, setUserRolesAction, unlockUser } from "./actions";
import { RolesPanel } from "./RolesPanel";
import { PendingButton } from "@/components/admin/PendingButton";

/**
 * L'équipe : qui est là et ce qu'elle peut faire, puis ajouter quelqu'un, puis la sécurité de toute l'équipe. Le propriétaire a aussi l'onglet « Rôles »
 * (rôles personnalisés) et choisit les rôles de chacun (puces cumulables), avec l'aperçu « Ce que cette personne peut faire ».
 */
export default async function UsersPage() {
  const { t, user, locale, config } = await adminCtx("admin");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { passkeys: true } }, roles: { include: { role: { select: { id: true, key: true, name: true, system: true, rights: true } } } } } });
  const isOwner = ownerCheck(user);
  const catalogue = await currentCatalogue();
  const allRoles = isOwner ? await listRoles() : [];
  // Ce que le propriétaire peut cocher pour une personne : les rôles prédéfinis admin et éditeur, puis les rôles personnalisés (jamais « owner »).
  const assignable = allRoles.filter((r) => r.key !== "owner");
  const roleName = (r: { key: string; name: string; system: boolean }) => (r.system ? t(`role.${r.key}`) : r.name);
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  const locks = new Map(await Promise.all(users.map(async (u) => [u.id, await isEmailLocked(u.email)] as const)));
  const roles = isOwner ? ["admin", "editor"] : ["editor"];
  const tempLabels = {
    open: t("users.temp.open"), title: t("users.temp.title"), generate: t("users.temp.generate"), generateHelp: t("users.temp.generateHelp"), custom: t("users.temp.custom"),
    customLabel: t("users.temp.customLabel"), customHelp: t("users.temp.customHelp", { n: MIN_PASSWORD_LENGTH }), warning: t("users.temp.warning"), apply: t("users.temp.apply"), cancel: t("floating.discard"), working: t("users.temp.working"),
    doneTitle: t("users.temp.doneTitle"), shownOnce: t("users.temp.shownOnce"), handOver: t("users.temp.handOver"), copy: t("users.temp.copy"), copied: t("users.temp.copied"),
    mailed: t("users.temp.mailed"), noMail: t("users.temp.noMail"), savedCustom: t("users.temp.savedCustom"), close: t("users.temp.close"),
  };
  const team = (
    <div className="space-y-8" data-tab="team">
      <Panel title={t("users.team", { n: users.length })} help={t("users.rolesHelp")} testid="team">
        <ul className="divide-y divide-line">
          {users.map((u) => {
            const secured = !!u.totpEnabledAt || u._count.passkeys > 0;
            const me = u.id === user.id;
            const lock = locks.get(u.id);
            const level = levelOf(u);
            const custom = u.roles.filter((r) => !r.role.system).map((r) => r.role);
            // Le rôle prédéfini coché suit le niveau (`User.role`), même si l'affectation n'a pas encore été écrite.
            const held = new Set([...custom.map((r) => r.id), ...allRoles.filter((r) => r.system && r.key === level).map((r) => r.id)]);
            const canLines = describeAccess(level, rightsOf(level, custom.flatMap((r) => parseStoredRights(r.rights, catalogue)), catalogue), catalogue, t, locale, config.defaultLocale);
            const canDelete = level !== "owner" && !me && (isOwner || level === "editor");
            const canReset = isOwner && !me;
            // Mot de passe temporaire : propriétaire seulement, jamais sur soi-même (Mon compte) ni sur un autre propriétaire. Le serveur le revérifie.
            const canTempPassword = isOwner && !me && level !== "owner";
            const hasDanger = canDelete || canReset || canTempPassword;
            return (
              <li key={u.id} className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid="user-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {u.name}{me && <span className={`${ui.chip} ml-2`}>{t("users.you")}</span>}
                    </p>
                    <p className="break-all text-sm text-muted">{u.email}</p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {isOwner && level !== "owner" ? null : (
                        <>
                          {level !== "none" && <span className={ui.chip}>{t(`role.${level}`)}</span>}
                          {custom.map((r) => <span key={r.id} className={ui.chip} data-testid="user-role-chip">{r.name}</span>)}
                        </>
                      )}
                      {u.mustChangePassword && <span className={ui.chipWarn} data-testid="user-must-change">{t("users.mustChange")}</span>}
                      {secured && <span className={ui.chipOk} data-testid="user-2fa" title={t("users.twofa")}>🔐 {t("users.secured")}</span>}
                    </p>
                  </div>
                </div>
                {isOwner && level !== "owner" && (
                  <div className="space-y-2" data-testid="user-roles">
                    <ActionForm action={setUserRolesAction.bind(null, u.id)} submitLabel={t("users.changeRole")} className="space-y-3">
                      <fieldset>
                        <legend className="mb-2 text-sm font-medium">{t("users.rolesOf", { name: u.name })}</legend>
                        <div className="flex flex-wrap gap-2">
                          {assignable.map((r) => (
                            <label key={r.id} className={`${ui.chip} cursor-pointer gap-1.5 has-[:checked]:border-accent has-[:checked]:bg-accent/10`}>
                              <input type="checkbox" name="roleId" value={r.id} defaultChecked={held.has(r.id)} className="h-4 w-4 accent-[var(--v-accent)]" />
                              {roleName(r)}
                            </label>
                          ))}
                        </div>
                        <p className={ui.help}>{t("users.rolesHelpChips")}</p>
                      </fieldset>
                    </ActionForm>
                  </div>
                )}
                <details className="text-sm" data-testid="user-can">
                  <summary className="cursor-pointer text-muted">{t("users.canDo")}</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">{canLines.map((line) => <li key={line}>{line}</li>)}</ul>
                </details>
                {lock && (
                  <Callout tone="warn" testid="user-locked">
                    <span className="flex flex-wrap items-center gap-3">
                      {t("users.locked", { time: formatUntil(lock, locale) })}
                      {isOwner && <form action={unlockUser.bind(null, u.id)}><PendingButton>{t("users.unlock")}</PendingButton></form>}
                    </span>
                  </Callout>
                )}
                {hasDanger && (
                  <DangerZone title={t("users.moreActions")}>
                    {canTempPassword && (
                      <TemporaryPasswordButton memberName={`${u.name} — ${u.email}`} action={setTemporaryPassword.bind(null, u.id)} labels={tempLabels} />
                    )}
                    {canReset && secured && <form action={resetUserTwoFactor.bind(null, u.id)}><ConfirmButton message={t("users.twofaResetConfirm")}>{t("users.twofaReset")}</ConfirmButton></form>}
                    {canReset && <form action={revokeUserSessions.bind(null, u.id)}><ConfirmButton message={t("users.revokeConfirm")}>{t("users.revoke")}</ConfirmButton></form>}
                    {canDelete && <form action={deleteUser.bind(null, u.id)}><ConfirmButton message={t("users.deleteConfirm", { name: u.name })}>{t("users.deleteAccount")}</ConfirmButton></form>}
                  </DangerZone>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={t("users.add")} help={t("users.addHelp")}>
        <ActionForm action={createUser} submitLabel={t("users.addButton")} pendingLabel={t("progress.creating")} reset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label={t("field.name")} required />
            <TextField name="email" type="email" label={t("field.email")} required />
            <TextField name="password" type="password" label={t("users.firstPassword")} required help={t("users.passwordHelp")} autoComplete="new-password" />
            <Select name="role" label={t("users.role")} options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
          </div>
        </ActionForm>
      </Panel>

      {isOwner && (
        <Panel title={t("users.securityTitle")} testid="require-2fa">
          <ActionForm action={setRequireTwoFactor} submitLabel={t("action.save")}>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="require" defaultChecked={required} className="mt-1 h-4 w-4" /><span><span className="font-medium">{t("users.require2fa")}</span><span className="block text-muted">{t("users.require2faHelp")}</span></span></label>
          </ActionForm>
        </Panel>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.users")} intro={t("users.intro")} />
      {/* Rôles : propriétaire seulement (décision 4). Pour les autres, la page reste celle d'avant. */}
      {isOwner ? (
        <Tabs tabs={[{ id: "team", label: t("users.tab.team") }, { id: "roles", label: t("users.tab.roles") }]}>
          {team}
          <div data-tab="roles"><RolesPanel roles={allRoles} catalogue={catalogue} t={t} locale={locale} defaultLocale={config.defaultLocale} /></div>
        </Tabs>
      ) : team}
    </div>
  );
}
