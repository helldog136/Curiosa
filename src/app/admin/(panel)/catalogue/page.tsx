import { adminCtx } from "@/core/admin";
import { getCatalogue, getCatalogueSource } from "@/core/modules/catalogue";
import { listModuleRows } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { refreshCatalogueAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const { error } = await searchParams;
  const isOwner = user.role === "owner";
  const entries = await getCatalogue();
  const source = await getCatalogueSource();
  const installed = new Set((await listModuleRows()).map((r) => r.id));
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const groups = [
    { id: "community", title: advanced ? t("catalogue.community") : t("catalogue.community.simple"), list: entries.filter((e) => e.kind === "community") },
    { id: "recognized", title: advanced ? t("catalogue.recognized") : t("catalogue.recognized.simple"), list: entries.filter((e) => e.kind === "recognized") },
    // Les exemples servent à apprendre à créer un module : inutile pour qui veut seulement un site.
    ...(advanced ? [{ id: "example", title: t("catalogue.examples"), list: entries.filter((e) => e.kind === "example") }] : []),
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className={ui.pageTitle}>✨ {advanced ? t("nav.catalogue") : t("nav.catalogue.title.simple")}</h1>
        <p className={ui.pageIntro}>{advanced ? t("catalogue.intro") : t("catalogue.intro.simple")}</p>
        <p className="mt-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-800">💚 {t("catalogue.free")}</p>
      </div>
      {advanced && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {source.source === "repository" && t("catalogue.source.repository", { date: new Date(source.fetchedAt ?? 0).toLocaleString(locale) })}
            {source.source === "cache" && t("catalogue.source.cache", { date: new Date(source.fetchedAt ?? 0).toLocaleString(locale) })}
            {(source.source === "snapshot" || source.source === "none") && t("catalogue.source.snapshot")}
          </span>
          {isOwner && <form action={refreshCatalogueAction}><button className="underline">{t("catalogue.refresh")}</button></form>}
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error) : t("error.generic")}</p>}

      {groups.map((g) => g.list.length > 0 && (
        <section key={g.id} className="space-y-4">
          <h2 className="text-xl font-semibold">{g.title}</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {g.list.map((e) => (
              <li key={e.id} className={`${ui.card} flex flex-col gap-4`}>
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{e.icon ?? "🧩"}</span>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-tight">{L(e.name)}{advanced && e.version && <span className="ml-2 text-xs font-normal text-muted">v{e.version}</span>}</p>
                    <p className="mt-1 line-clamp-4 text-sm leading-5 text-muted">{L(e.description)}</p>
                    {advanced && e.source === "recognized" && e.repo && <p className="mt-1 break-all font-mono text-xs text-muted">{e.repo}{e.ref ? `#${e.ref}` : ""}</p>}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <span className={ui.chipOk}>✔ {t("catalogue.verified")}</span>
                  {installed.has(e.id) ? (
                    <a href="/admin/modules" className="text-sm font-medium text-accent hover:underline">{t("catalogue.installed")}</a>
                  ) : !e.compatible ? (
                    <span className="text-sm text-muted">{t("catalogue.incompatible")}</span>
                  ) : (
                    <a href={`/admin/catalogue/details?id=${encodeURIComponent(e.id)}`} className={ui.btnPrimary}>{advanced ? t("catalogue.details") : t("catalogue.details.simple")}</a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length === 0 && <p className="text-muted">{t("catalogue.empty")}</p>}

      {isOwner && advanced && (
        <details className={`${ui.card} space-y-4`}>
          <summary className="cursor-pointer text-lg font-semibold">{t("catalogue.custom")}</summary>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("catalogue.customWarning")}</p>
          <form action="/admin/catalogue/details" method="get" className="space-y-3">
            <TextField name="repo" type="url" label={t("modules.repoUrl")} placeholder="https://github.com/owner/curiosa-module-example" required help={t("modules.repoHelp")} />
            <button className={ui.btnPrimary}>{t("catalogue.preview")}</button>
          </form>
        </details>
      )}
    </div>
  );
}
