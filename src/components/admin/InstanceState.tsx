import type { Translator } from "@/core/i18n/dictionary";
import type { IntegrationState } from "@/core/modules/menuPlacement";
import type { MissingSummary } from "@/core/modules/missingSettings";
import { ui } from "./ui";

const CHIP: Record<IntegrationState, string> = { on: ui.chipOk, setup: ui.chipWarn, error: ui.chipDanger };
const MARK: Record<IntegrationState, string> = { on: "✓", setup: "✎", error: "⚠" };

/** Le texte de la pastille « à configurer » : ce qu'il faut renseigner (un réglage : son nom ; plusieurs : leur nombre), sinon seulement « À configurer ». */
function setupText(t: Translator, missing?: MissingSummary): string {
  if (missing?.kind === "one") return t("integrations.state.setupOne", { label: missing.label });
  if (missing?.kind === "many") return t("integrations.state.setupMany", { count: missing.count });
  return t("integrations.state.setup");
}

/** Pastille d'état d'une instance : en place, à configurer (avec le motif) ou en erreur (la forme change aussi, pas seulement la couleur). */
export function InstanceState({ t, state, missing }: { t: Translator; state: IntegrationState; missing?: MissingSummary }) {
  return (
    <span className={`${CHIP[state]} max-w-full`} data-state={state}>
      <span aria-hidden>{MARK[state]}</span>
      <span className="min-w-0 break-words">{state === "setup" ? setupText(t, missing) : t(`integrations.state.${state}`)}</span>
    </span>
  );
}
