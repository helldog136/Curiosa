import type { Translator } from "@/core/i18n/dictionary";
import { setPlacementAction, toggleInstanceAction } from "@/app/admin/(panel)/extensions/actions";
import { addInstance, toggleModule } from "@/app/admin/(panel)/modules/actions";
import type { InstalledInstance, InstalledModule } from "@/app/admin/(panel)/extensions/loadInstalled";
import { CopyText } from "@/components/site/CopyText";
import { InstanceState } from "./InstanceState";
import { ui } from "./ui";

const SWITCH = (on: boolean) => (
  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} /></span>
);

/** Une extension installée : de quoi la reconnaître, puis chacune de ses fonctionnalités avec son état, son réglage et, si elle y a sa place, « épingler au menu ». */
export function ExtensionCard({ t, m, advanced, isOwner }: { t: Translator; m: InstalledModule; advanced: boolean; isOwner: boolean }) {
  const chips = (
    <>
      {m.platform && m.platform !== m.name && <span className={ui.chip} data-testid="platform-chip">{m.platform}</span>}
      {advanced && <span className={m.enabled ? ui.chipOk : ui.chip}>{m.enabled ? t("modules.on") : t("modules.off")}</span>}
      {m.update && <span className={ui.chipWarn} data-testid={`module-behind-${m.id}`}>⬆ {t("modules.updateBadge")}</span>}
      {m.missing && <span className={ui.chipWarn} data-testid={`module-missing-${m.id}`}>⚠ {t("deps.missing.badge")}</span>}
      {m.auto && <span className={ui.chip} data-testid={`module-auto-${m.id}`}>🔗 {t("deps.auto.badge")}</span>}
    </>
  );
  return (
    <li data-catalogue-item data-search={m.search} data-testid={`extension-${m.id}`} className={`${ui.card} flex flex-col gap-4 !p-4 sm:!p-5 ${m.enabled ? "" : "bg-bg shadow-none"}`}>
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words text-lg font-semibold leading-tight">{m.name}</span>
            {advanced && <span className="text-xs text-muted">v{m.version}</span>}
          </p>
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted">{m.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">{chips}</p>
        </div>
      </div>

      {m.instances.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-bg" aria-label={advanced ? t("hub.instances") : t("hub.instancesSimple")}>
          {m.instances.map((i) => <InstanceRow key={i.id} t={t} i={i} moduleEnabled={m.enabled} solo={!advanced && m.instances.length === 1} />)}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        {!advanced && isOwner && m.loaded ? (
          <form action={toggleModule.bind(null, m.id, !m.enabled)}>
            <input type="hidden" name="from" value="list" />
            <button className="inline-flex min-h-10 items-center gap-2.5 rounded-full py-1 pr-2 text-sm font-medium" aria-pressed={m.enabled}>{SWITCH(m.enabled)}{m.enabled ? t("modules.on") : t("modules.off")}</button>
          </form>
        ) : !advanced ? <span className={m.enabled ? ui.chipOk : ui.chip}>{m.enabled ? t("modules.on") : t("modules.off")}</span> : <span className="text-sm text-muted">{m.count === 0 ? t("modules.instanceCountNone") : m.count === 1 ? t("modules.instanceCountOne") : t("modules.instanceCountMany", { count: m.count })}</span>}
        <span className="flex flex-wrap items-center gap-2">
          {m.enabled && m.loaded && m.count === 0 && <form action={addInstance.bind(null, m.id)}><button className={ui.btnPrimary}>{t("modules.setUp")}</button></form>}
          <a href={`/admin/modules/${encodeURIComponent(m.id)}`} aria-label={t("modules.openModule", { name: m.name })} className="inline-flex min-h-10 items-center text-sm text-muted hover:text-accent">{advanced ? t("hub.openModule") : t("modules.moreOptions")} ›</a>
        </span>
      </div>
    </li>
  );
}

/** `solo` : mode simple, une seule fonctionnalité dans la carte — son nom et son interrupteur doublonneraient ceux de la carte. */
function InstanceRow({ t, i, moduleEnabled, solo }: { t: Translator; i: InstalledInstance; moduleEnabled: boolean; solo: boolean }) {
  return (
    <li className="space-y-2 px-3 py-3 sm:px-4" data-testid={`extension-instance-${i.id}`} data-state={i.state} data-pinned={i.pinned ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {!solo && <a href={`/admin/instances/${i.id}`} className="min-w-0 flex-1 basis-40 break-words font-medium hover:text-accent">{i.name}</a>}
        <InstanceState t={t} state={i.state} />
        {i.badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{i.badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
      </div>
      {i.state === "error" && <p className="text-sm text-red-600" role="status">{t("integrations.errorHint")}</p>}
      {i.obsUrl && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="text-xs font-medium text-muted">{t("overlays.obsAddress")}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <code data-testid="overlay-url" className="min-w-0 flex-1 break-all font-mono text-sm">{i.obsUrl}</code>
            <CopyText text={i.obsUrl} copyLabel={t("overlays.copy")} copiedLabel={t("overlays.copied")} />
          </div>
          <p className="mt-2 text-xs text-muted">{i.enabled && moduleEnabled ? t("overlays.obsHelp") : t("overlays.obsOff")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {!solo && <form action={toggleInstanceAction.bind(null, i.id, !i.enabled)}>
          <button className="inline-flex min-h-10 items-center gap-2 rounded-full pr-2 text-sm" aria-pressed={i.enabled} aria-label={t(i.enabled ? "integrations.disable" : "integrations.enable", { name: i.name })}>{SWITCH(i.enabled)}{i.enabled ? t("integrations.state.on") : t("integrations.state.off")}</button>
        </form>}
        {i.content && <a href={`/admin/entries?c=${i.key}`} className="inline-flex min-h-10 items-center text-sm text-accent hover:underline">{t("integrations.items")}</a>}
        <a href={`/admin/instances/${i.id}`} className="inline-flex min-h-10 items-center text-sm text-accent hover:underline">⚙️ {t("integrations.settings")}</a>
        {i.unpinTo && (
          <form action={setPlacementAction.bind(null, i.id, i.pinned ? i.unpinTo : "menu")} className="sm:ml-auto">
            <button className="inline-flex min-h-10 items-center text-sm text-muted hover:text-accent" data-testid={i.pinned ? "unpin" : "pin"}>📌 {i.pinned ? t("placement.unpin") : t("placement.pin")}</button>
          </form>
        )}
      </div>
    </li>
  );
}
