import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { isOwner as ownerCheck } from "@/core/auth/access";
import { listInstances, pickName } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { getCatalogue, moduleOrigin } from "@/core/modules/catalogue";
import { listModuleRows, loadModule } from "@/core/modules/registry";
import { hasPage } from "@/core/modules/manifest";
import { localized } from "@/core/modules/types";
import Link from "next/link";
import { Callout } from "@/components/admin/Page";
import { KeptData } from "@/components/admin/KeptData";
import { RemoveSection } from "@/components/admin/RemoveSection";
import { listRetired } from "@/core/modules/retired";
import { ui } from "@/components/admin/ui";
import { ModuleUpdateButton } from "@/components/admin/ModuleUpdateButton";
import { ModuleMaintenance } from "@/components/admin/ModuleMaintenance";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { buildNames, viewModuleLinks } from "@/core/modules/dependencyView";
import { decodeMissing, describeMissingList } from "@/core/modules/dependencyMessages";
import { ModuleLinksBox } from "@/components/admin/ModuleLinksBox";
import { addInstance, uninstallModuleAction } from "../actions";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";

export type ModuleQuery = { update?: string; error?: string; detail?: string; missing?: string; op?: string; module?: string; to?: string; level?: string };

/**
 * Tout ce qu'on peut faire d'un module : mettre à jour, voir et ajouter ses instances, retrouver des données gardées, le retirer. La page entière
 * (/admin/modules/<id>) et la fenêtre par-dessus Extensions (route interceptée) montrent exactement ce contenu. Les messages des actions arrivent ici.
 */
