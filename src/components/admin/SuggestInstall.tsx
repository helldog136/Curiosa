import { makeTranslator, type Translator } from "@/core/i18n/dictionary";
import { currentUser, hasRole } from "@/core/permissions";
import { getSiteConfig } from "@/core/settings";
import { localized } from "@/core/modules/types";
import { dismissedServices, suggestionView } from "@/core/modules/suggestInstall";
import { dismissSuggestionAction, installSuggested, resetSuggestionsAction } from "@/app/admin/(panel)/instances/suggestActions";
import { ui } from "./ui";

/**
 * Bloc « suggestInstall » d'un panneau d'admin : propriétaire → liste des modules du catalogue qui offrent le service (officiels d'abord, « extra » avec
 * avertissement et case à cocher), « Installer » et « Ne plus proposer » ; autres → une phrase pour demander au propriétaire. Rien si un fournisseur actif existe.
 */
export async function SuggestInstall({ instanceId, service, min, reason, locale }: { instanceId: string; service: string; min?: number; reason: string; locale: string }) {
  const t = makeTranslator(locale);
  const view = await suggestionView(instanceId, service, min);
  if (view.state === "hidden") return null;
  const why = String(reason ?? "").slice(0, 200);
  const isOwner = hasRole(await currentUser(), "owner");
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
              <form action={installSuggested.bind(null, instanceId, service, c.id)} className="mt-2 space-y-2">
                {c.origin === "extra" && (
                  <>
                    <p className="text-sm">{t("suggest.extraWarning")}</p>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required className="mt-1" />{t("catalogue.trust")}</label>
                  </>
                )}
                <button className={ui.btnPrimary}>{t("suggest.install")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={dismissSuggestionAction.bind(null, instanceId, service)}>
        <button className="text-sm text-muted underline-offset-2 hover:underline">{t("suggest.dismiss")}</button>
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
          <button className="text-muted underline-offset-2 hover:underline">{t("suggest.reset")}</button>
        </form>
      )}
    </div>
  );
}
