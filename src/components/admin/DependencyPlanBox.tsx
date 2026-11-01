import type { Translator } from "@/core/i18n/dictionary";
import type { PlanView } from "@/core/modules/dependencyView";
import { describeMissing, type Names } from "@/core/modules/dependencyMessages";
import { Callout } from "./Page";
import { ui } from "./ui";

/**
 * « Installe aussi : Contacts » AVANT d'installer : dit exactement ce qui sera installé ou activé en plus, y compris ce qui est déjà en place (✔).
 * Toujours visible dès que le module dépend d'un autre. `compact` (cartes du catalogue) : la phrase seule ; sinon le détail ligne par ligne.
 */
export function DependencyPlanBox({ view, t, names, compact = false, advanced = false }: { view: PlanView; t: Translator; names: Names; compact?: boolean; advanced?: boolean }) {
  const optional = view.optional ?? [];
  if (!view.lines.length && !view.problems.length && !optional.length) return null;
  const by = (action: string) => view.lines.filter((l) => l.action === action).map((l) => l.name);
  const installs = by("install");
  const setups = by("setup");
  const present = by("present");
  const updates = by("update");
  const headline = [
    installs.length ? t("deps.plan.alsoInstall", { names: installs.join(", ") }) : "",
    setups.length ? t("deps.plan.alsoSetup", { names: setups.join(", ") }) : "",
    updates.length ? t("deps.plan.alsoUpdate", { names: updates.join(", ") }) : "",
    !installs.length && !setups.length && !updates.length && present.length ? t("deps.plan.alreadyThere", { names: present.join(", ") }) : "",
  ].filter(Boolean);

  if (compact) {
    if (!headline.length && !view.problems.length) return null;   // seulement du facultatif : rien à annoncer sur une carte
    return (
      <p className="flex items-start gap-2 text-sm leading-5" data-testid="deps-plan-compact">
        <span aria-hidden>🔗</span>
        <span>{headline.length ? headline.join(" · ") : null}{view.problems.length > 0 && <span className="text-amber-700"> ⚠ {t("deps.plan.problemsTitle")}</span>}</span>
      </p>
    );
  }
  return (
    <section className={`${ui.card} space-y-3`} data-testid="deps-plan">
      <h2 className="text-lg font-semibold">🔗 {t("deps.plan.title")}</h2>
      {headline.length > 0 && <p className="text-[15px] font-medium" data-testid="deps-plan-headline">{headline.join(" · ")}</p>}
      {view.lines.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-bg">
          {view.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span aria-hidden className="text-lg">{l.icon}</span>
              <span className="font-medium">{l.name}</span>
              <span className={l.action === "present" ? "text-emerald-700" : "text-muted"}>{l.action === "present" ? "✔ " : ""}{t(`deps.plan.line.${l.action}`)}</span>
              {l.services.length > 0 && <span className="text-xs text-muted">{t("deps.plan.for", { services: l.services.join(", ") })}</span>}
              {advanced && <span className="font-mono text-xs text-muted">{l.id}</span>}
            </li>
          ))}
        </ul>
      )}
      {optional.length > 0 && (
        <div data-testid="deps-plan-optional">
          <p className="text-sm font-medium">{t("deps.plan.optionalTitle")}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {optional.map((o) => <li key={o.service} className="flex items-start gap-2"><span aria-hidden>{o.present ? "✔" : "○"}</span><span>{o.label}{o.present ? ` — ${t("deps.plan.line.present")}` : ""}</span></li>)}
          </ul>
          <p className="mt-1 text-xs text-muted">{t("deps.plan.optionalHelp")}</p>
        </div>
      )}
      {view.problems.length > 0 && (
        <Callout tone="warn" role="alert">
          <p className="font-medium">{t("deps.plan.problemsTitle")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{view.problems.map((p) => <li key={`${p.service}-${p.reason}`}>{describeMissing(p, t, names)}</li>)}</ul>
        </Callout>
      )}
    </section>
  );
}
