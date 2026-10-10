import type { Translator } from "@/core/i18n/dictionary";
import { getModulesReport, moduleNames } from "@/core/modules/updateStatus";
import { ActionForm } from "./ActionForm";
import { Callout } from "./Page";
import { ModulesUpdates, type ModuleUpdateRow } from "./ModulesUpdates";
import { ui } from "./ui";
import { recheckModules } from "@/app/admin/(panel)/updates/actions";

/** Modules en retard (vérifiés au plus toutes les quelques minutes ; jamais d'erreur ici : un échec devient un simple message par module). */
export async function loadModulesUpdates(t: Translator, locale: string, defaultLocale: string) {
  const report = await getModulesReport();
  const names = await moduleNames(locale, defaultLocale);
  const nameOf = (id: string) => names.get(id) ?? id;
  const rows: ModuleUpdateRow[] = report.outdated.map((o) => ({ id: o.id, name: nameOf(o.id), icon: "🧩", current: o.current, target: o.target, major: o.level === "major", levelLabel: o.level ? t(`updates.level.${o.level}`) : "", ...(o.needsCore ? { needsCore: o.needsCore } : {}) }));
  return { report, rows, nameOf };
}
export type ModulesUpdatesData = Awaited<ReturnType<typeof loadModulesUpdates>>;

/** « Vos modules » : la liste des modules en retard, « Tout mettre à jour » et « Revérifier ». Onglet « Mises à jour » du hub Modules. */
export function ModulesUpdatesSection({ t, data, when, highlight = false }: { t: Translator; data: ModulesUpdatesData; when: string; highlight?: boolean }) {
  const { report, rows, nameOf } = data;
  return (
    <section className={`${ui.card} space-y-4 ${highlight ? "border-accent bg-accent/5" : ""}`} data-testid="modules-updates">
      <div>
        <h2 className="text-lg font-semibold">🧩 {t("updates.modules.title")}</h2>
        {highlight && <p className="mt-1 text-sm font-semibold text-accent" data-testid="modules-remind">{t("updates.modules.remind")}</p>}
        <p className="mt-1 text-sm leading-6 text-muted">{rows.length > 0 ? t("updates.modules.behind", { n: rows.length }) : t("updates.modules.help")}</p>
      </div>
      {rows.some((r) => r.major) && <Callout tone="warn">{t("updates.modules.majorWarning")}</Callout>}
      {rows.length === 0 && report.checked > 0 && report.unchecked.length < report.checked && <p className="text-sm font-medium" data-testid="modules-uptodate">✅ {t("updates.modules.upToDate")}</p>}
      {report.checked === 0 && <p className="text-sm text-muted" data-testid="modules-none">{t("updates.modules.none")}</p>}
      <ModulesUpdates rows={rows} labels={{
        all: { idle: t("updates.modules.all"), working: t("modules.updating"), done: t("modules.updated"), failed: t("modules.updateFailed") },
        one: { idle: t("modules.update"), working: t("modules.updating"), done: t("modules.updated"), failed: t("modules.updateFailed") },
        confirmAll: t("updates.modules.confirmAll"), confirmMajor: t("updates.modules.confirmMajor"), incomplete: t("updates.modules.incomplete"),
        updatedLine: t("updates.modules.updatedLine"), failedLine: t("updates.modules.failedLine"), stoppedLine: t("updates.modules.stoppedLine"), skippedLine: t("updates.modules.skippedLine"), incompatLine: t("updates.modules.incompatLine"), needsCore: t("modules.core.needs"),
      }} />
      {report.unchecked.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted" data-testid="modules-unchecked">
          {report.unchecked.map((id) => <li key={id}>{t("updates.modules.unchecked", { name: nameOf(id) })}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-muted">{t("updates.checkedAt")} {when}</p>
        <ActionForm action={recheckModules} submitLabel={t("updates.modules.recheck")} secondary className="space-y-2">{null}</ActionForm>
      </div>
    </section>
  );
}
