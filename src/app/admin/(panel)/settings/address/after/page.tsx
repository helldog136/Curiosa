import { ASSISTANTS_HREF } from "@/core/adminLinks";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { buildChecklist } from "@/core/domainChecklist";
import { afterTasks, getAfterTicks, runAfterChecks, type AfterTask, type CheckResult } from "@/core/domainChecks";
import { hostOfUrl, parseLegacyHosts } from "@/core/siteAddress";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { CopyBlock } from "@/components/admin/CopyBlock";
import { PendingButton } from "@/components/admin/PendingButton";
import { TaskTick } from "@/components/admin/TaskTick";
import { ui } from "@/components/admin/ui";
import { setAfterTask } from "../actions";
import { ACCOUNT_HREF, OVERLAY_PAGES_HREF, SETTINGS_ADDRESS_AFTER_HREF, SETTINGS_ADDRESS_HREF, SETTINGS_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

const CHIP = { ok: ui.chipOk, warn: ui.chipWarn, fail: ui.chipDanger, skipped: ui.chip } as const;

export default async function AfterChangePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale, config, advanced } = await adminCtx("admin");
  if (!advanced) redirect(SETTINGS_HREF);
  const sp = await searchParams;
  const run = (Array.isArray(sp.run) ? sp.run[0] : sp.run) === "1";
  const legacy = parseLegacyHosts(process.env.LEGACY_HOSTS, hostOfUrl(siteUrl)).hosts;
  const hostHeader = (await headers()).get("host");
  // À la demande seulement : aucun appel sortant tant que la personne n'a pas cliqué sur « Lancer le contrôle ».
  const results: CheckResult[] | null = run ? await runAfterChecks({ siteUrl, hostHeader, legacy }) : null;
  const checklist = await buildChecklist({ oldBase: legacy[0] ? `https://${legacy[0]}` : siteUrl, newBase: siteUrl, oldHost: legacy[0] ?? "", locale, defaultLocale: config.defaultLocale });
  const tasks = afterTasks(checklist);
  const done = new Set(await getAfterTicks());
  const left = tasks.filter((x) => !done.has(x.id)).length;
  const cp = { copyLabel: t("domain.copy"), copiedLabel: t("domain.copied") };

  const taskTitle = (task: AfterTask): string => {
    if (task.kind === "returns") { const r = checklist.returns.find((x, i) => task.id === `return:${x.instanceKey}:${i}`); return t("domain.check.returns", { service: r?.service ?? "", instance: r?.instance ?? "" }); }
    if (task.kind === "uses") { const u = checklist.uses.find((x, i) => task.id === `use:${x.instanceKey}:${i}`); return t("domain.check.uses", { label: u?.label ?? "", instance: u?.instance ?? "" }); }
    if (task.kind === "content") return t("domain.after.content", { n: task.count });
    return t(`domain.after.${task.kind}`, { n: task.count });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("domain.after.title")} intro={t("domain.after.intro")} />
      <Panel title={t("domain.after.checks")} help={t("domain.after.checksHelp")} testid="domain-after-checks">
        <form method="get" action={SETTINGS_ADDRESS_AFTER_HREF}>
          <input type="hidden" name="run" value="1" />
          <PendingButton variant="primary" pendingLabel={t("domain.after.running")}>{results ? t("domain.after.again") : t("domain.after.run")}</PendingButton>
        </form>
        {results && (
          <ul className="divide-y divide-line rounded-2xl border border-line" data-testid="domain-results">
            {results.map((r, i) => (
              <li key={`${r.id}-${i}`} className="flex flex-wrap items-start gap-2 px-5 py-3.5 sm:px-6" data-testid={`result-${r.id}`} data-status={r.status}>
                <span className={CHIP[r.status]}>{t(`domain.status.${r.status}`)}</span>
                <p className="min-w-0 flex-1 text-sm leading-6">{t(`domain.check.${r.id}.${r.status}`, { ...(r.params ?? {}), reason: r.params?.reason ? t(`domain.reason.${r.params.reason}`) : "" })}</p>
              </li>
            ))}
          </ul>
        )}
        {results && <p className="text-sm text-muted">{t("domain.after.checksNote")}</p>}
      </Panel>

      <Panel title={t("domain.after.tasks")} help={tasks.length > 0 ? t("domain.after.tasksHelp", { n: left }) : undefined} testid="domain-after-tasks">
        {tasks.length === 0 ? <Callout tone="ok" role="status">✔ {t("domain.after.tasksNone")}</Callout> : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {tasks.map((task) => {
              const r = task.kind === "returns" ? checklist.returns.find((x, i) => task.id === `return:${x.instanceKey}:${i}`) : undefined;
              return (
                <TaskTick key={task.id} id={task.id} done={done.has(task.id)} title={taskTitle(task)} failed={t("domain.after.failed")} action={setAfterTask}>
                  <p className="text-sm leading-6 text-muted">{task.kind === "uses" ? checklist.uses.find((x, i) => task.id === `use:${x.instanceKey}:${i}`)?.where : t(`domain.after.${task.kind}Help`)}</p>
                  {r && <CopyBlock text={r.newUrl} label={t("domain.check.returnsNew")} {...cp} />}
                  {task.kind === "passkeys" && <Link href={ACCOUNT_HREF} className="text-sm font-medium text-accent hover:underline">{t("domain.after.passkeysOpen")} →</Link>}
                  {task.kind === "overlays" && <Link href={OVERLAY_PAGES_HREF} className="text-sm font-medium text-accent hover:underline">{t("domain.check.overlaysOpen")} →</Link>}
                  {task.kind === "assistants" && <Link href={ASSISTANTS_HREF} className="text-sm font-medium text-accent hover:underline">{t("domain.check.assistantsOpen")} →</Link>}
                  {task.kind === "content" && (
                    <ul className="divide-y divide-line rounded-xl border border-line text-sm" data-testid="content-hits">
                      {checklist.content.hits.map((h, i) => (
                        <li key={`${h.href}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="min-w-0 break-words"><span className="text-muted">{t(`domain.content.${h.kind}`)}</span>{h.title && <> · <span className="font-medium">{h.title}</span></>}{h.detail && <span className="text-muted"> · {h.detail}</span>}</span>
                          <Link href={h.href} className="shrink-0 font-medium text-accent hover:underline">{t("domain.content.open")} →</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </TaskTick>
              );
            })}
          </ul>
        )}
      </Panel>
      <p><Link href={SETTINGS_ADDRESS_HREF} className="text-sm underline hover:text-accent">← {t("domain.title")}</Link></p>
    </div>
  );
}
