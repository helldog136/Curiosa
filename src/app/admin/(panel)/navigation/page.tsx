import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { saveNavigation } from "./actions";

export default async function NavigationPage() {
  const { t, config } = await adminCtx("admin");
  const rows = [...config.nav, { label: {}, href: "" }, { label: {}, href: "" }];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.navigation")}</h1>
        <p className="mt-1 text-sm text-muted">{t("navigation.intro")}</p>
      </div>
      <ActionForm action={saveNavigation} submitLabel={t("action.save")}>
        <input type="hidden" name="count" value={rows.length} />
        {rows.map((row, i) => (
          <div key={i} className={`${ui.card} space-y-3`}>
            <label className="block text-sm">
              <span className={ui.label}>{t("navigation.href")}</span>
              <input name={`href_${i}`} defaultValue={row.href} placeholder="/about  ·  https://…" className={ui.input} />
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
      </ActionForm>
    </div>
  );
}
