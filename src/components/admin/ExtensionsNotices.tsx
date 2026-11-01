import type { Translator } from "@/core/i18n/dictionary";
import { saveServiceRouting } from "@/app/admin/(panel)/modules/actions";
import { loadNotices } from "@/app/admin/(panel)/extensions/loadInstalled";
import { getInstanceLabeler } from "@/core/modules/labels";
import { decodeMissing, describeMissingList } from "@/core/modules/dependencyMessages";
import { localized } from "@/core/modules/types";
import { Callout } from "./Page";
import { ServiceRouter } from "./ServiceRouter";

export type NoticeQuery = { error?: string; detail?: string; missing?: string; notice?: string; /** Nom de l'extension concernée par l'avis (retirée, retrouvée…). */ name?: string };

/** Les messages en haut de « Installées » : refus lisible d'une action, nettoyage proposé, services en double à départager. */
export async function ExtensionsNotices({ t, locale, defaultLocale, isOwner, query }: { t: Translator; locale: string; defaultLocale: string; isOwner: boolean; query: NoticeQuery }) {
  const { error, detail, missing, notice, name } = query;
  const { duplicates, cleanup, names } = await loadNotices(locale, defaultLocale, isOwner);
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  return (
    <>
      {error && <Callout tone="danger">{error === "modules.error.requires" && decodeMissing(missing).length ? describeMissingList(decodeMissing(missing), t, names).join(" ") : error.startsWith("modules.error.") || error.startsWith("instances.error.") ? t(error, { services: detail ? detail.split(", ").map(names.service).join(", ") : "", modules: detail ? detail.split(", ").map(names.module).join(", ") : "" }) : t("error.generic")}</Callout>}
      {notice === "kept" && <Callout tone="info" role="status"><span data-testid="notice-kept">{t("remove.noticeKept", { name: name ?? "" })}</span></Callout>}
      {notice === "erased" && <Callout tone="info" role="status"><span data-testid="notice-erased">{t("remove.noticeErased", { name: name ?? "" })}</span></Callout>}
      {notice === "restored" && <Callout tone="info" role="status"><span data-testid="notice-restored">{t("kept.noticeRestored", { name: name ?? "" })}</span></Callout>}
      {cleanup.length > 0 && (
        <Callout tone="info" role="status">
          <p className="font-medium" data-testid="cleanup-banner">🧹 {t("deps.cleanup.bannerTitle")}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {cleanup.map((c) => <li key={c.id}><a href={`/admin/modules/${encodeURIComponent(c.id)}`} className="font-medium text-accent hover:underline">{names.module(c.id)}</a>{c.for.length > 0 && <span className="text-muted"> — {t("deps.auto.for", { names: c.for.map(names.module).join(", ") })}</span>}{c.hasData && <span className="text-amber-700"> {t("deps.cleanup.data")}</span>}</li>)}
          </ul>
        </Callout>
      )}
      {notice === "services" && <Callout tone="warn" role="alert">{t("services.notice")}</Callout>}
      {duplicates.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{t("services.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("services.intro")}</p>
          </div>
          {duplicates.map((d) => {
            const node = (p: (typeof d.providers)[number]) => ({ key: p.instance.key, name: labeler.label(p.instance), icon: p.mod.manifest.icon ?? "🧩", sub: localized(p.mod.manifest.name, locale, defaultLocale) });
            const consumers = d.consumers.map((c) => ({ key: c.instance.key, name: labeler.label(c.instance), icon: c.mod.manifest.icon ?? "🧩", sub: localized(c.mod.manifest.name, locale, defaultLocale) }));
            return (
              <ServiceRouter key={d.service} service={d.service} consumers={consumers} providers={d.providers.map(node)}
                master={(d.routing && d.providers.some((p) => p.instance.key === d.routing!.master) ? d.routing.master : d.providers[0]!.instance.key)}
                replicas={d.routing?.replicas ?? []} action={saveServiceRouting.bind(null, d.service)}
                labels={{ consumers: t("services.consumers"), providers: t("services.providers"), master: t("services.master"), replica: t("services.replica"), promote: t("services.promote"), remove: t("services.remove"), hint: t("services.hint"), list: t("services.list"), save: t("services.save"), pending: d.resolved ? null : t("services.pending") }} />
            );
          })}
        </section>
      )}
    </>
  );
}
