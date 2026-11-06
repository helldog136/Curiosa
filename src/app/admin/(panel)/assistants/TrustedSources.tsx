import type { Translator } from "@/core/i18n/dictionary";
import { searchText } from "@/core/adminkit/search";
import { listTrustedSources, PRESET_SOURCE, sourceLabel } from "@/core/trustedImageSources";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { TextField } from "@/components/admin/Field";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { Panel } from "@/components/admin/Page";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { addPresetSourceAction, addTrustedSourceAction, removeTrustedSourceAction } from "./actions";

/**
 * "Trusted image sources" card (Admin > AI assistants > Settings): the owner's list of the only places an assistant may import images from.
 * Empty by default (the feature is off). One task: add a source (one field, or one click on the suggested one). Rows show only the source and a remove button
 * (R14, R16; a long source wraps, never cut); a live search is always there (R15); removing says what is lost (R24). The list is never reachable by an MCP tool.
 */
export async function TrustedSources({ t }: { t: Translator }) {
  const sources = await listTrustedSources();
  const labels = sources.map(sourceLabel);
  const presetLabel = sourceLabel(PRESET_SOURCE);
  const presetThere = labels.includes(presetLabel);

  return (
    <Panel title={t("trusted.title")} help={t("trusted.help")} testid="trusted-sources">
      {sources.length === 0 ? (
        <p className="text-[15px] leading-6" data-testid="trusted-empty">{t("trusted.empty")}</p>
      ) : (
        <div className="space-y-3">
          <LiveSearch scope="trusted" placeholder={t("trusted.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
          <ul className="divide-y divide-line rounded-xl border border-line" aria-label={t("trusted.title")} data-testid="trusted-list">
            {labels.map((label) => (
              <li key={label} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2" data-live-item="trusted" data-search={searchText([label])} data-testid="trusted-row">
                <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{label}</span>
                <form action={removeTrustedSourceAction.bind(null, label)}>
                  <ConfirmButton message={t("trusted.remove.confirm", { source: label })} confirmLabel={t("trusted.remove")} pendingLabel={t("progress.deleting")}>{t("trusted.remove")}</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ActionForm action={addTrustedSourceAction} submitLabel={t("trusted.add")} pendingLabel={t("progress.creating")} reset className="space-y-3">
        <TextField label={t("trusted.field")} name="source" example={t("trusted.example")} autoComplete="off" inputMode="url" />
      </ActionForm>

      {!presetThere && (
        <form action={addPresetSourceAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <PendingButton variant="btn" pendingLabel={t("progress.creating")}>{t("trusted.preset")}</PendingButton>
          <span className={`${ui.help} font-mono`}>{presetLabel}</span>
        </form>
      )}
    </Panel>
  );
}
