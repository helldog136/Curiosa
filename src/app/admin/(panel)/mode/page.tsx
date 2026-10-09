import { adminCtx } from "@/core/admin";
import { PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { setAdminMode } from "./actions";

/** Choisir sa façon de gérer le site : l'essentiel (simple) ou tous les réglages techniques (avancé). Propre à chaque personne, rien n'est perdu en changeant. */
export default async function ModePage() {
  const { t, advanced } = await adminCtx("editor");
  const choice = (isAdvanced: boolean) => {
    const current = advanced === isAdvanced;
    const prefix = isAdvanced ? "mode.page.advanced" : "mode.page.simple";
    return (
      <section key={String(isAdvanced)} aria-current={current ? "true" : undefined} data-testid={isAdvanced ? "mode-advanced" : "mode-simple"}
        className={`${ui.card} flex flex-col gap-4 ${current ? "border-accent ring-1 ring-accent" : ""}`}>
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{t(`${prefix}.title`)}{current && <span className={ui.chipOk}>✔ {t("mode.page.current")}</span>}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{t(`${prefix}.for`)}</p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
          <li>{t(`${prefix}.1`)}</li>
          <li>{t(`${prefix}.2`)}</li>
          <li>{t(`${prefix}.3`)}</li>
        </ul>
        {!current && (
          <form action={setAdminMode.bind(null, isAdvanced)} className="mt-auto">
            <button className={ui.btnPrimary}>{isAdvanced ? t("mode.switchToAdvanced") : t("mode.switchToSimple")}</button>
          </form>
        )}
      </section>
    );
  };
  return (
    <div className="space-y-8">
      <PageHeader title={t("mode.page.title")} intro={t("mode.help")} />
      <div className="grid gap-4 sm:grid-cols-2">{[choice(false), choice(true)]}</div>
      <p className="text-sm text-muted">{t("mode.page.safe")}</p>
    </div>
  );
}
