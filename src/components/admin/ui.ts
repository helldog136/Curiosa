/** Classes partagées de l'admin (Tailwind). */
export const ui = {
  input: "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm",
  label: "mb-1 block text-sm font-medium",
  help: "mt-1 text-xs text-muted",
  card: "rounded-xl border border-line bg-surface p-5",
  btn: "inline-flex items-center justify-center rounded-lg border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent disabled:opacity-60",
  btnPrimary:
    "inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60",
  btnDanger:
    "inline-flex items-center justify-center rounded-lg border border-red-500/60 px-4 py-2 text-sm text-red-600 hover:bg-red-500/10",
  th: "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted",
  td: "px-3 py-2 align-top text-sm",
} as const;
