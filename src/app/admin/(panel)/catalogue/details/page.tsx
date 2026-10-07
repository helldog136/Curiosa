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
  const { t, locale, config, user } = await adminCtx("admin");
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
    else return <Shell title={t("catalogue.custom")} back={t("catalogue.back")}><p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t(parsed.error)}</p></Shell>;
  } else notFound();

  let preview: ModulePreview | null = null;
  let failed = false;
  if (target) { try { preview = await getModulePreview(target); } catch (e) { console.error("[catalogue] preview failed:", (e as Error)?.message); failed = true; } }

  const m = preview?.manifest ?? null;
  const installed = entry ? (await listModuleRows()).some((r) => r.id === entry!.id) : false;

  return (
    <Shell title={`${entry?.icon ?? m?.icon ?? "🧩"} ${entry ? L(entry.name) : m ? L(m.name) : custom?.url ?? ""}`} back={t("catalogue.back")}>
      <p className="text-sm text-muted">
        {(entry?.version ?? m?.version) && <>v{entry?.version ?? m?.version} · </>}
        {entry ? <span className="rounded bg-line px-2 py-0.5 text-xs">✔ {t("catalogue.verified")}</span> : <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs">{t("catalogue.origin.custom")}</span>}
        {custom && <span className="ml-2 break-all font-mono text-xs">{custom.url}{custom.ref ? `#${custom.ref}` : ""}</span>}
      </p>
      {entry && <p className="text-muted">{L(entry.description)}</p>}

      {failed && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t("catalogue.previewFailed")}</p>}

      {m && (
        <section className={`${ui.card} space-y-2 text-sm`}>
          <h2 className="font-semibold">{t("catalogue.asks")}</h2>
          <p><span className="text-muted">{t("modules.permissions")} :</span> {m.permissions.length ? m.permissions.join(", ") : t("catalogue.none")}</p>
          {(m.requires ?? []).length > 0 && <p><span className="text-muted">{t("modules.requires")} :</span> {(m.requires ?? []).map((r) => (r.label ? L(r.label) : r.service)).join(", ")}</p>}
          {(m.offers ?? []).length > 0 && <p><span className="text-muted">{t("modules.offers")} :</span> {(m.offers ?? []).map((o) => (o.label ? L(o.label) : o.service)).join(", ")}</p>}
          {m.license && <p><span className="text-muted">{t("catalogue.license")} :</span> {m.license}{m.author ? ` · ${m.author}` : ""}</p>}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">README</h2>
        {preview?.readme ? (
          <div className={`${ui.card} overflow-x-auto`}>
            <Markdown text={preview.readme} untrusted />
            {preview.truncated && <p className="mt-4 text-xs text-muted">{t("catalogue.truncated")}</p>}
          </div>
        ) : !failed ? <p className="text-sm text-muted">{t("catalogue.noReadme")}</p> : null}
      </section>

      {isOwner && !failed && (
        <section className={`${ui.card} space-y-3`}>
          {entry ? (
            installed ? <a href="/admin/modules" className="text-sm text-accent hover:underline">{t("catalogue.installed")}</a>
              : !entry.compatible ? <p className="text-sm text-muted">{t("catalogue.incompatible")}</p>
              : <form action={installFromCatalogueAction.bind(null, entry.id)}><button className={ui.btnPrimary}>{t("modules.installButton")}</button></form>
          ) : custom ? (
            <>
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("catalogue.customWarning")}</p>
              <ActionForm action={installCustomAction} submitLabel={t("modules.installButton")}>
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

function Shell({ title, back, children }: { title: string; back: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <a href="/admin/catalogue" className="text-sm text-muted hover:underline">← {back}</a>
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
