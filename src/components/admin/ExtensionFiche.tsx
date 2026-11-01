import type { Translator } from "@/core/i18n/dictionary";
import type { AddItem, BarState } from "@/core/modules/ficheView";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { Callout } from "./Page";
import { ui } from "./ui";
import { AddsList, InstallBar, InstallBlockedButton, TechnicalDetails } from "./FicheParts";
import { PreviewGallery, type GalleryItem, type GalleryLabels } from "./PreviewGallery";
import { RetryButton } from "./RetryButton";

/** Seule, la fiche garde son lien de retour ; dans la fenêtre, c'est la fenêtre qui se ferme. */
export function FicheFrame({ embedded, back, children }: { embedded: boolean; back: string; children: React.ReactNode }) {
  return embedded ? <div className="space-y-7">{children}</div> : (
    <div className="space-y-7">
      <a href={EXTENSIONS_ADD_HREF} className="inline-block text-sm text-muted hover:text-accent">← {back}</a>
      {children}
    </div>
  );
}

export type FicheProps = {
  t: Translator;
  embedded: boolean;
  advanced: boolean;
  /** Catalogue officiel (vérifié), index supplémentaire ou dépôt personnel (non vérifiés). */
  origin: "official" | "extra" | "custom";
  name: string; icon: string;
  version?: string; author?: string; license?: string;
  /** Adresse du dépôt, montrée en mode avancé seulement. */
  source?: string;
  description?: string;
  /** Dépôt personnel sans module lisible. */
  noModule: boolean;
  /** Le dépôt n'a pas pu être lu. */
  failed: boolean;
  /** La lecture a pris trop de temps (au lieu d'échouer) : le message le dit, « Réessayer » relit la fiche. */
  timedOut?: boolean;
  /** Éléments gardés d'une désinstallation précédente qui reviendront avec le module. */
  keptCount: number;
  gallery: GalleryItem[]; galleryLabels: GalleryLabels;
  /** Galerie lue après la fiche (dépôt distant) : remplace `gallery`, avec son propre emplacement réservé. */
  gallerySlot?: React.ReactNode;
  adds: AddItem[];
  /** README déjà rendu (Markdown non fiable, sans HTML brut) ; null = pas de README. */
  readme: React.ReactNode;
  /** Le manifeste a pu être lu : autorisations et données sont connues. */
  hasManifest: boolean;
  /** Autorisations que la fiche sait dire en clair. */
  perms: string[];
  /** Ligne technique des autorisations et services, en mode avancé. */
  permsRaw?: React.ReactNode;
  privacy?: string;
  /** Ce que l'installation apportera aussi (DependencyPlanBox) ou rien. */
  plan: React.ReactNode;
  summary: string;
  /** Cœur demandé et cœur du site, quand le module en demande un plus récent. */
  needsNewerCore?: string; currentCore: string;
  incompatible: boolean;
  bar: BarState;
  /** Premier prérequis manquant, en toutes lettres (barre bloquée par « deps »). */
  firstProblem?: string;
  /** Le contrôle d'installation prêt à poser dans la barre (bouton, ou case à cocher et bouton pour un module non vérifié). */
  action: React.ReactNode;
  /** Page de l'extension installée (barre « installed »). */
  manageHref?: string;
};

/**
 * La fiche d'une extension, dans l'ordre voulu (règle R31) : 1. ce que fait le module (description, visuels, ce qu'il ajoute, présentation),
 * 2. les détails techniques repliés (autorisations, données, dépendances, version, source), 3. la barre d'installation collée en bas.
 * Pure mise en page : DetailsView lit les données, ce composant ne fait que les montrer (donc testable sans serveur).
 */
