import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { buildChecklist } from "@/core/domainChecklist";
import { detectServerContext, migrationCommands } from "@/core/domainCommands";
import { hostOfUrl, hostProblem, parseLegacyHosts, parseSiteAddress, visitedAddress } from "@/core/siteAddress";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { CopyBlock } from "@/components/admin/CopyBlock";
import { TextField } from "@/components/admin/Field";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import type { Translator } from "@/core/i18n/dictionary";
import type { Checklist } from "@/core/domainChecklist";
import type { MigrationCommands } from "@/core/domainCommands";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const HERE = "/admin/settings/address";

export default async function AddressPage({ searchParams }: { searchParams: Search }) {
  const { t, locale, config, advanced } = await adminCtx("admin");
  // Réglage AVANCÉ : en mode simple la page n'existe pas (retour sans erreur vers les réglages du site).
  if (!advanced) redirect("/admin/settings");
  const sp = await searchParams;
  const toRaw = first(sp.to);
  const asked = toRaw !== undefined;
  const parsed = asked ? parseSiteAddress(toRaw) : null;
  const target = parsed?.ok ? parsed : null;
  const asked1 = first(sp.step);
  const step = target ? (asked1 === "1" ? 1 : asked1 === "3" ? 3 : 2) : 1;
  const oldHost = hostOfUrl(siteUrl);
  const legacy = parseLegacyHosts(process.env.LEGACY_HOSTS, oldHost);
  const visit = visitedAddress((await headers()).get("host"), siteUrl);
  const same = !!target && target.url === siteUrl;
  const checklist = target ? await buildChecklist({ oldBase: siteUrl, newBase: target.url, oldHost, locale, defaultLocale: config.defaultLocale }) : null;
  const toDo = checklist ? countToDo(checklist) : 0;
  const applied = !!target && same;

  return (
    <div className="space-y-6">
      <PageHeader title={t("domain.title")} intro={t("domain.intro")} />
      <Panel title={t("domain.current.title")} testid="domain-current">
        <p className="break-all text-lg font-semibold" data-testid="domain-current-url">{siteUrl}</p>
        {visit.same === true && <Callout tone="ok" role="status">✔ {t("domain.current.same")}</Callout>}
        {visit.same === false && <Callout tone="warn" role="status" testid="domain-mismatch">{t("domain.current.differs", { visited: visit.visited ?? "", host: visit.configured })}</Callout>}
        {visit.same === null && <Callout role="status">{t("domain.current.local")}</Callout>}
        {hostProblem(oldHost) === null && !siteUrl.startsWith("https://") && <Callout tone="warn" role="status">{t("domain.current.http")}</Callout>}
        {legacy.hosts.length > 0 && <p className="text-sm text-muted" data-testid="domain-legacy">{t("domain.current.legacy", { n: legacy.hosts.length, list: legacy.hosts.join(", ") })}</p>}
        {(legacy.rejected.length > 0 || legacy.truncated) && <Callout tone="warn" role="status">{t("domain.current.legacyIgnored", { list: legacy.rejected.join(", ") })}</Callout>}
      </Panel>

      <Panel title={t("domain.wizard.title")} help={t("domain.wizard.help")}>
        <ol className="grid gap-3 sm:grid-cols-3" aria-label={t("domain.wizard.title")} data-testid="domain-steps">
          {[1, 2, 3].map((n) => {
            const state = n < step || (n === 3 && applied && step === 3) ? "done" : n === step ? "current" : "todo";
            const detail = n === 1 ? (target ? target.host : t("domain.step.1.todo"))
              : n === 2 ? (!target ? t("domain.step.2.todo") : t("domain.step.2.count", { n: toDo }))
              : (!target ? t("domain.step.3.todo") : applied ? t("domain.step.3.applied") : t("domain.step.3.ready"));
            return (
              <li key={n} aria-current={state === "current" ? "step" : undefined} data-state={state}
                className={`rounded-xl border p-3 ${state === "current" ? "border-accent ring-1 ring-accent" : "border-line"}`}>
                <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs text-accent">{state === "done" ? "✔" : n}</span>{t(`domain.step.${n}`)}</p>
                <p className="mt-1 break-words text-sm text-muted"><span className="sr-only">{t(`domain.state.${state}`)} : </span>{detail}</p>
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <form method="get" action={HERE} className="space-y-4" data-testid="domain-step1">
            <input type="hidden" name="step" value="2" />
            <TextField name="to" label={t("domain.new.label")} defaultValue={asked ? toRaw : ""} example={t("domain.new.example")} placeholder="https://monsite.be" autoComplete="off" inputMode="url"
              error={parsed && !parsed.ok ? t(`domain.new.error.${parsed.error}`) : undefined}
              inputProps={{ autoFocus: !!parsed && !parsed.ok, spellCheck: false, maxLength: 300 }} />
            <PendingButton variant="primary">{t("domain.new.submit")}</PendingButton>
          </form>
        )}

        {step === 2 && target && checklist && <Step2 t={t} checklist={checklist} oldHost={oldHost} newHost={target.host} same={same} next={`${HERE}?${new URLSearchParams({ to: target.url, step: "3" })}`} back={`${HERE}?${new URLSearchParams({ to: target.url, step: "1" })}`} />}
        {step === 3 && target && <Step3 t={t} oldHost={oldHost} newHost={target.host} newUrl={target.url} applied={applied} legacyList={legacy.hosts} back={`${HERE}?${new URLSearchParams({ to: target.url, step: "2" })}`} />}
      </Panel>
    </div>
  );
}

function countToDo(c: Checklist): number {
  return (c.passkeys.keys > 0 ? 1 : 0) + c.returns.length + c.uses.length + (c.assistants.active > 0 ? 1 : 0) + (c.overlays.pages + c.overlays.sources > 0 ? 1 : 0) + (c.shortLinks.total > 0 ? 1 : 0) + (c.content.hits.length > 0 ? 1 : 0) + 1;
}

const copy = (t: Translator) => ({ copyLabel: t("domain.copy"), copiedLabel: t("domain.copied") });

function Row({ t, todo, title, children, testid }: { t: Translator; todo: boolean; title: string; children?: React.ReactNode; testid?: string }) {
  return (
    <li className="space-y-2 px-5 py-4 sm:px-6" data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={todo ? ui.chipWarn : ui.chipOk}>{todo ? t("domain.row.todo") : `✔ ${t("domain.row.none")}`}</span>
        <h3 className="min-w-0 flex-1 font-medium">{title}</h3>
      </div>
      {children}
    </li>
  );
}

function Step2({ t, checklist: c, oldHost, newHost, same, next, back }: { t: Translator; checklist: Checklist; oldHost: string; newHost: string; same: boolean; next: string; back: string }) {
  const cp = copy(t);
  const small = "text-sm leading-6 text-muted";
  return (
    <div className="space-y-5" data-testid="domain-step2">
      <div>
        <h2 className="text-lg font-semibold">{t("domain.check.title")}</h2>
        <p className={small}>{t("domain.check.intro", { old: oldHost, new: newHost })}</p>
      </div>
      {same && <Callout tone="warn" role="status" testid="domain-same">{t("domain.new.same")}</Callout>}
      <ul className="divide-y divide-line rounded-2xl border border-line">
        <Row t={t} todo={c.passkeys.keys > 0} title={t("domain.check.passkeys", { n: c.passkeys.keys })} testid="check-passkeys">
          <p className={small}>{c.passkeys.keys > 0 ? t("domain.check.passkeysHelp") : t("domain.check.passkeysNone")}</p>
        </Row>
        <Row t={t} todo={c.shortLinks.total > 0} title={t("domain.check.shortLinks", { n: c.shortLinks.total })} testid="check-shortlinks">
          <p className={small}>{c.shortLinks.total > 0 ? t("domain.check.shortLinksHelp") : t("domain.check.shortLinksNone")}</p>
          {c.shortLinks.total > 0 && <Link href="/admin/redirects" className="text-sm font-medium text-accent hover:underline">{t("domain.check.shortLinksOpen")} →</Link>}
        </Row>
        {c.returns.length === 0 && <Row t={t} todo={false} title={t("domain.check.returnsNone")} testid="check-returns" />}
        {c.returns.map((r, i) => (
          <Row key={`${r.instanceKey}-${i}`} t={t} todo title={t("domain.check.returns", { service: r.service, instance: r.instance })} testid="check-returns">
            {r.where && <p className={small}>{t("domain.check.returnsWhere", { service: r.service, where: r.where })}</p>}
            <CopyBlock text={r.oldUrl} label={t("domain.check.returnsOld")} {...cp} />
            <CopyBlock text={r.newUrl} label={t("domain.check.returnsNew")} {...cp} />
            <Link href={r.href} className="text-sm font-medium text-accent hover:underline">{t("domain.check.openInstance", { instance: r.instance })} →</Link>
          </Row>
        ))}
        {c.uses.map((u, i) => (
          <Row key={`${u.instanceKey}-${i}`} t={t} todo title={t("domain.check.uses", { label: u.label, instance: u.instance })} testid="check-uses">
            <p className={small}>{u.where}</p>
            <CopyBlock text={`https://${newHost}`} label={t("domain.check.usesChange")} {...cp} />
          </Row>
        ))}
        <Row t={t} todo={c.assistants.active > 0} title={t("domain.check.assistants", { n: c.assistants.byAddress })} testid="check-assistants">
          <p className={small}>{c.assistants.active > 0 ? t("domain.check.assistantsHelp", { active: c.assistants.active, old: oldHost }) : t("domain.check.assistantsNone")}</p>
          {c.assistants.active > 0 && <Link href="/admin/assistants" className="text-sm font-medium text-accent hover:underline">{t("domain.check.assistantsOpen")} →</Link>}
        </Row>
        <Row t={t} todo={c.overlays.pages + c.overlays.sources > 0} title={t("domain.check.overlays", { n: c.overlays.pages + c.overlays.sources })} testid="check-overlays">
          <p className={small}>{c.overlays.pages + c.overlays.sources > 0 ? t("domain.check.overlaysHelp") : t("domain.check.overlaysNone")}</p>
          {c.overlays.pages > 0 && <Link href="/admin/overlay-pages" className="text-sm font-medium text-accent hover:underline">{t("domain.check.overlaysOpen")} →</Link>}
        </Row>
        <Row t={t} todo title={t("domain.check.sessions")} testid="check-sessions"><p className={small}>{t("domain.check.sessionsHelp")}</p></Row>
        <Row t={t} todo title={t("domain.check.search")} testid="check-search"><p className={small}>{t("domain.check.searchHelp")}</p></Row>
        <Row t={t} todo={c.content.hits.length > 0} title={c.content.hits.length > 0 ? t("domain.check.content", { n: c.content.hits.length, host: oldHost }) : t("domain.check.contentNone", { host: oldHost })} testid="check-content">
          {c.content.hits.length > 0 && (
            <>
              <p className={small}>{t("domain.check.contentHelp")}</p>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm" data-testid="content-hits">
                {c.content.hits.map((h, i) => (
                  <li key={`${h.href}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 break-words"><span className="text-muted">{t(`domain.content.${h.kind}`)}</span>{h.title && <> · <span className="font-medium">{h.title}</span></>}{h.detail && <span className="text-muted"> · {h.detail}</span>}</span>
                    <Link href={h.href} className="shrink-0 font-medium text-accent hover:underline">{t("domain.content.open")} →</Link>
                  </li>
                ))}
              </ul>
              {c.content.more && <p className={small}>{t("domain.check.contentMore")}</p>}
            </>
          )}
        </Row>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={next} className={ui.btnPrimary} data-testid="domain-next">{t("domain.step2.next")}</Link>
        <Link href={back} className="text-sm underline hover:text-accent">{t("domain.step2.back")}</Link>
      </div>
    </div>
  );
}

function Step3({ t, oldHost, newHost, newUrl, applied, legacyList, back }: { t: Translator; oldHost: string; newHost: string; newUrl: string; applied: boolean; legacyList: string[]; back: string }) {
  const cp = copy(t);
  const server = detectServerContext(process.env, process.cwd(), legacyList);
  const cmd: MigrationCommands = migrationCommands({ oldHost, newHost, newUrl, server });
  const small = "text-sm leading-6 text-muted";
  const scriptSite = server.siteName;
  return (
    <div className="space-y-6" data-testid="domain-step3">
      <div>
        <h2 className="text-lg font-semibold">{t("domain.cmd.title")}</h2>
        <p className={small}>{t("domain.cmd.intro")}</p>
      </div>
      {applied ? <Callout tone="ok" role="status" testid="domain-applied">✔ {t("domain.cmd.applied")}</Callout> : <Callout role="status">{t("domain.cmd.pending")}</Callout>}
      <ol className="space-y-6">
        <li className="space-y-2"><h3 className="font-medium">1. {t("domain.cmd.dns")}</h3><p className={small}>{t("domain.cmd.dnsHelp", { new: newHost, old: oldHost })}</p></li>
        <li className="space-y-2">
          <h3 className="font-medium">2. {t("domain.cmd.env")}</h3>
          <p className={small}>{cmd.folderKnown ? t("domain.cmd.envHelp") : t("domain.cmd.envHelpUnknown")}</p>
          <CopyBlock text={cmd.env} {...cp} />
          {scriptSite && (
            <details className="rounded-xl border border-line p-3 text-sm">
              <summary className="cursor-pointer font-medium">{t("domain.cmd.script")}</summary>
              <p className={`${small} mt-2`}>{t("domain.cmd.scriptHelp")}</p>
              <div className="mt-2"><CopyBlock text={`sudo bash install.sh --site ${scriptSite} --change-domain ${newHost}`} label={t("domain.cmd.scriptPreview")} {...cp} /></div>
              <div className="mt-2"><CopyBlock text={`sudo bash install.sh --site ${scriptSite} --change-domain ${newHost} --apply`} label={t("domain.cmd.scriptApply")} {...cp} /></div>
            </details>
          )}
        </li>
        <li className="space-y-2">
          <h3 className="font-medium">3. {t("domain.cmd.restart")}</h3>
          {cmd.restart.kind === "manual" ? <p className={small}>{t("domain.cmd.restartManual")}</p> : <><p className={small}>{t(`domain.cmd.restart.${cmd.restart.kind}`)}</p><CopyBlock text={cmd.restart.text} {...cp} /></>}
        </li>
        <li className="space-y-3">
          <h3 className="font-medium">4. {t("domain.cmd.proxy")}</h3>
          <p className={small}>{t("domain.cmd.proxyHelp", { new: newHost, old: oldHost })}</p>
          {(["nginx", "caddy", "apache"] as const).map((p) => (
            <details key={p} className="rounded-xl border border-line p-3" data-testid={`proxy-${p}`}>
              <summary className="cursor-pointer text-sm font-medium">{t(`domain.cmd.proxy.${p}`)}</summary>
              <div className="mt-3 space-y-3">
                <CopyBlock text={cmd[p].keep} label={t("domain.cmd.proxyKeep")} {...cp} />
                <details className="text-sm"><summary className="cursor-pointer text-muted">{t("domain.cmd.proxyOther")}</summary>
                  <div className="mt-2 space-y-2"><p className={small}>{t("domain.cmd.proxyOtherHelp")}</p><CopyBlock text={cmd[p].redirect} {...cp} /></div>
                </details>
              </div>
            </details>
          ))}
        </li>
        <li className="space-y-2">
          <h3 className="font-medium">5. {t("domain.cmd.cert")}</h3>
          <p className={small}>{t("domain.cmd.certHelp")}</p>
          <CopyBlock text={cmd.nginx.certificate} label={t("domain.cmd.certNginx")} {...cp} />
          <CopyBlock text={cmd.apache.certificate} label={t("domain.cmd.certApache")} {...cp} />
          <p className={small}>{t("domain.cmd.certCaddy")}</p>
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/settings/address/after" className={ui.btnPrimary} data-testid="domain-after">{t("domain.step3.next")}</Link>
        <Link href={back} className="text-sm underline hover:text-accent">{t("domain.step3.back")}</Link>
      </div>
    </div>
  );
}
