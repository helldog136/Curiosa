import { adminCtx } from "@/core/admin";
import { getCatalogue, getCatalogueSource } from "@/core/modules/catalogue";
import { listModuleRows } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { installCustomAction, installFromCatalogueAction, refreshCatalogueAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { t, locale, config, user } = await adminCtx("admin");
  const { error } = await searchParams;
  const isOwner = user.role === "owner";
  const entries = await getCatalogue();
  const source = await getCatalogueSource();
  const installed = new Set((await listModuleRows()).map((r) => r.id));
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const groups = [
    { id: "community", title: t("catalogue.community"), list: entries.filter((e) => e.kind === "community") },
    { id: "recognized", title: t("catalogue.recognized"), list: entries.filter((e) => e.kind === "recognized") },
    { id: "example", title: t("catalogue.examples"), list: entries.filter((e) => e.kind === "example") },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">🛒 {t("nav.catalogue")}</h1>
        <p className="mt-1 text-sm text-muted">{t("catalogue.intro")}</p>
        <p className="mt-1 text-sm text-muted">{t("catalogue.free")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {source.source === "repository" && t("catalogue.source.repository", { date: new Date(source.fetchedAt ?? 0).toLocaleString(locale) })}
          {source.source === "cache" && t("catalogue.source.cache", { date: new Date(source.fetchedAt ?? 0).toLocaleString(locale) })}
          {(source.source === "snapshot" || source.source === "none") && t("catalogue.source.snapshot")}
        </span>
        {isOwner && <form action={refreshCatalogueAction}><button className="underline">{t("catalogue.refresh")}</button></form>}
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{error.startsWith("modules.error.") ? t(error) : t("error.generic")}</p>}

      {groups.map((g) => g.list.length > 0 && (
        <section key={g.id} className="space-y-3">
          <h2 className="text-lg font-semibold">{g.title}</h2>
          <ul className="space-y-3">
            {g.list.map((e) => (
              <li key={e.id} className={`${ui.card} flex flex-wrap items-center justify-between gap-4`}>
                <div className="min-w-0">
                  <p className="font-medium">
                    {e.icon ?? "🧩"} {L(e.name)} {e.version && <span className="text-xs text-muted">v{e.version}</span>}{" "}
                    <span className="rounded bg-line px-2 py-0.5 text-xs">✔ {t("catalogue.verified")}</span>
                  </p>
                  <p className="text-sm text-muted">{L(e.description)}</p>
                  {e.donate && <p className="mt-1 text-xs"><a href={e.donate} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">♥ {t("catalogue.donate")}</a></p>}
                  {e.source === "recognized" && e.repo && <p className="mt-1 break-all font-mono text-xs text-muted">{e.repo}{e.ref ? `#${e.ref}` : ""}</p>}
                </div>
                {installed.has(e.id) ? (
                  <a href="/admin/modules" className="text-sm text-accent hover:underline">{t("catalogue.installed")}</a>
                ) : !e.compatible ? (
                  <span className="text-sm text-muted">{t("catalogue.incompatible")}</span>
                ) : isOwner ? (
                  <form action={installFromCatalogueAction.bind(null, e.id)}><button className={ui.btnPrimary}>{t("modules.installButton")}</button></form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length === 0 && <p className="text-muted">{t("catalogue.empty")}</p>}

      {isOwner && (
        <details className={`${ui.card} space-y-4`}>
          <summary className="cursor-pointer text-lg font-semibold">{t("catalogue.custom")}</summary>
          <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("catalogue.customWarning")}</p>
          <ActionForm action={installCustomAction} submitLabel={t("modules.installButton")}>
            <TextField name="repo" type="url" label={t("modules.repoUrl")} placeholder="https://github.com/owner/vitrine-module-example" required help={t("modules.repoHelp")} />
            <Checkbox name="trust" label={t("catalogue.trust")} required />
          </ActionForm>
        </details>
      )}
    </div>
  );
}
