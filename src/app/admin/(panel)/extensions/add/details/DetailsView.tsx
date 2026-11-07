import { Suspense } from "react";
import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can as canDo } from "@/core/auth/access";
import { findCatalogueEntry } from "@/core/modules/catalogue";
import { getCoreVersion } from "@/core/modules/compat";
import { parseRepoUrl } from "@/core/modules/installer";
import { getModulePreview, getPreviewImages, PREVIEW_WAIT_MS, PreviewFailure, PreviewTimeout, targetOf, type ModulePreview, type PreviewTarget } from "@/core/modules/readme";
import { listModuleRows } from "@/core/modules/registry";
import { listRetired } from "@/core/modules/retired";
import { localized } from "@/core/modules/types";
import { buildNames, viewPlan } from "@/core/modules/dependencyView";
import { normalizeNeeds } from "@/core/modules/serviceVersions";
import { DependencyPlanBox } from "@/components/admin/DependencyPlanBox";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox } from "@/components/admin/Field";
import { Markdown } from "@/components/site/Markdown";
import { InstallButton } from "@/components/admin/InstallButton";
import { installCustomAction, installExtraAction } from "../actions";
import { galleryLabels } from "@/components/admin/FicheParts";
import { ExtensionFiche, FicheFrame } from "@/components/admin/ExtensionFiche";
import { PreviewGallery, type GalleryItem } from "@/components/admin/PreviewGallery";
import { FicheSkeleton, GallerySkeleton } from "@/components/admin/FicheSkeleton";
import { installBarState, readmeSummary, techSummary, whatItAdds } from "@/core/modules/ficheView";
import { previewUrl, readInstalledPreviews, type PreviewSource } from "@/core/modules/previewServe";
import { describeMissing } from "@/core/modules/dependencyMessages";
import { moduleHref } from "@/core/adminLinks";

/**
 * Avant d'installer : le README du module et ce qu'il demande (permissions, services), lus sans l'installer.
 * `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié).
 */
/** Le contenu d'une fiche de module : seul ou dans la fenêtre par-dessus le catalogue (`embedded`, avec le bouton d'installation flottant en bas). */
export async function DetailsView({ id, repo, embedded = false }: { id?: string; repo?: string; embedded?: boolean }) {
  const { t, locale, config } = await adminCtx("admin");
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  let target: PreviewTarget | null = null;
  let entry: Awaited<ReturnType<typeof findCatalogueEntry>> | undefined;
  let custom: { url: string; ref?: string; subdir?: string } | null = null;
  if (id) {
    // L'index du catalogue : une copie déjà reçue suffit (jamais d'attente du réseau pour ouvrir une fiche), elle est relue en coulisse.
    entry = await findCatalogueEntry(id, { staleOk: true });
    if (!entry) notFound();
    target = targetOf(entry);
  } else if (repo) {
    const parsed = parseRepoUrl(repo);
    if (parsed.ok) { custom = parsed.repo; target = { kind: "repo", url: parsed.repo.url, ref: parsed.repo.ref, subdir: parsed.repo.subdir }; }
    else return <FicheFrame embedded={embedded} back={t("catalogue.back")}><p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t(parsed.error)}</p></FicheFrame>;
  } else notFound();

  // Tout ce qui est connu sans lire le dépôt (nom, icône, description) s'affiche TOUT DE SUITE ; la lecture du dépôt (README, autorisations) arrive ensuite, dans la page.
  return (
    <Suspense fallback={<FicheSkeleton text={t("fiche.loading")} slowText={t("fiche.slow")} embedded={embedded} back={t("catalogue.back")} name={entry ? L(entry.name) : custom?.url ?? ""} icon={entry?.icon ?? "🧩"} description={entry ? L(entry.description) : undefined} />}>
      <FicheBody embedded={embedded} entry={entry} custom={custom} target={target} />
    </Suspense>
  );
}

