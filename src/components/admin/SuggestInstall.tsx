import { makeTranslator, type Translator } from "@/core/i18n/dictionary";
import { can, currentUser } from "@/core/permissions";
import { getSiteConfig } from "@/core/settings";
import { localized } from "@/core/modules/types";
import { dismissedServices, suggestionView } from "@/core/modules/suggestInstall";
import { dismissSuggestionAction, resetSuggestionsAction } from "@/app/admin/(panel)/instances/suggestActions";
import { ui } from "./ui";
import { PendingButton } from "./PendingButton";
import { SuggestInstallForm } from "./SuggestInstallForm";

/**
 * Bloc « suggestInstall » d'un panneau d'admin : propriétaire → liste des modules du catalogue qui offrent le service (officiels d'abord, « extra » avec
 * avertissement et case à cocher), « Installer » et « Ne plus proposer » ; autres → une phrase pour demander au propriétaire. Rien si un fournisseur actif existe.
 */
export async function SuggestInstall({ instanceId, service, min, reason, locale }: { instanceId: string; service: string; min?: number; reason: string; locale: string }) {
  const t = makeTranslator(locale);
  const view = await suggestionView(instanceId, service, min);
  if (view.state === "hidden") return null;
  const why = String(reason ?? "").slice(0, 200);
  const isOwner = can(await currentUser(), "core:modules.install");
  if (!isOwner) {
    return <p className="rounded-xl border border-line bg-surface p-4 text-sm" data-testid="suggest-ask">{t("suggest.askOwner", { reason: why })}</p>;
  }
  const { defaultLocale } = await getSiteConfig();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, defaultLocale);
  return (
    <section className={`${ui.card} space-y-3`} data-testid="suggest-install">
      <h2 className="text-base font-semibold">{t("suggest.title", { reason: why })}</h2>
      {view.state === "unreachable" && <p className="text-sm text-muted">{t("suggest.unreachable")}</p>}
      {view.state === "none" && <p className="text-sm text-muted">{t("suggest.none")}</p>}
      {view.state === "list" && (
        <ul className="space-y-3">
          {view.candidates.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-bg p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium"><span aria-hidden>{c.icon ?? "🧩"}</span>{L(c.name)}{c.origin === "extra" && <span className={ui.chipWarn}>⚠ {t("catalogue.origin.extra")}</span>}</p>
              <p className="mt-1 text-sm text-muted">{L(c.description)}</p>
              <SuggestInstallForm instanceId={instanceId} service={service} moduleId={c.id} extra={c.origin === "extra"}
                labels={{ install: t("suggest.install"), installing: t("catalogue.installing"), done: t("catalogue.installDone"), failed: t("catalogue.installFailed"), extraWarning: t("suggest.extraWarning"), trust: t("catalogue.trust") }} />
            </li>
          ))}
        </ul>
      )}
      <form action={dismissSuggestionAction.bind(null, instanceId, service)}>
        <PendingButton variant="link" pendingLabel={t("progress.working")}>{t("suggest.dismiss")}</PendingButton>
      </form>
    </section>
  );
}

/** Sur la page d'une instance : le résultat d'un geste du bloc, et « Afficher de nouveau les suggestions » s'il y a des refus (propriétaire seulement). */
export async function SuggestNotices({ instanceId, query, t, isOwner }: { instanceId: string; query: Record<string, string | string[] | undefined>; t: Translator; isOwner: boolean }) {
  const done = typeof query.suggest === "string" ? query.suggest : null;
  const error = typeof query.suggestError === "string" && /^modules\.error\.[A-Za-z]+$/.test(query.suggestError) ? query.suggestError : null;
  const dismissed = isOwner ? await dismissedServices(instanceId) : [];
  if (!done && !error && !dismissed.length) return null;
  return (
    <div className="space-y-2 text-sm" data-testid="suggest-notices">
      {done === "installed" && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">{t("suggest.installed")}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3">{t(error, { services: "", modules: "" })}</p>}
      {dismissed.length > 0 && (
        <form action={resetSuggestionsAction.bind(null, instanceId)}>
          <PendingButton variant="link" pendingLabel={t("progress.working")}>{t("suggest.reset")}</PendingButton>
        </form>
      )}
    </div>
  );
}
