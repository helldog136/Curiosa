import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Select, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { isEmailLocked, formatUntil } from "@/core/auth/lockout";
import { createUser, deleteUser, revokeUserSessions, setUserRole, unlockUser } from "./actions";

export default async function UsersPage() {
  const { t, user, locale } = await adminCtx("admin");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const isOwner = user.role === "owner";
  const locks = new Map(await Promise.all(users.map(async (u) => [u.id, await isEmailLocked(u.email)] as const)));
  const roles = isOwner ? ["admin", "editor"] : ["editor"];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t("nav.users")}</h1>
      <table className="w-full">
        <thead><tr><th className={ui.th}>{t("field.name")}</th><th className={ui.th}>{t("field.email")}</th><th className={ui.th}>{t("users.role")}</th><th className={ui.th} /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className={ui.td}>{u.name}</td>
              <td className={ui.td}>
                {u.email}
                {locks.get(u.id) && (
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-600" data-testid="user-locked">
                    {t("users.locked", { time: formatUntil(locks.get(u.id)!, locale) })}
                    {isOwner && <form action={unlockUser.bind(null, u.id)}><button className="underline">{t("users.unlock")}</button></form>}
                  </span>
                )}
              </td>
              <td className={ui.td}>
                {isOwner && u.role !== "owner" ? (
                  <form action={setUserRole.bind(null, u.id)} className="flex gap-2">
                    <select name="role" defaultValue={u.role} className={ui.input}>
                      {roles.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                    <button className={ui.btn}>{t("action.save")}</button>
                  </form>
                ) : t(`role.${u.role}`)}
              </td>
              <td className={ui.td}>
                {isOwner && u.id !== user.id && (
                  <form action={revokeUserSessions.bind(null, u.id)} className="mb-1"><ConfirmButton message={t("users.revokeConfirm")}>{t("users.revoke")}</ConfirmButton></form>
                )}
                {u.role !== "owner" && u.id !== user.id && (isOwner || u.role === "editor") && (
                  <form action={deleteUser.bind(null, u.id)}><ConfirmButton message={t("confirm.delete")}>{t("action.delete")}</ConfirmButton></form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{t("users.add")}</h2>
        <ActionForm action={createUser} submitLabel={t("action.create")} reset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label={t("field.name")} required />
            <TextField name="email" type="email" label={t("field.email")} required />
            <TextField name="password" type="password" label={t("field.password")} required help={t("users.passwordHelp")} autoComplete="new-password" />
            <Select name="role" label={t("users.role")} options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
