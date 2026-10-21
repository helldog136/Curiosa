import type { Translator } from "@/core/i18n/dictionary";
import type { RetiredLine } from "@/core/modules/retiredPlan";
import { eraseRetiredAction, restoreRetiredAction } from "@/app/admin/(panel)/modules/actions";
import { ConfirmButton } from "./ConfirmButton";
import { PendingButton } from "./PendingButton";

/** Les données gardées d'un module dont des éléments ont été retirés : on peut les retrouver (elles reviennent telles quelles) ou les effacer pour de bon. */
export function KeptData({ t, locale, name, kept }: { t: Translator; locale: string; name: string; kept: RetiredLine[] }) {
  if (!kept.length) return null;
  return (
    <section className="space-y-3" data-testid="kept-data">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("kept.title")}</h2>
      <p className="text-sm text-muted">{t("kept.help", { name })}</p>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {kept.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-testid={`kept-${k.id}`}>
            <span className="min-w-0 flex-1 basis-48"><span className="block break-words font-medium">{k.label}</span><span className="block text-xs text-muted">{t("kept.counts", { entries: k.entryCount, records: k.recordCount })} · {k.retiredAt.toLocaleDateString(locale)}</span></span>
            <span className="flex flex-wrap gap-2">
              <form action={restoreRetiredAction.bind(null, k.id)}><PendingButton pendingLabel={t("progress.restoring")}>{t("kept.restore")}</PendingButton></form>
              <form action={eraseRetiredAction.bind(null, { id: k.id })}><ConfirmButton confirmLabel={t("remove.eraseYes")} dangerConfirm message={t("kept.eraseConfirm", { name: k.label })}>{t("kept.erase")}</ConfirmButton></form>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
