import type { Translator } from "@/core/i18n/dictionary";
import type { AddItem } from "@/core/modules/ficheView";
import type { GalleryLabels } from "./PreviewGallery";
import { ui } from "./ui";

/**
 * Pièces de la fiche d'une extension (page entière et fenêtre du catalogue). Serveur seulement : aucun script, sauf le bouton d'installation (InstallButton) placé dedans.
 */

/** « Ce que ce module ajoute » : une ligne par chose ajoutée (page, réglages, éléments d'overlay, outils pour l'assistant IA). Rien à dire : rien d'affiché. */
export function AddsList({ items, t }: { items: AddItem[]; t: Translator }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="adds-title" data-testid="module-adds" className={`${ui.card} space-y-3`}>
      <h2 id="adds-title" className="text-lg font-semibold">{t("fiche.adds.title")}</h2>
      <ul className="space-y-2 text-[15px]">
        {items.map((a) => (
          <li key={a.kind} className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5">{a.icon}</span>
            <span>{t(`fiche.adds.${a.kind}`, { n: a.n ?? 0, names: a.names ?? "" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Les détails techniques, repliés : un titre, une ligne de résumé (« Garde des données de votre public · Demande 3 autorisations »), puis tout le détail.
 * Ouverts d'office quand quelque chose bloque l'installation (le lien « Voir le détail » de la barre y arrive).
 */
export function TechnicalDetails({ summary, open, t, children }: { summary: string; open: boolean; t: Translator; children: React.ReactNode }) {
  return (
    <details id="details-techniques" open={open} data-testid="technical-details" className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-5 py-3 marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">▸</span>
        <span className="text-lg font-semibold">{t("fiche.tech.title")}</span>
        <span className="min-w-0 basis-full text-sm text-muted sm:basis-auto sm:flex-1" data-testid="technical-summary">{summary}</span>
      </summary>
      <div className="space-y-5 border-t border-line px-5 py-5">{children}</div>
    </details>
  );
}

/**
 * La présentation (le texte de l'auteur) : repliée en mode simple sous « Lire la présentation complète », avec une phrase de résumé qui reste visible ; ouverte d'office
 * en mode avancé. Un `<details>` natif : aucun script, le texte n'est de toute façon rendu qu'en Markdown sans HTML brut (voir Markdown `untrusted`).
 */
export function ReadmeFold({ summary, open, t, children }: { summary?: string; open: boolean; t: Translator; children: React.ReactNode }) {
  return (
    <section className="space-y-3" data-testid="fiche-presentation">
      <h2 className="text-lg font-semibold">{t("catalogue.presentation")}</h2>
      {!open && summary && <p data-testid="readme-summary" className="max-w-2xl text-[16px] leading-7">{summary}</p>}
      <details open={open} data-testid="readme-fold" className="group rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-5 py-3 marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-muted transition-transform group-open:rotate-90">▸</span>
          <span className="font-semibold">{t("fiche.readme.open")}</span>
          <span className="min-w-0 basis-full text-sm text-muted sm:basis-auto">{t("fiche.readme.hint")}</span>
        </summary>
        <div className="border-t border-line px-5 py-5 sm:px-8">{children}</div>
      </details>
    </section>
  );
}

/**
 * La barre d'installation : collée en bas de la fenêtre, donc visible sans défiler. Elle dit l'état (version et « installation possible », ou la raison qui bloque, avec un lien),
 * et porte le bouton principal, unique. Dans le flux de la page (pas en superposition permanente) : elle ne cache jamais la fin du contenu. `embedded` : dans la fenêtre du catalogue.
 */
export function InstallBar({ label, embedded, status, children }: { label: string; embedded: boolean; status: React.ReactNode; children: React.ReactNode }) {
  // Dans la fenêtre, la zone qui défile a 2 rem de marge basse (`pb-8`) : un élément collant s'arrêterait au-dessus d'elle. `-bottom-8` le pose sur le vrai bord bas.
  const bleed = embedded ? "-bottom-8 -mx-4 -mb-8 sm:-mx-8" : "bottom-0 -mx-6 -mb-6 md:-mx-10 md:-mb-10";
  return (
    <div role="region" aria-label={label} data-testid="install-bar"
      className={`sticky z-20 ${bleed} border-t border-line bg-surface px-4 pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,.25)] [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:px-8`}>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div id="install-status" role="status" className="min-w-0 flex-1 basis-56 text-sm leading-5" data-testid="install-status">{status}</div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 max-sm:w-full [&>*]:max-sm:w-full">{children}</div>
      </div>
    </div>
  );
}

/** Le bouton d'installation quand elle est impossible : inactif, avec la raison reliée (lue par les lecteurs d'écran), même forme que le vrai bouton. */
export function InstallBlockedButton({ label }: { label: string }) {
  return (
    <button type="button" disabled aria-disabled="true" aria-describedby="install-status" data-testid="install-blocked"
      className="inline-flex min-h-12 min-w-48 cursor-not-allowed items-center justify-center rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg opacity-50">
      {label}
    </button>
  );
}

/** Les textes de la galerie (client) : traduits ici, sur le serveur, puis passés tels quels. `{n}`, `{total}` et `{caption}` sont remplis par la galerie. */
export function galleryLabels(t: Translator): GalleryLabels {
  return { title: t("fiche.gallery.title"), open: t("fiche.gallery.open"), close: t("fiche.gallery.close"), prev: t("fiche.gallery.prev"), next: t("fiche.gallery.next"), count: t("fiche.gallery.count"), sample: t("fiche.gallery.sample") };
}
