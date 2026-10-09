import { adminCtx } from "@/core/admin";
import { getCatalogue } from "@/core/modules/catalogue";
import { getInstanceLabeler } from "@/core/modules/labels";
import { localized } from "@/core/modules/types";
import { providersOf } from "@/core/services/topics";
import { loadSocialLinks, SOCIAL_TOPIC } from "@/core/social";
import { prisma } from "@/core/db";
import { EntryIcon } from "@/components/site/EntryIcon";
import { ui } from "@/components/admin/ui";
import { addNetwork } from "./actions";

export const dynamic = "force-dynamic";

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t, locale, config, user } = await adminCtx("admin");
  const { error } = await searchParams;
  const providers = await providersOf(SOCIAL_TOPIC);
  const links = await loadSocialLinks(locale, 200);
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const market = (await getCatalogue().catch(() => [])).filter((e) => e.compatible && e.provides?.includes(SOCIAL_TOPIC));
  const counts = new Map<string, number>();
  for (const row of await prisma.moduleInstance.groupBy({ by: ["moduleId"], _count: true })) counts.set(row.moduleId, row._count);
  const isOwner = user.role === "owner";

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>{t("social.title")}</h1>
        <p className={ui.pageIntro}>{t("social.intro")}</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error, { service: "" }) : t("error.generic")}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("social.active")}</h2>
        {providers.length === 0 ? <p className={ui.help}>{t("social.none")}</p> : (
          <ul className="space-y-2" data-testid="social-active">
            {providers.map(({ instance, mod }) => {
              const shown = links.filter((l) => l.instance === instance.key);
              return (
                <li key={instance.id} className={`${ui.card} flex flex-wrap items-center gap-3`}>
                  <span className="inline-flex h-6 w-6 items-center justify-center">{shown[0] ? <EntryIcon icon={shown[0].icon} className="h-5 w-5" /> : mod.manifest.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{labeler.label(instance)}</p>
                    <p className={`${ui.help} truncate`}>{shown.length > 0 ? shown.map((l) => l.href).join(" · ") : t("social.toSet")}</p>
                  </div>
                  <a href={`/admin/instances/${instance.id}`} className={ui.btn}>{t("social.settings")}</a>
                </li>
              );
            })}
          </ul>
        )}
        <p className={ui.help}>{t("social.headerHint")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("social.add")}</h2>
        {market.length === 0 ? <p className={ui.help}>{t("social.noneAvailable")}</p> : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="social-available">
            {market.map((e) => (
              <li key={e.id} className={`${ui.card} space-y-2`}>
                <p className="font-medium">{e.icon} {localized(e.name, locale, config.defaultLocale)}</p>
                <p className={ui.help}>{localized(e.description, locale, config.defaultLocale)}</p>
                {isOwner ? (
                  <form action={addNetwork.bind(null, e.id)} className="flex flex-wrap items-center gap-2">
                    {(counts.get(e.id) ?? 0) > 0 && <input name="nickname" required placeholder={t("social.nickname")} aria-label={t("social.nickname")} className={`${ui.input} max-w-48`} />}
                    <button type="submit" className={ui.btnPrimary}>{t("social.addButton")}</button>
                  </form>
                ) : <p className={ui.help}>{t("social.ownerOnly")}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
