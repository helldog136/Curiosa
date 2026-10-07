import { redirect } from "next/navigation";
import { getAdminTranslator } from "@/core/i18n/request";
import { currentUser } from "@/core/permissions";
import { countUsers } from "@/core/content/service";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect("/admin/setup");
  if (await currentUser()) redirect("/admin");
  const { t } = await getAdminTranslator();
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-2xl font-bold">{t("login.title")}</h1>
      <ActionForm action={loginAction} submitLabel={t("login.submit")}>
        <TextField name="email" type="email" label={t("field.email")} required autoComplete="username" />
        <TextField name="password" type="password" label={t("field.password")} required autoComplete="current-password" />
      </ActionForm>
    </div>
  );
}
