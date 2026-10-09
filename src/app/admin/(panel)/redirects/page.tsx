import { adminCtx } from "@/core/admin";
import { listInstances } from "@/core/instances";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, Select, TextField } from "@/components/admin/Field";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { ui } from "@/components/admin/ui";
import { siteUrl } from "@/core/config";
import { createRedirect, deleteRedirect, toggleRedirect } from "./actions";

export default async function RedirectsPage() {
  const { t, advanced } = await adminCtx("editor");
  const redirects = await prisma.redirect.findMany({ orderBy: { path: "asc" } });
  const entryIds = redirects.map((r) => r.entryId).filter((x): x is string => !!x);
  const linked = await prisma.entry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, url: true },
  });
  const collections = await listInstances();
  const withUrl = await prisma.entry.findMany({
    where: { url: { not: null }, instanceId: { in: collections.filter((c) => c.features.includes("url")).map((c) => c.id) } },
    include: { translations: { take: 1 } },
    take: 200,
  });
  const site = new URL(siteUrl).host;

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>{advanced ? t("nav.redirects") : t("nav.redirects.simple")}</h1>
        <p className={ui.pageIntro}>{advanced ? t("redirects.intro") : t("redirects.introSimple", { site })}</p>
      </div>

      {redirects.length === 0 ? (
        // État vide : on explique à quoi ça sert, avec des exemples, et le formulaire juste en dessous est l'étape suivante.
        <div className={`${ui.card} space-y-1 text-[15px] leading-6`}>
          <p className="font-medium">{advanced ? t("redirects.empty") : t("redirects.empty.simple")}</p>
          <p className="text-muted">{t("redirects.examples")}</p>
        </div>
      ) : (
        <table className="w-full">
          <thead><tr><th className={ui.th}>{t("redirects.path")}</th><th className={ui.th}>{t("redirects.target")}</th>{advanced && <th className={ui.th}>{t("redirects.hits")}</th>}<th className={ui.th} /></tr></thead>
          <tbody>
            {redirects.map((r) => (
              <tr key={r.id} className={`border-t border-line ${r.active ? "" : "opacity-50"}`}>
                <td className={`${ui.td} font-mono`}>/{r.path}</td>
                <td className={`${ui.td} break-all`}>
                  {linked.find((e) => e.id === r.entryId)?.url ?? r.targetUrl}
                  {r.entryId && <span className="ml-2 rounded bg-surface px-1.5 text-xs">{t("redirects.followsEntry")}</span>}
                </td>
                {advanced && <td className={ui.td}>{r.hits}</td>}
                <td className={`${ui.td} flex gap-2`}>
                  <form action={toggleRedirect.bind(null, r.id)}><button className={ui.btn}>{r.active ? t("action.disable") : t("action.enable")}</button></form>
                  <form action={deleteRedirect.bind(null, r.id)}><ConfirmButton message={t("confirm.delete")}>{t("action.delete")}</ConfirmButton></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className={`${ui.card} space-y-4`}>
        <h2 className="text-lg font-semibold">{advanced ? t("redirects.add") : t("redirects.add.simple")}</h2>
        <ActionForm action={createRedirect} submitLabel={t("redirects.addButton")} reset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="path" label={t("redirects.path")} placeholder="twitch" required help={t("redirects.pathHelp", { site })} />
            <TextField name="targetUrl" type="url" label={t("redirects.target")} placeholder="https://" help={t("redirects.targetHelp")} />
          </div>
          {/* Facultatif : n'apparaît que s'il existe une entrée avec un lien, et reste replié tant qu'on n'en a pas besoin. */}
          {withUrl.length > 0 && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("redirects.orEntry")}</summary>
              <div className="mt-3">
                <Select name="entryId" label={t("redirects.entryLabel")} help={t("redirects.orEntryHelp")}
                  options={[{ value: "", label: t("redirects.entryNone") }, ...withUrl.map((e) => ({ value: e.id, label: `${e.translations[0]?.title ?? e.id} — ${e.url}` }))]} />
              </div>
            </details>
          )}
          {advanced && <Checkbox name="permanent" label={t("redirects.permanent")} help={t("redirects.permanentHelp")} />}
        </ActionForm>
      </section>
    </div>
  );
}
