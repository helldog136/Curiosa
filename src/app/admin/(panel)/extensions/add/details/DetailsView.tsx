import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can as canDo } from "@/core/auth/access";
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
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { installCustomAction, installExtraAction } from "../actions";
import { AddsList, InstallBar, InstallBlockedButton, TechnicalDetails } from "@/components/admin/FicheParts";
import { PreviewGallery, type GalleryItem, type GalleryLabels } from "@/components/admin/PreviewGallery";
import { installBarState, techSummary, whatItAdds } from "@/core/modules/ficheView";
import { previewUrl, readInstalledPreviews, type PreviewSource } from "@/core/modules/previewServe";
import { describeMissing } from "@/core/modules/dependencyMessages";

/**
 * Avant d'installer : le README du module et ce qu'il demande (permissions, services), lus sans l'installer.
 * `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié).
 */
/** Le contenu d'une fiche de module : seul ou dans la fenêtre par-dessus le catalogue (`embedded`, avec le bouton d'installation flottant en bas). */
export async function DetailsView({ id, repo, embedded = false }: { id?: string; repo?: string; embedded?: boolean }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const isOwner = canDo(user, "core:modules.install"); // peut installer des extensions
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
  const bar = installBarState({ canInstall: isOwner, hasModule: !!(entry || m), failed, installed, entry: entry ? { compatible: entry.compatible, needsNewerCore: entry.needsNewerCore, origin: entry.origin } : undefined, problems: planView?.problems.length ?? 0 });
  const repoSpec = custom ? `${custom.url}${custom.ref || custom.subdir ? `#${custom.ref ?? ""}${custom.subdir ? `:${custom.subdir}` : ""}` : ""}` : "";

  // Les visuels : d'un module déjà installé, ceux de son dossier ; sinon ceux que le cœur a lus dans son dépôt. Servis par le site lui-même (previewServe.ts), jamais chargés depuis un site tiers.
  const images = installed && entry ? await readInstalledPreviews(entry.id) : preview?.images ?? [];
  const source: PreviewSource = installed && entry ? { installed: entry.id } : entry ? { id: entry.id } : { repo: repoSpec };
  const galleryItems: GalleryItem[] = images.map((i) => ({ src: previewUrl(source, i.index, entry?.version ?? m?.version), width: i.width, height: i.height, caption: L(i.decl.caption), alt: L(i.decl.alt), typeLabel: t(`fiche.gallery.type.${i.decl.type}`) }));
  const galleryLabels: GalleryLabels = { title: t("fiche.gallery.title"), open: t("fiche.gallery.open"), close: t("fiche.gallery.close"), prev: t("fiche.gallery.prev"), next: t("fiche.gallery.next"), count: t("fiche.gallery.count"), sample: t("fiche.gallery.sample") };
  const adds = m ? whatItAdds(m, L) : [];

  // Résumé d'une ligne des détails techniques : « Garde des données de votre public · Demande 3 autorisations · Installe aussi Contacts ».
  const alsoInstalls = (planView?.lines ?? []).filter((l) => l.action === "install").map((l) => l.name);
  const summary = m
    ? (() => { const s = techSummary(m, perms); return [t(`fiche.tech.keeps.${s.keeps}`), s.asks === 0 ? t("fiche.tech.asks.none") : t("fiche.tech.asks", { n: s.asks }), alsoInstalls.length ? t("fiche.tech.alsoInstalls", { names: alsoInstalls.join(", ") }) : ""].filter(Boolean).join(" · "); })()
    : entry ? (entry.origin === "extra" ? t("catalogue.origin.extra") : t("fiche.tech.source.official")) : t("catalogue.origin.custom");
  const version = entry?.version ?? m?.version;
  const coreNeeded = entry?.requires?.core ?? m?.minCore;

  return (
    <Frame embedded={embedded} back={t("catalogue.back")}>
      <header className="flex items-start gap-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent/10 text-4xl" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {entry && entry.origin !== "extra" ? <span className={ui.chipOk}>✔ {t("catalogue.verified")}</span> : entry ? <span className={ui.chipWarn}>⚠ {t("catalogue.origin.extra")}</span> : <span className={ui.chipWarn}>⚠ {t("catalogue.origin.custom")}</span>}
            {advanced && version && <span>v{version}</span>}
            {m?.author && <span>{t("catalogue.by", { author: m.author })}</span>}
            {m?.license && advanced && <span>· {m.license}</span>}
          </p>
          {advanced && custom && <p className="mt-1 break-all font-mono text-xs text-muted">{repoSpec}</p>}
        </div>
      </header>

      {/* 1. Ce que fait le module : sa description, puis des images, puis ce qu'il ajoute. */}
      {entry ? <p className="max-w-2xl text-[17px] leading-7">{L(entry.description)}</p> : m?.description ? <p className="max-w-2xl text-[17px] leading-7">{L(m.description)}</p> : null}

      {/* Dépôt personnel sans module lisible (par exemple la racine d'un dépôt qui en regroupe plusieurs) : on le dit, sans proposer d'installer. */}
      {custom && !failed && !m && <p role="alert" data-testid="no-module" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{t("modules.error.nomanifest")}</p>}
      {kept.length > 0 && <Callout tone="info" role="status"><span data-testid="kept-note">🗂 {t("kept.detailsNote", { name, count: kept.length })}</span></Callout>}
      {failed && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">{t("catalogue.previewFailed")}</p>}

      <PreviewGallery items={galleryItems} labels={galleryLabels} />
      <AddsList items={adds} t={t} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("catalogue.presentation")}</h2>
        {preview?.readme ? (
          <article className={`${ui.card} overflow-x-auto !p-6 text-[16px] sm:!p-8 [&_h2:first-child]:mt-0 [&>div>*:first-child]:mt-0`}>
            <Markdown text={preview.readme} untrusted />
            {preview.truncated && <p className="mt-6 text-xs text-muted">{t("catalogue.truncated")}</p>}
          </article>
        ) : !failed ? <p className="text-sm text-muted">{t("catalogue.noReadme")}</p> : null}
      </section>

      {/* Avant d'installer : l'avertissement d'un module non vérifié reste dans la page (la case à cocher est dans la barre du bas). */}
      {bar.kind === "ready" && bar.confirm && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid={entry ? "extra-warning" : undefined}>{entry ? t("catalogue.extraWarning") : t("catalogue.customWarning")}</p>}
      {bar.kind === "ready" && !bar.confirm && <p className="text-sm text-muted">{t("catalogue.installNote")}</p>}

      {/* 2. Les détails techniques, en dessous et repliés. */}
      <TechnicalDetails summary={summary} open={bar.kind === "blocked" && bar.reason === "deps"} t={t}>
        {m && (
          <div className="space-y-2" data-testid="module-asks">
            <h3 className="font-semibold">{t("catalogue.asks.friendly")}</h3>
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
          </div>
        )}
        {m && (
          <div className="space-y-2" data-testid="module-privacy">
            <h3 className="font-semibold">{t("catalogue.privacy.title")}</h3>
            <p className={m.privacy ? "text-[15px]" : "text-sm text-muted"}>{m.privacy ? L(m.privacy) : t("fiche.tech.noPrivacy")}</p>
          </div>
        )}
        {planView && <DependencyPlanBox view={planView} t={t} names={names} advanced={advanced} />}
        <div className="space-y-2">
          <h3 className="font-semibold">{t("fiche.tech.versionTitle")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {version && <><dt className="text-muted">{t("fiche.tech.version")}</dt><dd>{version}</dd></>}
            {m?.author && <><dt className="text-muted">{t("fiche.tech.author")}</dt><dd>{m.author}</dd></>}
            {m?.license && <><dt className="text-muted">{t("fiche.tech.license")}</dt><dd>{m.license}</dd></>}
            <dt className="text-muted">{t("fiche.tech.compatible")}</dt>
            <dd>{entry && !entry.compatible ? t("catalogue.incompatible") : coreNeeded && entry?.needsNewerCore ? t("modules.core.badge", { version: coreNeeded, current: getCoreVersion() }) : "✓"}</dd>
          </dl>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">{t("fiche.tech.sourceTitle")}</h3>
          <p className="text-sm">{entry ? (entry.origin === "extra" ? t("catalogue.origin.extra") : t("fiche.tech.source.official")) : t("catalogue.origin.custom")}</p>
          {advanced && (entry?.repo || custom) && <p className="break-all font-mono text-xs text-muted">{entry?.repo ?? repoSpec}{entry?.ref ? `#${entry.ref}` : ""}</p>}
        </div>
      </TechnicalDetails>

      {/* 3. La barre d'installation, collée en bas : l'état, la raison s'il manque quelque chose, et le seul bouton principal. */}
      {bar.kind !== "hidden" && (
        <InstallBar label={t("fiche.bar.label")} embedded={embedded}
          status={(() => {
            if (bar.kind === "installed") return <span className="font-medium">✓ {t("catalogue.installed")}</span>;
            if (bar.kind === "ready") return <>{version ? t("fiche.bar.readyVersion", { version }) : t("fiche.bar.ready")}{bar.confirm && <span className="mt-0.5 block text-muted">{t("fiche.bar.unverified")}</span>}</>;
            if (bar.reason === "read") return t("fiche.bar.blockedRead");
            if (bar.reason === "incompatible") return t("catalogue.incompatible");
            if (bar.reason === "core") return <>{t("modules.core.badge", { version: entry?.needsNewerCore ?? "", current: getCoreVersion() })} <a href="/admin/updates" className="whitespace-nowrap font-medium text-accent underline">{t("fiche.bar.updateCore")}</a></>;
            const first = planView?.problems[0];
            return <>{t("fiche.bar.blockedDeps")} {first ? describeMissing(first, t, names) : null} <a href="#details-techniques" className="whitespace-nowrap font-medium text-accent underline">{t("fiche.bar.seeDetails")}</a></>;
          })()}>
          {bar.kind === "installed" && entry && <a href={`/admin/modules/${encodeURIComponent(entry.id)}`} className="inline-flex min-h-12 min-w-48 items-center justify-center rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg shadow-lg">{t("fiche.bar.manage")}</a>}
          {bar.kind === "blocked" && <InstallBlockedButton label={t("catalogue.install")} />}
          {bar.kind === "ready" && entry && !bar.confirm && <InstallButton id={entry.id} name={name} labels={installLabels} />}
          {bar.kind === "ready" && entry && bar.confirm && (
            <ActionForm action={installExtraAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install" className="flex flex-wrap items-center gap-x-4 gap-y-2 [&_button]:min-h-11">
              <input type="hidden" name="id" value={entry.id} />
              <Checkbox name="trust" label={t("catalogue.trust")} required />
            </ActionForm>
          )}
          {bar.kind === "ready" && !entry && custom && (
            <ActionForm action={installCustomAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install" className="flex flex-wrap items-center gap-x-4 gap-y-2 [&_button]:min-h-11">
              <input type="hidden" name="repo" value={repoSpec} />
              <Checkbox name="trust" label={t("catalogue.trust")} required />
            </ActionForm>
          )}
        </InstallBar>
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
