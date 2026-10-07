import { adminCtx } from "@/core/admin";
import { pickName } from "@/core/instances";
import { getActiveInstances, sectionsOf } from "@/core/modules/registry";
import { localized, type SettingField } from "@/core/modules/types";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { saveHome } from "./actions";

export default async function HomeAdminPage() {
  const { t, locale, config } = await adminCtx("admin");
  const active = await getActiveInstances();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);

  // Toutes les sections proposables : une par (instance, section déclarée par son module).
  const choices = active.flatMap(({ instance, mod }) =>
    sectionsOf(mod.manifest).map((s) => ({
      value: `${instance.key}|${s.id}`,
      label: `${pickName(instance, locale, config.defaultLocale)} — ${L(s.label)}`,
      options: (s.options ?? []) as SettingField[],
    })),
  );
  const rows = [...config.homeSections.filter((s) => choices.some((c) => c.value === `${s.instance}|${s.section}`)), null];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.home")}</h1>
        <p className="mt-1 text-sm text-muted">{t("home.intro")}</p>
      </div>
      <ActionForm action={saveHome} submitLabel={t("action.save")}>
        <input type="hidden" name="count" value={rows.length} />
        {rows.map((row, i) => {
          const current = row ? choices.find((c) => c.value === `${row.instance}|${row.section}`) : undefined;
          return (
            <div key={row?.id ?? "new"} className={`${ui.card} space-y-3`}>
              <div className="grid items-end gap-3 sm:grid-cols-[5rem_1fr_auto]">
                <label className="text-sm">
                  <span className={ui.label}>{t("home.order")}</span>
                  <input name={`order_${i}`} type="number" defaultValue={(i + 1) * 10} className={ui.input} />
                </label>
                <label className="text-sm">
                  <span className={ui.label}>{t("home.section")}</span>
                  <select name={`section_${i}`} defaultValue={row ? `${row.instance}|${row.section}` : ""} className={ui.input}>
                    <option value="">{row ? "—" : `— ${t("home.addSection")} —`}</option>
                    {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                {row && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name={`remove_${i}`} /> {t("action.delete")}</label>}
              </div>
              {row && current?.options.map((o) => {
                const value = row.options[o.key] ?? o.default;
                const name = `opt_${i}_${o.key}`;
                return o.type === "boolean" ? (
                  <label key={o.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={value === true} /> {L(o.label)}</label>
                ) : o.type === "select" ? (
                  <label key={o.key} className="block text-sm">
                    <span className={ui.label}>{L(o.label)}</span>
                    <select name={name} defaultValue={String(value ?? "")} className={ui.input}>
                      {(o.options ?? []).map((op) => <option key={op.value} value={op.value}>{L(op.label)}</option>)}
                    </select>
                  </label>
                ) : (
                  <label key={o.key} className="block text-sm">
                    <span className={ui.label}>{L(o.label)}</span>
                    <input name={name} type={o.type === "number" ? "number" : "text"} defaultValue={value === undefined ? "" : String(value)} className={ui.input} />
                  </label>
                );
              })}
            </div>
          );
        })}
        <p className={ui.help}>{t("home.optionsHint")}</p>
      </ActionForm>
    </div>
  );
}