type Entry = Awaited<ReturnType<typeof findCatalogueEntry>>;
async function FicheBody({ embedded, entry, custom, target }: { embedded: boolean; entry: Entry; custom: { url: string; ref?: string; subdir?: string } | null; target: PreviewTarget | null }) {
  const { t, locale, config, user, advanced } = await adminCtx("admin");
  const isOwner = canDo(user, "core:modules.install"); // peut installer des extensions
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  let preview: ModulePreview | null = null;
  let failed = false;
  let timedOut = false;
  let rateLimited = false;
  // Attente bornée : au-delà, un message clair et « Réessayer » (la lecture continue en coulisse, la tentative suivante en profite).
  if (target) { try { preview = await getModulePreview(target, { waitMs: PREVIEW_WAIT_MS }); } catch (e) { console.error("[catalogue] preview failed:", (e as Error)?.message); failed = true; timedOut = e instanceof PreviewTimeout; rateLimited = e instanceof PreviewFailure && e.reason === "rate-limit"; } }

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
  // Les visuels d'un dépôt distant ne retardent JAMAIS la fiche : la galerie arrive après (emplacement réservé), lue en parallèle.
  const installedImages = installed && entry ? await readInstalledPreviews(entry.id) : null;
  const source: PreviewSource = installed && entry ? { installed: entry.id } : entry ? { id: entry.id } : { repo: repoSpec };
  const version = entry?.version ?? m?.version;
  const toItems = (list: Awaited<ReturnType<typeof getPreviewImages>>): GalleryItem[] => list.map((i) => ({ src: previewUrl(source, i.index, version), width: i.width, height: i.height, caption: L(i.decl.caption), alt: L(i.decl.alt), typeLabel: t(`fiche.gallery.type.${i.decl.type}`) }));
  const declared = m?.previews?.length ?? 0;
  const gallery: GalleryItem[] = installedImages ? toItems(installedImages) : [];
  const remoteGallery = !installedImages && target && declared > 0 ? <Suspense fallback={<GallerySkeleton label={t("fiche.gallery.loading")} count={declared} />}><RemoteGallery target={target} toItems={toItems} labels={galleryLabels(t)} /></Suspense> : null;

  // Résumé d'une ligne des détails techniques : « Garde des données de votre public · Demande 3 autorisations · Installe aussi Contacts ».
  const alsoInstalls = (planView?.lines ?? []).filter((l) => l.action === "install").map((l) => l.name);
  const origin = entry ? (entry.origin === "extra" ? "extra" : "official") : "custom";
  const summary = m
    ? (() => { const s = techSummary(m, perms); return [t(`fiche.tech.keeps.${s.keeps}`), s.asks === 0 ? t("fiche.tech.asks.none") : t("fiche.tech.asks", { n: s.asks }), alsoInstalls.length ? t("fiche.tech.alsoInstalls", { names: alsoInstalls.join(", ") }) : ""].filter(Boolean).join(" · "); })()
    : origin === "official" ? t("fiche.tech.source.official") : t(origin === "extra" ? "catalogue.origin.extra" : "catalogue.origin.custom");

  // Le contrôle d'installation : un bouton pour le catalogue officiel ; une case à cocher et un bouton pour un module non vérifié (index supplémentaire ou dépôt personnel).
  const formClass = "flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:flex-col max-sm:items-stretch [&_button]:min-h-11 max-sm:[&_button]:w-full";
  const action = bar.kind !== "ready" ? null : entry && !bar.confirm ? <InstallButton id={entry.id} name={name} labels={installLabels} /> : entry ? (
    <ActionForm action={installExtraAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install" className={formClass}>
      <input type="hidden" name="id" value={entry.id} />
      <Checkbox name="trust" label={t("catalogue.trust")} required />
    </ActionForm>
  ) : (
    <ActionForm action={installCustomAction} submitLabel={t("catalogue.install")} pendingLabel={t("catalogue.installing")} track="install" className={formClass}>
      <input type="hidden" name="repo" value={repoSpec} />
      <Checkbox name="trust" label={t("catalogue.trust")} required />
    </ActionForm>
  );
  const firstProblem = planView?.problems[0];

  return (
    <ExtensionFiche t={t} embedded={embedded} advanced={advanced} origin={origin} name={name} icon={icon}
      version={version} author={m?.author} license={m?.license} source={entry?.repo ? `${entry.repo}${entry.ref ? `#${entry.ref}` : ""}` : repoSpec || undefined}
      description={entry ? L(entry.description) : m?.description ? L(m.description) : undefined}
      noModule={!!custom && !failed && !m} failed={failed} timedOut={timedOut} rateLimited={rateLimited} keptCount={kept.length}
      gallery={gallery} gallerySlot={remoteGallery} galleryLabels={galleryLabels(t)} adds={m ? whatItAdds(m, L) : []}
      readmeSummary={preview?.readme ? readmeSummary(preview.readme, entry ? L(entry.description) : m?.description ? L(m.description) : "") : undefined}
      readme={preview?.readme ? (
        <article className="overflow-x-auto text-[16px] [&_h2:first-child]:mt-0 [&>div>*:first-child]:mt-0">
          <Markdown text={preview.readme} untrusted />
          {preview.truncated && <p className="mt-6 text-xs text-muted">{t("catalogue.truncated")}</p>}
        </article>
      ) : null}
      hasManifest={!!m} perms={perms} privacy={m?.privacy ? L(m.privacy) : undefined}
      permsRaw={m && (
        <p className="border-t border-line pt-3 font-mono text-xs text-muted">
          {t("modules.permissions")}: {m.permissions.join(", ") || "—"}
          {(m.offers ?? []).length > 0 && <> · {t("modules.offers")}: {(m.offers ?? []).map((o) => `${o.service}${(o.version ?? 1) > 1 ? ` v${o.version}` : ""}`).join(", ")}</>}
          {(m.requires ?? []).length > 0 && <> · {t("modules.requires")}: {(m.requires ?? []).map((r) => `${r.service}${(r.min ?? 1) > 1 ? ` ≥ ${r.min}` : ""}`).join(", ")}</>}
        </p>
      )}
      plan={planView ? <DependencyPlanBox view={planView} t={t} names={names} advanced={advanced} /> : null}
      summary={summary} needsNewerCore={entry?.needsNewerCore} currentCore={getCoreVersion()} incompatible={!!entry && !entry.compatible}
      bar={bar} firstProblem={firstProblem ? describeMissing(firstProblem, t, names) : undefined} action={action}
      manageHref={entry ? moduleHref(entry.id) : undefined} />
  );
}


/** La galerie d'un dépôt distant : lue après la fiche (et en parallèle), sans jamais la retarder. Sans image valable : rien (pas de trou). */
async function RemoteGallery({ target, toItems, labels }: { target: PreviewTarget; toItems: (l: Awaited<ReturnType<typeof getPreviewImages>>) => GalleryItem[]; labels: ReturnType<typeof galleryLabels> }) {
  const items = toItems(await getPreviewImages(target));
  return items.length ? <PreviewGallery items={items} labels={labels} /> : null;
}
