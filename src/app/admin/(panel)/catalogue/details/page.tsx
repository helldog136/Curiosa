import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { findCatalogueEntry } from "@/core/modules/catalogue";
import { parseRepoUrl } from "@/core/modules/installer";
import { getModulePreview, type ModulePreview, type PreviewTarget } from "@/core/modules/readme";
import { listModuleRows } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { Markdown } from "@/components/site/Markdown";
import { installCustomAction, installFromCatalogueAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Avant d'installer : le README du module et ce qu'il demande (permissions, services), lus sans l'installer.
 * `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié).
 */
export default async function CatalogueDetailsPage({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const { id, repo } = await searchParams;
  const isOwner = user.role === "owner";
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  let target: PreviewTarget | null = null;
  let entry: Awaited<ReturnType<typeof findCatalogueEntry>> | undefined;
  let custom: { url: string; ref?: string } | null = null;
  if (id) {
    entry = await findCatalogueEntry(id);
    if (!entry) notFound();
    target = entry.source === "bundled" && entry.dir ? { kind: "bundled", dir: entry.dir } : entry.repo ? { kind: "repo", url: entry.repo, ref: entry.ref } : null;
  } else if (repo) {
    const parsed = parseRepoUrl(repo);
    if (parsed.ok) { custom = parsed.repo; target = { kind: "repo", url: parsed.repo.url, ref: parsed.repo.ref }; }
    else return <Shell back={t("catalogue.back")}><p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t(parsed.error)}</p></Shell>;
  } else notFound();

  let preview: ModulePreview | null = null;
  let failed = false;
  if (target) { try { preview = await getModulePreview(target); } catch (e) { console.error("[catalogue] preview failed:", (e as Error)?.message); failed = true; } }

  const m = preview?.manifest ?? null;
  const installed = entry ? (await listModuleRows()).some((r) => r.id === entry!.id) : false;

  const name = entry ? L(entry.name) : m ? L(m.name) : custom?.url ?? "";
  const icon = entry?.icon ?? m?.icon ?? "🧩";
  const perms = (m?.permissions ?? []).filter((p) => t(`perm.${p}`) !== `perm.${p}`);

  return (
    <Shell back={t("catalogue.back")}>
      <header className="flex items-start gap-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent/10 text-4xl" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {entry ? <span className={ui.chipOk}>✔ {t("catalogue.verified")}</span> : <span className={ui.chipWarn}>⚠ {t("catalogue.origin.custom")}</span>}
            {advanced && (entry?.version ?? m?.version) && <span>v{entry?.version ?? m?.version}</span>}
            {m?.author && <span>{t("catalogue.by", { author: m.author })}</span>}
            {m?.license && advanced && <span>· {m.license}</span>}
          </p>
          {advanced && custom && <p className="mt-1 break-all font-mono text-xs text-muted">{custom.url}{custom.ref ? `#${custom.ref}` : ""}</p>}
        </div>
      </header>
      {entry && <p className="max-w-2xl text-[17px] leading-7">{L(entry.description)}</p>}

      {failed && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">{t("catalogue.previewFailed")}</p>}

      {m && (
        <section className={`${ui.card} space-y-3`}>
          <h2 className="text-lg font-semibold">{t("catalogue.asks.friendly")}</h2>
          {perms.length > 0 ? (
            <ul className="space-y-2 text-[15px]">
              {perms.map((p) => <li key={p} className="flex items-start gap-3"><span aria-hidden className="mt-0.5">✓</span><span>{t(`perm.${p}`)}</span></li>)}
              {(m.requires ?? []).length > 0 && <li className="flex items-start gap-3"><span aria-hidden className="mt-0.5">🔗</span><span>{t("catalogue.needs", { what: (m.requires ?? []).map((r) => (r.label ? L(r.label) : r.service)).join(", ") })}</span></li>}
            </ul>
          ) : <p className="text-sm text-muted">{t("catalogue.nothingSpecial")}</p>}
          {advanced && (
            <p className="border-t border-line pt-3 font-mono text-xs text-muted">
              {t("modules.permissions")}: {m.permissions.join(", ") || "—"}
              {(m.offers ?? []).length > 0 && <> · {t("modules.offers")}: {(m.offers ?? []).map((o) => o.service).join(", ")}</>}
              {(m.requires ?? []).length > 0 && <> · {t("modules.requires")}: {(m.requires ?? []).map((r) => r.service).join(", ")}</>}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("catalogue.presentation")}</h2>
        {preview?.readme ? (
          <article className={`${ui.card} overflow-x-auto !p-6 text-[16px] sm:!p-8 [&_h2:first-child]:mt-0 [&>div>*:first-child]:mt-0`}>
            <Markdown text={preview.readme} untrusted />
            {preview.truncated && <p className="mt-6 text-xs text-muted">{t("catalogue.truncated")}</p>}
          </article>
        ) : !failed ? <p className="text-sm text-muted">{t("catalogue.noReadme")}</p> : null}
      </section>

      {isOwner && !failed && (
        <section className={`${ui.card} space-y-4`}>
          {entry ? (
            installed ? <a href="/admin/modules" className="text-sm font-medium text-accent hover:underline">{t("catalogue.installed")}</a>
              : !entry.compatible ? <p className="text-sm text-muted">{t("catalogue.incompatible")}</p>
              : (
                <form action={installFromCatalogueAction.bind(null, entry.id)} className="flex flex-wrap items-center gap-4">
                  <button className={`${ui.btnPrimary} !px-7 !py-3 !text-base`}>{t("catalogue.install")}</button>
                  <p className="text-sm text-muted">{t("catalogue.installNote")}</p>
                </form>
              )
          ) : custom ? (
            <>
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{t("catalogue.customWarning")}</p>
              <ActionForm action={installCustomAction} submitLabel={t("catalogue.install")}>
                <input type="hidden" name="repo" value={`${custom.url}${custom.ref ? `#${custom.ref}` : ""}`} />
                <Checkbox name="trust" label={t("catalogue.trust")} required />
              </ActionForm>
            </>
          ) : null}
        </section>
      )}
    </Shell>
  );
}

function Shell({ back, children }: { back: string; children: React.ReactNode }) {
  return (
    <div className="space-y-7">
      <a href="/admin/catalogue" className="inline-block text-sm text-muted hover:text-accent">← {back}</a>
      {children}
    </div>
  );
}
