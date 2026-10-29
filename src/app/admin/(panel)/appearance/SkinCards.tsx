"use client";

import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import type { SkinCardModel, Swatch } from "@/core/skins/appearanceView";
import { useAL } from "./AppearanceLabels";
import { PreviewButton, type PreviewPage } from "./PreviewDialog";
import { chooseSkinAction } from "./actions";

type Loc = "fr" | "en";

/** Vignette de secours quand un skin n'a pas d'image d'aperçu : ses couleurs, un mode par moitié. */
export function SwatchTile({ swatches }: { swatches: Partial<Record<"light" | "dark", Swatch>> }) {
  const list = (["light", "dark"] as const).flatMap((m) => (swatches[m] ? [swatches[m]!] : []));
  return (
    <div className="flex h-28 w-full overflow-hidden rounded-xl border border-line" aria-hidden="true">
      {list.map((s, i) => (
        <div key={i} className="relative flex-1" style={{ background: s.background }}>
          <div className="absolute inset-x-2 top-3 rounded-md p-2" style={{ background: s.surface }}>
            <div className="h-1.5 w-10 rounded" style={{ background: s.accent }} />
            <div className="mt-1.5 h-1 w-14 rounded opacity-70" style={{ background: s.text }} />
            <div className="mt-1 h-1 w-9 rounded opacity-40" style={{ background: s.text }} />
          </div>
          <div className="absolute bottom-2 right-2 h-4 w-4 rounded-full" style={{ background: s.accent2 }} />
        </div>
      ))}
    </div>
  );
}

function ModePills({ modes }: { modes: ("light" | "dark")[] }) {
  const al = useAL();
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={al("appearance.modes")}>
      {modes.includes("light") && <li className={ui.chip}>{al("appearance.mode.light")}</li>}
      {modes.includes("dark") && <li className={ui.chip}>{al("appearance.mode.dark")}</li>}
    </ul>
  );
}

/** « Choisir un skin » : une grille de cartes (une colonne sur téléphone) avec aperçu, nom, une phrase, clair / sombre, auteur, licence. */
export function SkinCards({ cards, locale, pages, canChoose }: { cards: SkinCardModel[]; locale: Loc; pages: PreviewPage[]; canChoose: boolean }) {
  const al = useAL();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="skin-cards">
      {cards.map((c) => {
        const name = c.name[locale];
        const shot = c.previews[0];
        const usable = c.status === "ok";
        return (
          <li key={c.id} data-skin-card={c.id} aria-current={c.active ? "true" : undefined}
            className={`${ui.card} flex flex-col gap-3 !p-4 ${c.active ? "border-accent ring-2 ring-accent" : ""}`}>
            {shot
              // eslint-disable-next-line @next/next/no-img-element -- aperçu servi par l'administration (route réservée), pas une image du site
              ? <img src={`/api/admin/skins/preview/${c.id}/${c.version}/${shot.file.replace(/^previews\//, "")}`} alt={shot.alt[locale]} loading="lazy" className="h-28 w-full rounded-xl border border-line bg-bg object-cover object-top" />
              : <SwatchTile swatches={c.swatches} />}
            <div className="min-w-0 flex-1 space-y-1.5">
              <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                {name}
                {c.active && <span className={ui.chipOk}>{al("appearance.current")}</span>}
                {c.source === "basic" && <span className={ui.chip}>{al("appearance.base")}</span>}
              </h3>
              <p className="text-sm text-muted">{c.description[locale]}</p>
              <ModePills modes={c.modes} />
              <p className="text-[13px] text-muted">
                {c.source === "basic" ? al("appearance.byCuriosa") : c.author ? al("appearance.by", { author: c.author }) : ""}
                {c.license ? ` · ${al("appearance.license", { license: c.license })}` : ""}
                {c.source === "personal" ? ` · ${al("appearance.personalTag")}` : ""}
              </p>
              {!usable && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-[13px]">{al(`appearance.status.${c.status}`)}</p>}
            </div>
            {usable && (
              <div className="flex flex-wrap items-center gap-2">
                <PreviewButton skinId={c.id} skinName={name} bothModes={c.modes.length === 2} pages={pages} canChoose={canChoose} active={c.active} />
                {!c.active && canChoose && (
                  <ActionForm action={chooseSkinAction} submitLabel={al("appearance.use")} pendingLabel={al("appearance.using")} className="contents">
                    <input type="hidden" name="id" value={c.id} />
                  </ActionForm>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
