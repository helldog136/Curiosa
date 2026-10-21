import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { isOwner as ownerCheck } from "@/core/auth/access";
import { findCatalogueEntry } from "@/core/modules/catalogue";
import { getCoreVersion } from "@/core/modules/compat";
import { parseRepoUrl } from "@/core/modules/installer";
import { getModulePreview, type ModulePreview, type PreviewTarget } from "@/core/modules/readme";
import { listModuleRows } from "@/core/modules/registry";
import { listRetired } from "@/core/modules/retired";
import { Callout } from "@/components/admin/Page";
import { localized } from "@/core/modules/types";
import { buildNames, viewPlan } from "@/core/modules/dependencyView";
import { normalizeNeeds } from "@/core/modules/serviceVersions";
import { DependencyPlanBox } from "@/components/admin/DependencyPlanBox";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { Markdown } from "@/components/site/Markdown";
import { InstallButton } from "@/components/admin/InstallButton";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { installCustomAction, installExtraAction } from "../actions";

/**
 * Avant d'installer : le README du module et ce qu'il demande (permissions, services), lus sans l'installer.
 * `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié).
 */
/** Le contenu d'une fiche de module : seul ou dans la fenêtre par-dessus le catalogue (`embedded`, avec le bouton d'installation flottant en bas). */
export async function DetailsView({ id, repo, embedded = false }: { id?: string; repo?: string; embedded?: boolean }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const isOwner = ownerCheck(user);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  let target: PreviewTarget | null = null;
  let entry: Awaited<ReturnType<typeof findCatalogueEntry>> | undefined;
  let custom: { url: string; ref?: string; subdir?: string } | null = null;
  if (id) {
    entry = await findCatalogueEntry(id);
    if (!entry) notFound();
    target = entry.repo ? { kind: "repo", url: entry.repo, ref: entry.ref, subdir: entry.subdir } : null;
  } else if (repo) {
    const parsed = parseRepoUrl(repo);
    if (parsed.ok) { custom = parsed.repo; target = { kind: "repo", url: parsed.repo.url, ref: parsed.repo.ref, subdir: parsed.repo.subdir }; }
    else return <Frame embedded={embedded} back={t("catalogue.back")}><p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t(parsed.error)}</p></Frame>;
  } else notFound();

  let preview: ModulePreview | null = null;
  let failed = false;
  if (target) { try { preview = await getModulePreview(target); } catch (e) { console.error("[catalogue] preview failed:", (e as Error)?.message); failed = true; } }

  const m = preview?.manifest ?? null;
  const installed = entry ? (await listModuleRows()).some((r) => r.id === entry!.id) : false;
  // Données gardées d'une désinstallation précédente : elles reviennent telles quelles avec le module.
  const kept = !installed && (entry?.id ?? m?.id) ? await listRetired(entry?.id ?? m?.id) : [];

  const name = entry ? L(entry.name) : m ? L(m.name) : custom?.url ?? "";
  const icon = entry?.icon ?? m?.icon ?? "🧩";
  const perms = (m?.permissions ?? []).filter((p) => t(`perm.${p}`) !== `perm.${p}`);

  // Ce que l'installation apportera aussi : le manifeste lu s'il l'est, sinon ce que l'index annonce. Toujours montré, avec ou sans permissions.
  const names = await buildNames(locale, config.defaultLocale);
  const needs = m ? normalizeNeeds(m.requires) : entry?.needs ?? [];
  const planView = !installed && (entry || m) ? await viewPlan(entry?.id ?? m?.id ?? "", needs, names) : null;

  const installLabels = { install: t("catalogue.install"), installing: t("catalogue.installing"), done: t("catalogue.installDone"), failed: t("catalogue.installFailed") };
  const canInstall = isOwner && !failed && !!entry && !installed && entry.compatible && !entry.needsNewerCore;

  return (
    <Frame embedded={embedded} back={t("catalogue.back")}>
      <header className="flex items-start gap-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent/10 text-4xl" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {entry && entry.origin !== "extra" ? <span className={ui.chipOk}>✔ {t("catalogue.verified")}</span> : entry ? <span className={ui.chipWarn}>⚠ {t("catalogue.origin.extra")}</span> : <span className={ui.chipWarn}>⚠ {t("catalogue.origin.custom")}</span>}
            {advanced && (entry?.version ?? m?.version) && <span>v{entry?.version ?? m?.version}</span>}
            {m?.author && <span>{t("catalogue.by", { author: m.author })}</span>}
            {m?.license && advanced && <span>· {m.license}</span>}
          </p>
          {advanced && custom && <p className="mt-1 break-all font-mono text-xs text-muted">{custom.url}{custom.ref || custom.subdir ? `#${custom.ref ?? ""}${custom.subdir ? `:${custom.subdir}` : ""}` : ""}</p>}
        </div>
      </header>
      {entry && <p className="max-w-2xl text-[17px] leading-7">{L(entry.description)}</p>}

      {kept.length > 0 && <Callout tone="info" role="status"><span data-testid="kept-note">🗂 {t("kept.detailsNote", { name, count: kept.length })}</span></Callout>}

      {failed && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">{t("catalogue.previewFailed")}</p>}

      {planView && <DependencyPlanBox view={planView} t={t} names={names} advanced={advanced} />}

      {m && (
        <section className={`${ui.card} space-y-3`}>
          <h2 className="text-lg font-semibold">{t("catalogue.asks.friendly")}</h2>
          {perms.length > 0 ? (
            <ul className="space-y-2 text-[15px]">
              {perms.map((p) => <li key={p} className="flex items-start gap-3"><span aria-hidden className="mt-0.5">✓</span><span>{t(`perm.${p}`)}</span></li>)}
            </ul>
          ) : <p className="text-sm text-muted">{t("catalogue.nothingSpecial")}</p>}
          {advanced && (
            <p className="border-t border-line pt-3 font-mono text-xs text-muted">
              {t("modules.permissions")}: {m.permissions.join(", ") || "—"}
              {(m.offers ?? []).length > 0 && <> · {t("modules.offers")}: {(m.offers ?? []).map((o) => `${o.service}${(o.version ?? 1) > 1 ? ` v${o.version}` : ""}`).join(", ")}</>}
              {(m.requires ?? []).length > 0 && <> · {t("modules.requires")}: {(m.requires ?? []).map((r) => `${r.service}${(r.min ?? 1) > 1 ? ` ≥ ${r.min}` : ""}`).join(", ")}</>}
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
            installed ? <a href={EXTENSIONS_HREF} className="text-sm font-medium text-accent hover:underline">{t("catalogue.installed")}</a>
              : !entry.compatible ? <p className="text-sm text-muted">{t("catalogue.incompatible")}</p>
              : entry.needsNewerCore ? <p className="text-sm text-muted">{t("modules.core.badge", { version: entry.needsNewerCore, current: getCoreVersion() })}</p>
              : (
                entry.origin === "extra" ? (
                  <>
                    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid="extra-warning">{t("catalogue.extraWarning")}</p>
                    <ActionForm action={installExtraAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install">
                      <input type="hidden" name="id" value={entry.id} />
                      <Checkbox name="trust" label={t("catalogue.trust")} required />
                    </ActionForm>
                  </>
                ) : embedded
                  ? <p className="text-sm text-muted">{t("catalogue.installNote")}</p>
                  : (
                    <div className="flex flex-wrap items-center gap-4">
                      <InstallButton id={entry.id} name={name} labels={installLabels} />
                      <p className="text-sm text-muted">{t("catalogue.installNote")}</p>
                    </div>
                  )
              )
          ) : custom ? (
            <>
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{t("catalogue.customWarning")}</p>
              <ActionForm action={installCustomAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install">
                <input type="hidden" name="repo" value={`${custom.url}${custom.ref || custom.subdir ? `#${custom.ref ?? ""}${custom.subdir ? `:${custom.subdir}` : ""}` : ""}`} />
                <Checkbox name="trust" label={t("catalogue.trust")} required />
              </ActionForm>
            </>
          ) : null}
        </section>
      )}
      {embedded && canInstall && entry && entry.origin !== "extra" && (
        <div className="pointer-events-none sticky bottom-0 -mx-4 -mb-8 flex justify-center bg-gradient-to-t from-surface via-surface/90 to-transparent px-4 pb-6 pt-8 sm:-mx-8 sm:px-8" data-testid="floating-install">
          <div className="pointer-events-auto"><InstallButton id={entry.id} name={name} labels={installLabels} /></div>
        </div>
      )}
    </Frame>
  );
}

/** Seule, la fiche garde son lien de retour ; dans la fenêtre, c'est la fenêtre qui se ferme. */
function Frame({ embedded, back, children }: { embedded: boolean; back: string; children: React.ReactNode }) {
  return embedded ? <div className="space-y-7">{children}</div> : <Shell back={back}>{children}</Shell>;
}

function Shell({ back, children }: { back: string; children: React.ReactNode }) {
  return (
    <div className="space-y-7">
      <a href={EXTENSIONS_ADD_HREF} className="inline-block text-sm text-muted hover:text-accent">← {back}</a>
      {children}
    </div>
  );
}
