import type { Translator } from "@/core/i18n/dictionary";
import { ConfirmButton } from "./ConfirmButton";

type Action = () => Promise<void>;

/**
 * Les deux façons de retirer quelque chose du site, côte à côte et dites avec des mots simples :
 *   « Retirer et garder mes données » — rien n'est perdu : les réglages et contenus sont rangés, on les retrouve si l'on réinstalle ;
 *   « Retirer et tout effacer »       — définitif ; la confirmation le rappelle et conseille une sauvegarde.
 * Chaque bouton ouvre sa propre confirmation. Deux colonnes sur grand écran, empilés sur mobile (boutons pleine largeur, faciles à toucher).
 */
export function RemoveChoices({ t, name, keep, erase }: { t: Translator; name: string; keep: Action; erase: Action }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="remove-choices">
      <form action={keep} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 [&>button]:w-full">
        <ConfirmButton danger={false} confirmLabel={t("remove.keepYes")} message={t("remove.keepConfirm", { name })}>{t("remove.keep")}</ConfirmButton>
        <p className="text-sm leading-5 text-muted">{t("remove.keepHelp")}</p>
      </form>
      <form action={erase} className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-surface p-4 [&>button]:w-full">
        <ConfirmButton dangerConfirm confirmLabel={t("remove.eraseYes")} message={t("remove.eraseConfirm", { name })}>{t("remove.erase")}</ConfirmButton>
        <p className="text-sm leading-5 text-muted">{t("remove.eraseHelp")}</p>
      </form>
    </div>
  );
}

/** Bloc « Retirer de mon site » d'une fenêtre ou d'une page de réglages. */
export function RemoveSection({ t, title, intro, name, keep, erase }: { t: Translator; title: string; intro: string; name: string; keep: Action; erase: Action }) {
  return (
    <section className="space-y-3 rounded-2xl border border-red-500/30 p-4 sm:p-5" data-testid="remove-section">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted">{intro}</p>
      <RemoveChoices t={t} name={name} keep={keep} erase={erase} />
    </section>
  );
}
