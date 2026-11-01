import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { ui } from "./ui";

const BLOCK = "animate-pulse rounded-xl bg-line/60 motion-reduce:animate-none";

/**
 * La fiche pendant que le site lit le dépôt de l'extension : ce qui est déjà connu (nom, icône, description) est là, le reste est un emplacement qui occupe sa place
 * (pas de saut de mise en page) avec une phrase pour le lecteur d'écran. Elle s'affiche dès le clic (R23). Sans accès au serveur ni à la base : le texte et le lien de retour
 * viennent de l'appelant, pour que `loading.tsx` ne puisse rien attendre.
 */
export function FicheSkeleton({ text, embedded, back, name, icon, description }: { text: string; embedded: boolean; back: string; name?: string; icon?: string; description?: string }) {
  return (
    <div className="space-y-7">
      {!embedded && <a href={EXTENSIONS_ADD_HREF} className="inline-block text-sm text-muted hover:text-accent">← {back}</a>}
      <div data-testid="fiche-loading" role="status" aria-busy="true" className="space-y-7">
        <header className="flex items-start gap-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-accent/10 text-4xl" aria-hidden>{icon ?? "🧩"}</span>
          <div className="min-w-0">{name ? <h1 className={ui.pageTitle}>{name}</h1> : <div aria-hidden className={`${BLOCK} mt-2 h-7 w-48`} />}</div>
        </header>
        {description && <p className="max-w-2xl text-[17px] leading-7">{description}</p>}
        <p className="text-sm text-muted">{text}</p>
        <div aria-hidden className="space-y-3"><div className={`${BLOCK} h-40`} /><div className={`${BLOCK} h-5 w-2/3`} /><div className={`${BLOCK} h-5 w-1/2`} /></div>
      </div>
    </div>
  );
}

/** Emplacement des visuels pendant leur lecture : autant de cases que le module en annonce (deux au plus). */
export function GallerySkeleton({ label, count }: { label: string; count: number }) {
  return (
    <div role="status" aria-busy="true" data-testid="gallery-loading" className="space-y-2">
      <p className="text-sm text-muted">{label}</p>
      <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2">{Array.from({ length: Math.min(count, 2) }, (_, i) => <div key={i} className={`${BLOCK} aspect-[16/10]`} />)}</div>
    </div>
  );
}