export function ExtensionFiche(p: FicheProps) {
  const { t, bar } = p;
  const originText = p.origin === "official" ? t("fiche.tech.source.official") : p.origin === "extra" ? t("catalogue.origin.extra") : t("catalogue.origin.custom");
  return (
    <div className="space-y-7">
      <header className="flex items-start gap-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent/10 text-4xl" aria-hidden>{p.icon}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{p.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {p.origin === "official" ? <span className={ui.chipOk}>✔ {t("catalogue.verified")}</span> : <span className={ui.chipWarn}>⚠ {t(p.origin === "extra" ? "catalogue.origin.extra" : "catalogue.origin.custom")}</span>}
            {p.advanced && p.version && <span>v{p.version}</span>}
            {p.author && <span>{t("catalogue.by", { author: p.author })}</span>}
            {p.license && p.advanced && <span>· {p.license}</span>}
          </p>
          {p.advanced && p.origin === "custom" && p.source && <p className="mt-1 break-all font-mono text-xs text-muted">{p.source}</p>}
        </div>
      </header>

      {/* 1. Ce que fait le module : sa description, puis des images, puis ce qu'il ajoute. */}
      {p.description && <p className="max-w-2xl text-[17px] leading-7">{p.description}</p>}

      {/* Dépôt personnel sans module lisible (par exemple la racine d'un dépôt qui en regroupe plusieurs) : on le dit, sans proposer d'installer. */}
      {p.noModule && <p role="alert" data-testid="no-module" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{t("modules.error.nomanifest")}</p>}
      {p.keptCount > 0 && <Callout tone="info" role="status"><span data-testid="kept-note">🗂 {t("kept.detailsNote", { name: p.name, count: p.keptCount })}</span></Callout>}
      {p.failed && (
        <div role="alert" data-testid="fiche-failed" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <p className="min-w-0 flex-1 basis-64">{t(p.timedOut ? "catalogue.previewSlow" : "catalogue.previewFailed")}</p>
          <RetryButton label={t("fiche.retry")} pendingLabel={t("fiche.retrying")} />
        </div>
      )}

      {p.gallerySlot ?? <PreviewGallery items={p.gallery} labels={p.galleryLabels} />}
      <AddsList items={p.adds} t={t} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("catalogue.presentation")}</h2>
        {p.readme ?? (!p.failed ? <p className="text-sm text-muted">{t("catalogue.noReadme")}</p> : null)}
      </section>

      {/* Avant d'installer : l'avertissement d'un module non vérifié reste dans la page (la case à cocher est dans la barre du bas). */}
      {bar.kind === "ready" && bar.confirm && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid={p.origin === "extra" ? "extra-warning" : "custom-warning"}>{p.origin === "extra" ? t("catalogue.extraWarning") : t("catalogue.customWarning")}</p>}
      {bar.kind === "ready" && !bar.confirm && <p className="text-sm text-muted">{t("catalogue.installNote")}</p>}

      {/* 2. Les détails techniques, en dessous et repliés. */}
      <TechnicalDetails summary={p.summary} open={bar.kind === "blocked" && bar.reason === "deps"} t={t}>
        {p.hasManifest && (
          <div className="space-y-2" data-testid="module-asks">
            <h3 className="font-semibold">{t("catalogue.asks.friendly")}</h3>
            {p.perms.length > 0 ? (
              <ul className="space-y-2 text-[15px]">
                {p.perms.map((k) => <li key={k} className="flex items-start gap-3"><span aria-hidden className="mt-0.5">✓</span><span>{t(`perm.${k}`)}</span></li>)}
              </ul>
            ) : <p className="text-sm text-muted">{t("catalogue.nothingSpecial")}</p>}
            {p.advanced && p.permsRaw}
          </div>
        )}
        {p.hasManifest && (
          <div className="space-y-2" data-testid="module-privacy">
            <h3 className="font-semibold">{t("catalogue.privacy.title")}</h3>
            <p className={p.privacy ? "text-[15px]" : "text-sm text-muted"}>{p.privacy ?? t("fiche.tech.noPrivacy")}</p>
          </div>
        )}
        {p.plan}
        <div className="space-y-2">
          <h3 className="font-semibold">{t("fiche.tech.versionTitle")}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {p.version && <><dt className="text-muted">{t("fiche.tech.version")}</dt><dd>{p.version}</dd></>}
            {p.author && <><dt className="text-muted">{t("fiche.tech.author")}</dt><dd>{p.author}</dd></>}
            {p.license && <><dt className="text-muted">{t("fiche.tech.license")}</dt><dd>{p.license}</dd></>}
            <dt className="text-muted">{t("fiche.tech.compatible")}</dt>
            <dd>{p.incompatible ? t("catalogue.incompatible") : p.needsNewerCore ? t("modules.core.badge", { version: p.needsNewerCore, current: p.currentCore }) : "✓"}</dd>
          </dl>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">{t("fiche.tech.sourceTitle")}</h3>
          <p className="text-sm">{originText}</p>
          {p.advanced && p.source && <p className="break-all font-mono text-xs text-muted">{p.source}</p>}
        </div>
      </TechnicalDetails>

      {/* 3. La barre d'installation, collée en bas : l'état, la raison s'il manque quelque chose, et le seul bouton principal. */}
      {bar.kind !== "hidden" && (
        <InstallBar label={t("fiche.bar.label")} embedded={p.embedded}
          status={(() => {
            if (bar.kind === "installed") return <span className="font-medium">✓ {t("catalogue.installed")}</span>;
            if (bar.kind === "ready") return <>{p.version ? t("fiche.bar.readyVersion", { version: p.version }) : t("fiche.bar.ready")}</>;
            if (bar.reason === "read") return t("fiche.bar.blockedRead");
            if (bar.reason === "incompatible") return t("catalogue.incompatible");
            if (bar.reason === "core") return <>{t("modules.core.badge", { version: p.needsNewerCore ?? "", current: p.currentCore })} <a href="/admin/updates" className="whitespace-nowrap font-medium text-accent underline">{t("fiche.bar.updateCore")}</a></>;
            return <>{t("fiche.bar.blockedDeps")} {p.firstProblem} <a href="#details-techniques" className="whitespace-nowrap font-medium text-accent underline">{t("fiche.bar.seeDetails")}</a></>;
          })()}>
          {bar.kind === "installed" && p.manageHref && <a href={p.manageHref} className="inline-flex min-h-12 min-w-48 items-center justify-center rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg shadow-lg">{t("fiche.bar.manage")}</a>}
          {bar.kind === "blocked" && <InstallBlockedButton label={t("catalogue.install")} />}
          {bar.kind === "ready" && p.action}
        </InstallBar>
      )}
    </div>
  );
}
