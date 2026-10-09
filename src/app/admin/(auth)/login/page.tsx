import { redirect } from "next/navigation";
import { getAdminTranslator } from "@/core/i18n/request";
import { currentUser } from "@/core/permissions";
import { countUsers } from "@/core/content/service";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if ((await countUsers()) === 0) redirect("/admin/setup");
  if (await currentUser()) redirect("/admin");
  const { t } = await getAdminTranslator();
  const { changed } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-2xl font-bold">{t("login.title")}</h1>
      {changed === "1" && <p role="status" className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">{t("login.changed")}</p>}
      <LoginForm labels={{ email: t("field.email"), password: t("field.password"), submit: t("login.submit"), code: t("login.code"), codeHelp: t("login.codeHelp"), codeSubmit: t("login.codeSubmit"), back: t("login.back") }} />
    </div>
  );
}