export async function ModuleView({ id, query, embedded = false }: { id: string; query: ModuleQuery; embedded?: boolean }) {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  const isOwner = ownerCheck(user);
  const { update, error, detail, missing, to, level } = query;
  const row = (await listModuleRows()).find((r) => r.id === decodeURIComponent(id));
  if (!row) notFound();
  const mod = await loadModule(row);
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, config.defaultLocale);
  const mine = (await listInstances()).filter((i) => i.moduleId === row.id);
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);
  const market = advanced ? await getCatalogue().catch(() => []) : [];
  const behind = isOwner ? peekModulesReport()?.outdated.find((o) => o.id === row.id) : undefined;   // sans réseau
  const canAdd = !!mod && (mod.manifest.instances === "multiple" || mine.length === 0);
  const kept = await listRetired(row.id);
  const name = mod ? L(mod.manifest.name) : row.id;
  const names = await buildNames(locale, config.defaultLocale);
  const links = await viewModuleLinks(row.id, names);
  // Refus lisibles : les modules par leur nom, ce qu'ils perdraient, et quoi faire.
  const lost = links.losses;
  const refusalText = error === "modules.error.requiredBy" && lost.length
    ? t("deps.refusal.uninstall", { name, users: lost.map((l) => l.name).join(", "), losses: lost.map((l) => t("deps.refusal.loss", { module: l.name, services: l.services.join(", ") })).join(". ") })
    : error === "modules.error.requires" && decodeMissing(missing).length
      ? describeMissingList(decodeMissing(missing), t, names).join(" ")
      : error?.startsWith("modules.error.") || error?.startsWith("instances.error.")
        ? t(error, { services: detail ? detail.split(", ").map(names.service).join(", ") : "", modules: detail ? detail.split(", ").map(names.module).join(", ") : "" })
        : error ? t("error.generic") : null;
  const listTitle = t("nav.extensions");

  return (
    <div className="space-y-6">
      {!embedded && <a href={EXTENSIONS_HREF} className="inline-block text-sm text-muted hover:text-accent">← {listTitle}</a>}
      <header className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-3xl" aria-hidden>{mod?.manifest.icon ?? "🧩"}</span>
        <div className="min-w-0">
          <h1 className={ui.pageTitle}>{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {behind && <span className={ui.chipWarn}>⬆ {t("modules.updateBadge")}</span>}
            {advanced && <span>v{row.version}{row.source === "git" ? " · git" : ""}</span>}
            {advanced && <span className={`rounded px-2 py-0.5 text-xs ${moduleOrigin(row, market) === "custom" ? "bg-amber-500/20" : "bg-line"}`}>{t(`catalogue.origin.${moduleOrigin(row, market)}`)}</span>}
          </p>
        </div>
      </header>

      {refusalText && <Callout tone="danger" role="alert"><span data-testid="module-error">{refusalText}</span></Callout>}
      {update && <Callout role="status">{update === "yes" ? (to ? t("modules.updateAvailableTo", { module: name, version: to }) : t("modules.updateAvailable")) : t("modules.upToDate")}</Callout>}
      {update === "yes" && level === "major" && <Callout tone="warn" role="alert">{t("modules.updateMajor")}</Callout>}

      <section className={`${ui.card} space-y-3`}>
        <p className="text-sm">{mod ? L(mod.manifest.description) : t("modules.broken")}</p>
        {advanced && mod && (mod.manifest.offers ?? []).length > 0 && <p className="text-xs text-muted">{t("modules.offers")} : {(mod.manifest.offers ?? []).map((o) => (o.label ? L(o.label) : o.service)).join(", ")}</p>}
        {advanced && mod && mod.manifest.permissions.length > 0 && <p className="text-xs text-muted">{t("modules.permissions")} : {mod.manifest.permissions.join(", ")}</p>}
        {advanced && row.repoUrl && <p className="break-all font-mono text-xs text-muted">{row.repoUrl}{row.ref || row.subdir ? `#${row.ref ?? ""}${row.subdir ? `:${row.subdir}` : ""}` : ""} @ {row.commit?.slice(0, 7)}</p>}
        {isOwner && (
          <div className="flex flex-wrap gap-2 pt-1">
            <ModuleUpdateButton id={row.id} kind="check" labels={{ idle: t("modules.checkUpdate"), working: t("modules.checking"), done: t("modules.checked"), failed: t("modules.updateFailed") }} />
            <ModuleUpdateButton id={row.id} kind="update" labels={{ idle: t("modules.update"), working: t("modules.updating"), done: t("modules.updated"), failed: t("modules.updateFailed") }} />
          </div>
        )}
      </section>

      <ModuleLinksBox id={row.id} name={name} view={links} t={t} names={names} advanced={advanced} isOwner={isOwner} />

      {(mine.length > 0 || canAdd) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("modules.instancesTitle")}</h2>
          {mine.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {mine.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <Link href={`/admin/instances/${i.id}`} className="inline-flex min-h-11 min-w-0 flex-1 items-center break-words font-medium hover:text-accent">{labeler.label(i)}</Link>
                  {advanced && <span className="text-xs text-muted"><span className="font-mono">{i.key}{i.basePath !== null ? ` · /${i.basePath}` : ""}</span></span>}
                </li>
              ))}
            </ul>
          )}
          {canAdd && mod && (
            <form action={addInstance.bind(null, row.id)} className="max-w-xl space-y-2">
              {/* Dès la 2e instance, un surnom devient utile pour les distinguer : on le demande ici (et pour la 1re, si elle n'en a pas). */}
              {mine.length > 0 && (
                <>
                  {mine.filter((m) => !m.nickname).map((m) => (
                    <label key={m.id} className="block text-sm">
                      <span className={ui.label}>{t("instances.nicknameExisting", { name: pickName(m, locale, config.defaultLocale) })}</span>
                      <input name={`nickname_${m.id}`} required maxLength={40} defaultValue={pickName(m, locale, config.defaultLocale)} className={ui.input} />
                    </label>
                  ))}
                  <label className="block text-sm">
                    <span className={ui.label}>{t("instances.nicknameNew")}</span>
                    <input name="nickname" required maxLength={40} placeholder={t("instances.nicknamePlaceholder")} className={ui.input} />
                    <span className={ui.help}>{t("instances.nicknameHelp")}</span>
                  </label>
                </>
              )}
              <button className={ui.btn}>+ {advanced ? (hasPage(mod.manifest) || mod.manifest.content ? t("instances.add") : t("instances.addPlain")) : t("instances.addSimple", { name: L(mod.manifest.name) })}</button>
            </form>
          )}
        </section>
      )}

      <KeptData t={t} locale={locale} name={name} kept={kept} />

      {isOwner && <ModuleMaintenance row={row} name={name} advanced={advanced} t={t} />}

      {isOwner && (
        <RemoveSection t={t} title={t(advanced ? "modules.dangerTitle" : "remove.title")} intro={t(advanced ? "remove.introModuleAdvanced" : "remove.introModule", { name })} name={name}
          keep={uninstallModuleAction.bind(null, row.id, true)} erase={uninstallModuleAction.bind(null, row.id, false)} />
      )}
    </div>
  );
}
