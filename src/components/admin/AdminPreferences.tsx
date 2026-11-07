import type { Translator } from "@/core/i18n/dictionary";
import { ADMIN_THEMES, type AdminTheme } from "@/core/adminTheme";
import { MODE_HREF } from "@/core/adminLinks";
import { setAdminMode, setAdminTheme } from "@/app/admin/(panel)/mode/actions";
import { Panel } from "./Page";
import { ui } from "./ui";

/** One group of buttons side by side where the pressed one shows the current choice; each button is a form, so it works without a script. */
const segment = (on: boolean) => `min-h-11 px-4 py-2 text-sm transition-colors ${on ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`;

/**
 * "Preferences" of My account: the admin mode (simple or advanced) and the admin theme (auto, light, dark). They used to sit at the bottom of the sidebar.
 * Both apply at once and only to the person who changes them (mode: stored on the account; theme: a cookie of this browser).
 */
export function AdminPreferences({ t, advanced, theme }: { t: Translator; advanced: boolean; theme: AdminTheme }) {
  return (
    <Panel title={t("account.prefs.title")} testid="prefs-card">
      <div className="space-y-5">
        <div role="group" aria-labelledby="pref-mode" className="space-y-2" data-testid="pref-mode">
          <p id="pref-mode" className="font-medium">{t("account.prefs.mode")}</p>
          <div className="inline-flex overflow-hidden rounded-xl border border-line">
            {([false, true] as const).map((adv) => (
              <form key={String(adv)} action={setAdminMode.bind(null, adv)}>
                <button aria-pressed={advanced === adv} className={segment(advanced === adv)}>{adv ? t("mode.advanced") : t("mode.simple")}</button>
              </form>
            ))}
          </div>
          <p className={ui.help}>{t("account.prefs.modeHelp")} <a href={MODE_HREF} className="underline hover:text-accent">{t("mode.page.title")}</a></p>
        </div>
        <div role="group" aria-labelledby="pref-theme" className="space-y-2" data-testid="pref-theme">
          <p id="pref-theme" className="font-medium">{t("theme.admin")}</p>
          <div className="inline-flex overflow-hidden rounded-xl border border-line">
            {ADMIN_THEMES.map((id) => (
              <form key={id} action={setAdminTheme.bind(null, id)}>
                <button aria-pressed={theme === id} className={segment(theme === id)}>{t(`theme.admin.${id}`)}</button>
              </form>
            ))}
          </div>
          <p className={ui.help}>{t("account.prefs.themeHelp")}</p>
        </div>
      </div>
    </Panel>
  );
}
