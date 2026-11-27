/** Classes partagées de l'admin (Tailwind) : cartes blanches douces, grands champs, boutons arrondis — pensé pour qu'on n'ait pas peur d'y cliquer. */
export const ui = {
  input: "w-full rounded-xl border border-line-strong bg-bg px-4 py-2.5 text-[15px] max-sm:min-h-11 transition-colors placeholder:text-muted/60 hover:border-accent/50 focus:border-accent",
  label: "mb-1.5 block text-[15px] font-medium",
  help: "mt-1.5 max-w-[70ch] text-[13px] leading-5 text-muted",
  card: "rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(60,40,20,.04),0_10px_28px_-16px_rgba(60,40,20,.18)] sm:p-6",
  /** Sélecteur de couleur : une grande pastille bien visible (avec `input`, le remplissage écrasait la couleur en un trait). */
  colorInput: "block h-11 w-full cursor-pointer rounded-xl border border-line-strong bg-surface p-1 transition-colors hover:border-accent/50 focus:border-accent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0",
  btn: "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 max-sm:min-h-11 text-sm font-medium shadow-sm transition-colors hover:border-accent hover:text-accent disabled:opacity-60",
  btnPrimary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 max-sm:min-h-11 text-sm font-semibold text-accent-fg shadow-sm transition hover:brightness-110 disabled:opacity-60",
  btnDanger:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-surface px-4 py-2.5 max-sm:min-h-11 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10",
  /** A link that is the only way to do something: on a phone its hit area is 44 px tall (the look does not change on a desktop). */
  touch: "max-sm:inline-flex max-sm:min-h-11 max-sm:items-center",
  th: "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted",
  td: "px-3 py-2.5 align-top text-sm",
  /** En-tête de page : titre chaleureux + une phrase qui dit à quoi sert la page. */
  pageTitle: "text-3xl font-bold tracking-tight",
  pageIntro: "mt-2 max-w-2xl text-[15px] leading-6 text-muted",
  /** Petite étiquette (statut, origine…). */
  chip: "inline-flex items-center gap-1 rounded-full bg-accent-tint px-2.5 py-0.5 text-xs font-medium text-accent-text",
  chipWarn: "inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn-text",
  chipDanger: "inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger-text",
  chipOk: "inline-flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok-text",
} as const;
