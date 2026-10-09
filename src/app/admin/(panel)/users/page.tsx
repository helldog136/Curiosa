import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Select, TextField } from "@/components/admin/Field";
import { Callout, DangerZone, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { isEmailLocked, formatUntil } from "@/core/auth/lockout";
import { getSetting } from "@/core/settings";
import { createUser, deleteUser, resetUserTwoFactor, revokeUserSessions, setRequireTwoFactor, setUserRole, unlockUser } from "./actions";

/** L'équipe : qui est là et ce qu'elle peut faire, puis ajouter quelqu'un, puis la sécurité de toute l'équipe. */
export default async function UsersPage() {
  const { t, user, locale } = await adminCtx("admin");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { passkeys: true } } } });
  const isOwner = user.role === "owner";
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  const locks = new Map(await Promise.all(users.map(async (u) => [u.id, await isEmailLocked(u.email)] as const)));
  const roles = isOwner ? ["admin", "editor"] : ["editor"];
  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.users")} intro={t("users.intro")} />

      <Panel title={t("users.team", { n: users.length })} help={t("users.rolesHelp")} testid="team">
        <ul className="divide-y divide-line">
          {users.map((u) => {
            const secured = !!u.totpEnabledAt || u._count.passkeys > 0;
            const me = u.id === user.id;
            const lock = locks.get(u.id);
            const canDelete = u.role !== "owner" && !me && (isOwner || u.role === "editor");
            const canReset = isOwner && !me;
            const hasDanger = canDelete || canReset;
            return (
              <li key={u.id} className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid="user-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {u.name}{me && <span className={`${ui.chip} ml-2`}>{t("users.you")}</span>}
                    </p>
                    <p className="break-all text-sm text-muted">{u.email}</p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {isOwner && u.role !== "owner" ? null : <span className={ui.chip}>{t(`role.${u.role}`)}</span>}
                      {secured && <span className={ui.chipOk} data-testid="user-2fa" title={t("users.twofa")}>🔐 {t("users.secured")}</span>}
                    </p>
                  </div>
                  {isOwner && u.role !== "owner" && (
                    <form action={setUserRole.bind(null, u.id)} className="flex items-center gap-2">
                      <select name="role" defaultValue={u.role} className={`${ui.input} !w-auto`} aria-label={`${t("users.role")} — ${u.name}`}>
                        {roles.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                      </select>
                      <button className={ui.btn}>{t("users.changeRole")}</button>
                    </form>
                  )}
                </div>
                {lock && (
                  <Callout tone="warn" testid="user-locked">
                    <span className="flex flex-wrap items-center gap-3">
                      {t("users.locked", { time: formatUntil(lock, locale) })}
                      {isOwner && <form action={unlockUser.bind(null, u.id)}><button className={ui.btn}>{t("users.unlock")}</button></form>}
                    </span>
                  </Callout>
                )}
                {hasDanger && (
                  <DangerZone title={t("users.moreActions")}>
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
        <ActionForm action={createUser} submitLabel={t("users.addButton")} reset>
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
}
