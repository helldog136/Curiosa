import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { siteUrl } from "@/core/config";
import { listMcpTools } from "@/core/platform";
import { isMcpEnabled } from "@/core/services/mcp/tokens";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Select, TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";
import { createTokenAction, revokeTokenAction, setMcpEnabled } from "./actions";

export default async function McpPage() {
  const { t, advanced } = await adminCtx("owner");
  const enabled = await isMcpEnabled();
  const tokens = await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } });
  const tools = enabled ? await listMcpTools() : [];
  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("mcp.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("mcp.intro")}</p>
      </div>

      <section className={`${ui.card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium">{enabled ? t("mcp.on") : t("mcp.off")}</p>
          <form action={setMcpEnabled.bind(null, !enabled)}>
            <button className={enabled ? ui.btnDanger : ui.btnPrimary}>{enabled ? t("action.disable") : t("action.enable")}</button>
          </form>
        </div>
        {enabled && <p className="text-sm">{t("mcp.endpoint")} : <code className="break-all font-mono">{siteUrl}/api/mcp</code></p>}
        <p className="text-xs text-muted">{t("mcp.safety")}</p>
      </section>

      {enabled && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("mcp.tokens")}</h2>
            <table className="w-full">
              <thead><tr><th className={ui.th}>{t("field.name")}</th><th className={ui.th}>{t("mcp.scope")}</th><th className={ui.th}>{t("mcp.lastUsed")}</th><th className={ui.th} /></tr></thead>
              <tbody>
                {tokens.map((k) => (
                  <tr key={k.id} className={`border-t border-line ${k.revokedAt ? "opacity-50" : ""}`}>
                    <td className={ui.td}><a href={`/admin/mcp/${k.id}`} className="font-medium hover:text-accent">{k.name}</a> <span className="font-mono text-xs text-muted">{k.prefix}…</span></td>
                    <td className={ui.td}>{t(`mcp.scope.${k.scope}`)}</td>
                    <td className={ui.td}>{k.revokedAt ? t("mcp.revoked") : date(k.lastUsedAt)}</td>
                    <td className={`${ui.td} flex gap-2`}>{!k.revokedAt && <a href={`/admin/mcp/${k.id}`} className={ui.btn}>{t("mcp.access")}</a>}{!k.revokedAt && <form action={revokeTokenAction.bind(null, k.id)}><ConfirmButton message={t("confirm.delete")}>{t("mcp.revoke")}</ConfirmButton></form>}</td>
                  </tr>
                ))}
                {tokens.length === 0 && <tr><td colSpan={4} className={`${ui.td} text-muted`}>{t("mcp.noTokens")}</td></tr>}
              </tbody>
            </table>
            <div className={`${ui.card} space-y-4`}>
              <h3 className="font-semibold">{t("mcp.newToken")}</h3>
              <ActionForm action={createTokenAction} submitLabel={t("action.create")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField name="name" label={t("field.name")} required placeholder="Claude" />
                  <Select name="scope" label={t("mcp.scope")} defaultValue="read" help={t("mcp.scopeHelp")}
                    options={[{ value: "read", label: t("mcp.scope.read") }, { value: "write", label: t("mcp.scope.write") }]} />
                </div>
              </ActionForm>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("mcp.tools")} ({tools.length})</h2>
            <p className="text-sm text-muted">{t("mcp.toolsHelp")}</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {tools.map((tool) => (
                <li key={tool.name} className="space-y-0.5 px-4 py-3 text-sm">
                  <p><span className="font-mono">{tool.name}</span> <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>{tool.readOnly ? t("mcp.scope.read") : t("mcp.scope.write")}</span></p>
                  {advanced && <p className="text-muted">{tool.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
