import type { Translator } from "@/core/i18n/dictionary";
import { setPlacementAction, toggleInstanceAction } from "@/app/admin/(panel)/extensions/actions";
import { addInstance, toggleModule } from "@/app/admin/(panel)/modules/actions";
import type { InstalledInstance, InstalledModule } from "@/app/admin/(panel)/extensions/loadInstalled";
import { CopyText } from "@/components/site/CopyText";
import { InstanceState } from "./InstanceState";
import { RowMenu } from "./RowMenu";
import { ui } from "./ui";

const ITEM = "flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent/10 hover:text-accent";

/** Adresse à coller dans OBS, sur une ligne : l'adresse (coupée si besoin) et « Copier ». */
function ObsLine({ t, url }: { t: Translator; url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs" title={t("overlays.obsAddress")}>
      <span className="shrink-0 font-medium text-muted">OBS</span>
      <code data-testid="overlay-url" className="min-w-0 flex-1 truncate font-mono">{url}</code>
      <CopyText text={url} copyLabel={t("overlays.copy")} copiedLabel={t("overlays.copied")} />
    </div>
  );
}

/** Les actions rares d'une instance, dans le menu « ⋯ » : voir son contenu, épingler / retirer du menu, allumer / éteindre. */
function InstanceActions({ t, i, withToggle = true }: { t: Translator; i: InstalledInstance; withToggle?: boolean }) {
  return (
    <>
      {i.content && <a href={`/admin/entries?c=${i.key}`} className={ITEM}>{t("integrations.items")}</a>}
      {i.unpinTo && (
        <form action={setPlacementAction.bind(null, i.id, i.pinned ? i.unpinTo : "menu")}>
          <button className={ITEM} data-testid={i.pinned ? "unpin" : "pin"}>📌 {i.pinned ? t("placement.unpin") : t("placement.pin")}</button>
        </form>
      )}
      {withToggle && (
        <form action={toggleInstanceAction.bind(null, i.id, !i.enabled)}>
          <button className={ITEM} aria-label={t(i.enabled ? "integrations.disable" : "integrations.enable", { name: i.name })}>{i.enabled ? t("extensions.turnOff") : t("extensions.turnOn")}</button>
        </form>
      )}
    </>
  );
}

/** Pastilles qui demandent un regard : à configurer, erreur, éteinte, mise à jour, dépendance manquante. Un état normal n'a pas de pastille. */
function Chips({ t, m, off }: { t: Translator; m: InstalledModule; off: boolean }) {
  return (
    <>
      {(m.attention === "setup" || m.attention === "error") && <InstanceState t={t} state={m.attention} />}
      {off && <span className={ui.chip}>{t("modules.off")}</span>}
      {m.update && <span className={ui.chipWarn} data-testid={`module-behind-${m.id}`}>⬆ {t("modules.updateBadge")}</span>}
      {m.missing && <span className={ui.chipWarn} data-testid={`module-missing-${m.id}`}>⚠ {t("deps.missing.badge")}</span>}
      {m.auto && <span className={ui.chip} data-testid={`module-auto-${m.id}`}>🔗 {t("deps.auto.badge")}</span>}
      {m.platform && m.platform !== m.name && <span className={ui.chip} data-testid="platform-chip">{m.platform}</span>}
    </>
  );
}

/**
 * Une extension installée = UNE ligne : icône, nom, courte description, pastilles utiles, et une seule action visible (« Réglages »).
 * Le reste tient dans « ⋯ ». Une seule instance : jamais montrée à part (même nom). Plusieurs : repliées sous la ligne.
 */
export function ExtensionCard({ t, m, advanced, isOwner }: { t: Translator; m: InstalledModule; advanced: boolean; isOwner: boolean }) {
  const single = m.instances.length === 1 ? m.instances[0]! : null;
  const many = m.instances.length > 1;
  const settingsHref = single ? `/admin/instances/${single.id}` : `/admin/modules/${encodeURIComponent(m.id)}`;
  const badge = m.instances.reduce((n, i) => n + i.badge, 0);
  const off = !m.enabled || (single !== null && !single.enabled);
  const canToggleModule = isOwner && m.loaded;
  const hasMenu = single !== null || canToggleModule;
  return (
    <li data-catalogue-item data-search={m.search} data-testid={`extension-${m.id}`} className={`${ui.card} !p-3 sm:!p-4 ${off ? "bg-bg shadow-none" : ""}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-2xl ${off ? "opacity-60" : ""}`} aria-hidden>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words font-semibold leading-tight">{m.name}</span>
            {advanced && <span className="hidden text-xs text-muted sm:inline">v{m.version}</span>}
            {badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
            <Chips t={t} m={m} off={off} />
          </p>
          <p className="truncate text-sm text-muted" title={m.description}>{m.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {m.enabled && m.loaded && m.count === 0
            ? <form action={addInstance.bind(null, m.id)}><button className={ui.btnPrimary}>{t("modules.setUp")}</button></form>
            : <a href={settingsHref} aria-label={`${t("integrations.settings")} — ${m.name}`} className={`${ui.btn} !px-3`}>{t("integrations.settings")}</a>}
          {hasMenu && (
            <RowMenu label={t("extensions.menu", { name: m.name })}>
              {single && <InstanceActions t={t} i={single} withToggle={!canToggleModule} />}
              {canToggleModule && (
                <form action={toggleModule.bind(null, m.id, !m.enabled)}>
                  <input type="hidden" name="from" value="list" />
                  <button className={ITEM}>{m.enabled ? t(single ? "extensions.turnOff" : "extensions.turnOffAll") : t(single ? "extensions.turnOn" : "extensions.turnOnAll")}</button>
                </form>
              )}
            </RowMenu>
          )}
        </div>
      </div>

      {single?.obsUrl && <div className="mt-2"><ObsLine t={t} url={single.obsUrl} /></div>}

      {many && (
        <details className="group mt-2 rounded-xl border border-line bg-bg" data-testid={`extension-many-${m.id}`}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-[10px] text-muted transition-transform group-open:rotate-90">▶</span>
            {advanced ? t("modules.instanceCountMany", { count: m.count }) : t("extensions.manyItems", { count: m.count })}
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {m.instances.map((i) => (
              <li key={i.id} className="space-y-2 px-3 py-2" data-testid={`extension-instance-${i.id}`} data-state={i.state} data-pinned={i.pinned ? "1" : "0"}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  <a href={`/admin/instances/${i.id}`} className="min-w-0 basis-full break-words text-sm font-medium hover:text-accent sm:flex-1 sm:basis-0">{i.name}</a>
                  {i.state !== "on" && <InstanceState t={t} state={i.state} />}
                  {i.badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{i.badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
                  <a href={`/admin/instances/${i.id}`} aria-label={`${t("integrations.settings")} — ${i.name}`} className={`${ui.btn} !px-3 !py-1.5`}>{t("integrations.settings")}</a>
                  <RowMenu label={t("extensions.menu", { name: i.name })}><InstanceActions t={t} i={i} /></RowMenu>
                </div>
                {i.obsUrl && <ObsLine t={t} url={i.obsUrl} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
