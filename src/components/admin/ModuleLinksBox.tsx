import type { Translator } from "@/core/i18n/dictionary";
import type { ModuleLinksView } from "@/core/modules/dependencyView";
import { describeMissing, type Names } from "@/core/modules/dependencyMessages";
import { Callout } from "./Page";
import { ui } from "./ui";
import { cleanupAutoModuleAction, keepAutoModuleAction, repairModuleAction } from "@/app/admin/(panel)/modules/actions";
import { RemoveChoices } from "./RemoveSection";

/**
 * Sur la page d'un module : « A besoin de » (et qui le fournit), « Utilisé par », « Installé automatiquement pour », ce qui manque (avec le bouton
 * pour le mettre en place) et le nettoyage proposé quand plus personne n'utilise un module installé automatiquement. Mise en page seulement.
 */
export function ModuleLinksBox({ id, name, view, t, names, advanced, isOwner }: { id: string; name: string; view: ModuleLinksView; t: Translator; names: Names; advanced: boolean; isOwner: boolean }) {
  const hasLinks = view.needs.length > 0 || view.usedBy.length > 0 || view.autoFor !== null;
  if (!hasLinks && !view.cleanup) return null;
  return (
    <section className="space-y-4" data-testid="module-links">
      {view.gaps.length > 0 && (
        <Callout tone="warn" role="alert">
          <p className="font-medium" data-testid="module-missing">{t("deps.missing.block", { list: "" }).replace(/\s*$/, "")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{view.gaps.map((g) => <li key={g.service}>{describeMissing(g, t, names)}</li>)}</ul>
          <p className="mt-2 text-sm text-muted">{t("deps.missing.help")}</p>
          {isOwner && <form action={repairModuleAction.bind(null, id)} className="mt-3"><button className={ui.btnPrimary}>{t("deps.repair")}</button></form>}
        </Callout>
      )}
      {view.cleanup && isOwner && (
        <Callout tone="info" role="status">
          <p className="font-medium">🧹 {t("deps.cleanup.title")}</p>
          <p className="mt-1 text-sm">{t("deps.cleanup.text", { name })}</p>
          {view.cleanup.hasData && <p className="mt-1 text-sm text-muted">{t("deps.cleanup.data")}</p>}
          <div className="mt-3 space-y-3">
            <RemoveChoices t={t} name={name} keep={cleanupAutoModuleAction.bind(null, id, true)} erase={cleanupAutoModuleAction.bind(null, id, false)} />
            <form action={keepAutoModuleAction.bind(null, id)}><button className={ui.btn}>{t("deps.cleanup.keep")}</button></form>
          </div>
        </Callout>
      )}
      {hasLinks && (
        <div className={`${ui.card} space-y-4`}>
          {view.autoFor !== null && <p className="text-sm" data-testid="module-auto-for">🧩 {view.autoFor.length ? t("deps.auto.for", { names: view.autoFor.join(", ") }) : t("deps.auto.forUnknown")}</p>}
          {view.needs.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("deps.links.needs")}</h2>
              <ul className="mt-2 space-y-1.5 text-sm" data-testid="module-needs">
                {view.needs.map((n) => (
                  <li key={n.service} className="flex flex-wrap items-center gap-x-2">
                    <span aria-hidden>{n.ok ? "✔" : n.optional ? "○" : "⚠"}</span>
                    <span className="font-medium">{n.label}</span>
                    {n.optional && <span className="text-xs text-muted">{t("deps.links.optional")}</span>}
                    <span className="text-muted">
                      {n.providers.length ? t("deps.links.providedBy", { names: n.providers.map((p) => p.active ? p.name : `${p.name} (${t("deps.links.off")})`).join(", ") }) : t("deps.links.noProvider")}
                    </span>
                    {advanced && <span className="font-mono text-xs text-muted">{n.service}{n.min > 1 ? ` ≥ ${n.min}` : ""}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.usedBy.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("deps.links.usedBy")}</h2>
              <ul className="mt-2 space-y-1.5 text-sm" data-testid="module-used-by">
                {view.usedBy.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-2">
                    <a href={`/admin/modules/${encodeURIComponent(u.id)}`} className="font-medium hover:text-accent">{u.name}</a>
                    <span className="text-muted">· {u.services.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
