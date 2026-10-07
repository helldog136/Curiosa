import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { Checkbox } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { saveNavigation } from "./actions";
import { listMenuPages } from "./pages";

export const dynamic = "force-dynamic";

export default async function NavigationPage() {
  const { t, config } = await adminCtx("admin");
  const pages = await listMenuPages(config.defaultLocale);
  const pageHrefs = new Set(pages.map((p) => p.href));
  const inMenu = new Set(config.nav.map((n) => n.href));
  const manual = [...config.nav.filter((n) => !pageHrefs.has(n.href)), { label: {}, href: "" }, { label: {}, href: "" }];
  return (
    <div className="space-y-6">
      <div>
        <h1 className={ui.pageTitle}>{t("nav.navigation")}</h1>
        <p className={ui.pageIntro}>{t("navigation.intro")}</p>
      </div>
      <ActionForm action={saveNavigation} submitLabel={t("action.save")}>
        {pages.length > 0 && (
          <section className={`${ui.card} space-y-3`}>
            <h2 className="text-lg font-semibold">{t("navigation.pagesTitle")}</h2>
            <p className={ui.help}>{t("navigation.pagesHelp")}</p>
            {pages.map((p) => (
              <Checkbox key={p.id} name="page" value={p.id} label={p.title} help={p.href} defaultChecked={inMenu.has(p.href)} />
            ))}
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("navigation.linksTitle")}</h2>
          <p className={ui.help}>{t("navigation.linksHelp")}</p>
          <input type="hidden" name="count" value={manual.length} />
          {manual.map((row, i) => (
            <div key={i} className={`${ui.card} space-y-3`}>
              <label className="block text-sm">
                <span className={ui.label}>{t("navigation.href")}</span>
                <input name={`href_${i}`} defaultValue={row.href} placeholder="https://…" className={ui.input} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {config.locales.map((l) => (
                  <label key={l} className="block text-sm">
                    <span className={ui.label}>{t("navigation.label")} — {localeName(l)}</span>
                    <input name={`label_${i}_${l}`} defaultValue={row.label[l] ?? ""} className={ui.input} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>
      </ActionForm>
    </div>
  );
}
