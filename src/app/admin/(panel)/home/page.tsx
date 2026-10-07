import { adminCtx } from "@/core/admin";
import { listCollections, pickName } from "@/core/collections";
import { SLOTS } from "@/core/blocks";
import { ActionForm } from "@/components/admin/ActionForm";
import { ui } from "@/components/admin/ui";
import { saveHome } from "./actions";

export default async function HomeAdminPage() {
  const { t, locale, config } = await adminCtx("admin");
  const collections = await listCollections();
  const rows = [...config.homeSections, { id: "new", type: "new" as const }];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.home")}</h1>
        <p className="mt-1 text-sm text-muted">{t("home.intro")}</p>
      </div>
      <ActionForm action={saveHome} submitLabel={t("action.save")}>
        <input type="hidden" name="count" value={rows.length} />
        {rows.map((row, i) => (
          <div key={`${row.id}-${i}`} className={`${ui.card} grid items-end gap-3 sm:grid-cols-[5rem_1fr_1fr_6rem_auto]`}>
            <label className="text-sm">
              <span className={ui.label}>{t("home.order")}</span>
              <input name={`order_${i}`} type="number" defaultValue={(i + 1) * 10} className={ui.input} />
            </label>
            <label className="text-sm">
              <span className={ui.label}>{t("home.type")}</span>
              <select name={`type_${i}`} defaultValue={row.type === "new" ? "" : row.type} className={ui.input}>
                {row.type === "new" && <option value="">— {t("home.addSection")} —</option>}
                <option value="hero">{t("home.hero")}</option>
                <option value="collection">{t("home.collection")}</option>
                <option value="slot">{t("home.slot")}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className={ui.label}>{t("home.source")}</span>
              <select name={`source_${i}`} defaultValue={row.type === "collection" ? `c:${row.collection}` : row.type === "slot" ? `s:${row.slot}` : ""} className={ui.input}>
                <option value="">—</option>
                <optgroup label={t("home.collection")}>
                  {collections.map((c) => <option key={c.id} value={`c:${c.key}`}>{pickName(c, locale, config.defaultLocale)}</option>)}
                </optgroup>
                <optgroup label={t("home.slot")}>
                  {SLOTS.map((s) => <option key={s} value={`s:${s}`}>{s}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="text-sm">
              <span className={ui.label}>{t("home.count")}</span>
              <input name={`count_${i}`} type="number" min={1} max={50} defaultValue={row.type === "collection" ? row.count : 3} className={ui.input} />
            </label>
            {row.type !== "new" && (
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name={`remove_${i}`} /> {t("action.delete")}</label>
            )}
          </div>
        ))}
      </ActionForm>
    </div>
  );
}
