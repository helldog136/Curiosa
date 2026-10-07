import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { listInstances, pickName } from "@/core/instances";
import { listMcpToolCatalogue } from "@/core/platform";
import { getActiveInstances } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { canUse, isGranted, parseGrants, withinCeiling } from "@/core/services/mcp/access";
import { GrantToggle } from "@/components/admin/GrantToggle";
import { ui } from "@/components/admin/ui";
import { resetGrantsAction, setGrantAction } from "../actions";

/** Accès d'un jeton, action par action, module par module. Modifiable en direct. */
export default async function TokenAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale, config, advanced } = await adminCtx("owner");
  const { id } = await params;
  const row = await prisma.apiToken.findUnique({ where: { id } });
  if (!row) notFound();
  const token = { scope: row.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(row.grants) };
  const revoked = !!row.revokedAt;

  const catalogue = await listMcpToolCatalogue();
  const active = await getActiveInstances();
  const instances = await listInstances();

  // Regroupement par source : la plateforme, puis chaque instance de module.
  const groups = new Map<string, typeof catalogue>();
  for (const tool of catalogue) groups.set(tool.source, [...(groups.get(tool.source) ?? []), tool]);
  const allowedCount = catalogue.filter((x) => !x.instanceOptedOut && canUse(x, token)).length;

  return (
    <div className="space-y-6">
      <div>
        <a href="/admin/mcp" className="text-sm text-muted hover:text-accent">← {t("mcp.title")}</a>
        <h1 className="mt-1 text-2xl font-bold">{row.name} <span className="font-mono text-base text-muted">{row.prefix}…</span></h1>
        <p className="mt-1 text-sm text-muted">
          {t(`mcp.scope.${token.scope}`)} · {t("mcp.allowedCount", { n: allowedCount, total: catalogue.filter((x) => !x.instanceOptedOut).length })}
        </p>
        {revoked && <p className="mt-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t("mcp.revoked")}</p>}
        <p className="mt-3 text-sm">{t("mcp.accessIntro")}</p>
        {token.scope === "read" && <p className="mt-2 rounded-lg border border-line bg-surface p-3 text-sm">{t("mcp.readCeiling")}</p>}
      </div>

      {[...groups.entries()].map(([source, tools]) => {
        const inst = instances.find((i) => i.key === source);
        const mod = active.find((a) => a.instance.key === source)?.mod;
        const title = source === "core" ? t("mcp.platform") : `${mod?.manifest.icon ?? "🧩"} ${inst ? pickName(inst, locale, config.defaultLocale) : source}`;
        return (
          <section key={source} className={`${ui.card} space-y-3`} aria-label={title}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {title}
                {mod && advanced && <span className="ml-2 text-xs font-normal text-muted">{localized(mod.manifest.name, locale, config.defaultLocale)} · {source}</span>}
              </h2>
              {source !== "core" && !revoked && (
                <div className="flex gap-2">
                  <form action={resetGrantsAction.bind(null, id, source, "defaults")}><button className={ui.btn}>{t("mcp.resetDefaults")}</button></form>
                  <form action={resetGrantsAction.bind(null, id, source, "none")}><button className={ui.btn}>{t("mcp.disableAll")}</button></form>
                </div>
              )}
            </div>
            {tools[0]?.instanceOptedOut && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{t("mcp.instanceOptedOut")}</p>}
            <ul className="divide-y divide-line">
              {tools.map((tool) => {
                const ceilingBlocks = !withinCeiling(tool, token.scope);
                const effective = !ceilingBlocks && isGranted(tool, token.grants);
                const short = tool.name.includes("__") ? tool.name.split("__")[1]! : tool.name;
                return (
                  <li key={tool.name} className="flex items-start gap-4 py-3">
                    <div className="pt-0.5">
                      <GrantToggle
                        label={`${title} — ${short}`}
                        checked={effective}
                        disabled={revoked || ceilingBlocks || tool.instanceOptedOut}
                        confirmMessage={tool.destructive ? t("mcp.confirmDestructive", { action: short }) : undefined}
                        onToggle={setGrantAction.bind(null, id, tool.name)}
                      />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p>
                        <span className="font-mono">{short}</span>{" "}
                        <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${tool.destructive ? "bg-red-500/20 text-red-700" : tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>
                          {tool.destructive ? t("mcp.destructive") : tool.readOnly ? t("mcp.action.read") : t("mcp.action.write")}
                        </span>
                        <span className="ml-1 text-xs text-muted">{tool.default ? t("mcp.onByDefault") : t("mcp.offByDefault")}</span>
                      </p>
                      {advanced && <p className="mt-0.5 text-muted">{tool.description}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {!revoked && (
        <form action={resetGrantsAction.bind(null, id, null, "defaults")} className="border-t border-line pt-4">
          <button className={ui.btn}>{t("mcp.resetAll")}</button>
        </form>
      )}
    </div>
  );
}
