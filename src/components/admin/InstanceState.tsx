import type { Translator } from "@/core/i18n/dictionary";
import type { IntegrationState } from "@/core/modules/menuPlacement";
import { ui } from "./ui";

const CHIP: Record<IntegrationState, string> = { on: ui.chipOk, off: ui.chip, setup: ui.chipWarn, error: ui.chipDanger };
const MARK: Record<IntegrationState, string> = { on: "✓", off: "○", setup: "✎", error: "⚠" };

/** Pastille d'état d'une instance : active, désactivée, à configurer ou en erreur (la forme change aussi, pas seulement la couleur). */
export function InstanceState({ t, state }: { t: Translator; state: IntegrationState }) {
  return <span className={CHIP[state]} data-state={state}><span aria-hidden>{MARK[state]}</span>{t(`integrations.state.${state}`)}</span>;
}
