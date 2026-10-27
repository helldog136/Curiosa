import type { Translator } from "@/core/i18n/dictionary";

/**
 * La bascule clair / sombre du visiteur (docs/SKINS.md §3.8) : « Automatique » (l'appareil), « Clair », « Sombre ». Rendue SEULEMENT quand le skin fournit
 * les deux modes ; le script du cœur (`/skins/mode.js`) la révèle (`hidden` levé), garde le choix dans le stockage local du navigateur (aucun cookie, rien
 * n'est envoyé) et dit l'état aux lecteurs d'écran avec `aria-pressed`. Sans JavaScript elle reste masquée : le visiteur garde le mode de son appareil.
 * Cibles d'au moins 44 px, opérable au clavier (Tab, Entrée, Espace). Un skin peut la styler mais pas la retirer.
 */
const ICONS = {
  auto: <path d="M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18" fill="currentColor" fillOpacity="0.9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  light: <><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  dark: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
} as const;

export function ModeSwitch({ t }: { t: Translator }) {
  const options = [["auto", t("site.mode.auto")], ["light", t("site.mode.light")], ["dark", t("site.mode.dark")]] as const;
  return (
    <div data-skin-part="mode-switch" role="group" aria-label={t("site.mode.group")} hidden className="inline-flex items-center gap-0.5 rounded-full border border-line p-0.5">
      {options.map(([value, label]) => (
        <button key={value} type="button" data-skin-part="mode-option" data-mode-value={value} aria-pressed={value === "auto"} title={label}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-fg">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5">{ICONS[value]}</svg>
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
