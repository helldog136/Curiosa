import Link from "next/link";
import type { Translator } from "@/core/i18n/dictionary";
import { setPlacementAction } from "@/app/admin/(panel)/extensions/actions";
import { addInstance } from "@/app/admin/(panel)/modules/actions";
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

/** A-t-elle des actions rares à ranger dans « ⋯ » ? (voir son contenu, épingler / retirer du menu). Sans action, pas de bouton « ⋯ ». */
const hasActions = (i: InstalledInstance) => i.content || !!i.unpinTo;

/** Les actions rares d'une instance, dans le menu « ⋯ » : voir son contenu, épingler / retirer du menu. Le reste (réglages, retrait) est dans la fenêtre « Réglages ». */
function InstanceActions({ t, i }: { t: Translator; i: InstalledInstance }) {
  return (
    <>
      {i.content && <a href={`/admin/entries?c=${i.key}`} className={ITEM}>{t("integrations.items")}</a>}
      {i.unpinTo && (
        <form action={setPlacementAction.bind(null, i.id, i.pinned ? i.unpinTo : "menu")}>
          <button className={ITEM} data-testid={i.pinned ? "unpin" : "pin"}>📌 {i.pinned ? t("placement.unpin") : t("placement.pin")}</button>
        </form>
      )}
    </>
  );
}

/** Pastilles qui demandent un regard : à configurer, erreur, mise à jour, dépendance manquante, données gardées. Un état normal n'a pas de pastille. */
function Chips({ t, m }: { t: Translator; m: InstalledModule }) {
  return (
    <>
      {(m.attention === "setup" || m.attention === "error") && <InstanceState t={t} state={m.attention} />}
      {m.update && <span className={ui.chipWarn} data-testid={`module-behind-${m.id}`}>⬆ {t("modules.updateBadge")}</span>}
      {m.missing && <span className={ui.chipWarn} data-testid={`module-missing-${m.id}`}>⚠ {t("deps.missing.badge")}</span>}
      {m.auto && <span className={ui.chip} data-testid={`module-auto-${m.id}`}>🔗 {t("deps.auto.badge")}</span>}
      {m.kept > 0 && m.count === 0 && <span className={ui.chip} data-testid={`module-kept-${m.id}`}>🗂 {t("kept.badge")}</span>}
      {m.platform && m.platform !== m.name && <span className={ui.chip} data-testid="platform-chip">{m.platform}</span>}
    </>
  );
}

/**
 * Une extension installée = UNE ligne : icône, nom, courte description, pastilles utiles, et une seule action visible (« Réglages », qui ouvre une fenêtre
 * par-dessus la liste : réglages, instances, adresse OBS, retrait… voir extensions/@modal). Le reste tient dans « ⋯ ». Une seule instance : jamais montrée
 * à part (même nom). Plusieurs : repliées sous la ligne. Il n'y a pas d'interrupteur : une extension installée tourne, pour ne plus l'avoir on la retire.
 */
export function ExtensionCard({ t, m, advanced }: { t: Translator; m: InstalledModule; advanced: boolean }) {
  const single = m.instances.length === 1 ? m.instances[0]! : null;
  const many = m.instances.length > 1;
  const settingsHref = single ? `/admin/instances/${single.id}` : `/admin/modules/${encodeURIComponent(m.id)}`;
  const badge = m.instances.reduce((n, i) => n + i.badge, 0);
  const hasMenu = single !== null && hasActions(single);
  return (
    <li data-catalogue-item data-search={m.search} data-testid={`extension-${m.id}`} className={`${ui.card} !p-3 sm:!p-4`}>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-2xl" aria-hidden>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words font-semibold leading-tight">{m.name}</span>
            {advanced && <span className="hidden text-xs text-muted sm:inline">v{m.version}</span>}
            {badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
            <Chips t={t} m={m} />
          </p>
          <p className="truncate text-sm text-muted" title={m.description}>{m.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {m.loaded && m.count === 0 && m.kept === 0
            ? <form action={addInstance.bind(null, m.id)}><button className={ui.btnPrimary}>{t("modules.setUp")}</button></form>
            : <Link href={settingsHref} scroll={false} aria-label={`${t("integrations.settings")} — ${m.name}`} data-testid={`settings-${m.id}`} className={`${ui.btn} !px-3`}>{t("integrations.settings")}</Link>}
          {hasMenu && (
            <RowMenu label={t("extensions.menu", { name: m.name })}>
              <InstanceActions t={t} i={single} />
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
                  <Link href={`/admin/instances/${i.id}`} scroll={false} className="min-w-0 basis-full break-words text-sm font-medium hover:text-accent sm:flex-1 sm:basis-0">{i.name}</Link>
                  {i.state !== "on" && <InstanceState t={t} state={i.state} />}
                  {i.badge > 0 && <span data-testid="admin-badge" className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{i.badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
                  <Link href={`/admin/instances/${i.id}`} scroll={false} aria-label={`${t("integrations.settings")} — ${i.name}`} className={`${ui.btn} !px-3 !py-1.5`}>{t("integrations.settings")}</Link>
                  {hasActions(i) && <RowMenu label={t("extensions.menu", { name: i.name })}><InstanceActions t={t} i={i} /></RowMenu>}
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
