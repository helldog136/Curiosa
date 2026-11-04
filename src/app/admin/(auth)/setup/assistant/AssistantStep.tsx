"use client";

import { useActionState, useRef, useState } from "react";
import { ui } from "@/components/admin/ui";
import { Callout } from "@/components/admin/Page";
import { CopyBlock } from "@/components/admin/CopyBlock";
import { McpConnectGuide, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { PendingButton } from "@/components/admin/PendingButton";
import { useFieldErrorsDom } from "@/components/admin/FieldErrors";
import { submitKeepingValues } from "@/components/admin/keepValues";
import { createSetupAccessAction } from "./actions";

type Profile = { id: "read" | "assistant" | "full"; name: string; lines: string[] };

/**
 * "Connect your AI assistant": two visible fields (the name, prefilled, and the profile, "Read only" by default) and one click. The result stays in this component's
 * state: the connection code is shown once and exists nowhere else.
 */
export function AssistantStep({ baseUrl, backHref, manageHref, guide, profiles, texts, always, copy }: {
  baseUrl: string; backHref: string; manageHref: string; guide: GuideTexts; profiles: Profile[]; texts: Record<string, string>; always: string; copy: { copy: string; copied: string };
}) {
  const [state, run, pending] = useActionState(createSetupAccessAction, null);
  const [profile, setProfile] = useState<Profile["id"]>("read");
  const [name, setName] = useState(texts.nameDefault);
  const form = useRef<HTMLFormElement>(null);
  useFieldErrorsDom(form, state?.errors, state);
  const created = state?.created;
  const chosen = profiles.find((p) => p.id === profile) ?? profiles[0]!;
  const copyProps = { copyLabel: copy.copy, copiedLabel: copy.copied };

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <div className={`${ui.card} space-y-6 !p-6 sm:!p-9`} data-testid="setup-assistant">
        <header className="space-y-2">
          <p><span className={ui.chip}>{texts.optional}</span></p>
          <h1 className="text-3xl font-bold tracking-tight">{texts.title}</h1>
          <p className="text-[17px] leading-7 text-muted">{texts.intro}</p>
        </header>

        {created ? (
          <div className="space-y-5" data-testid="setup-assistant-created">
            <div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <h2 className="text-lg font-semibold">✓ {(texts.created ?? "").replace("{name}", created.name)}</h2>
            </div>
            <CopyBlock text={`${baseUrl}/api/mcp`} label={texts.address} {...copyProps} />
            <div className="space-y-2">
              <CopyBlock text={created.token} label={texts.code} {...copyProps} />
              <Callout tone="warn" testid="setup-assistant-once">{texts.once}</Callout>
              <p className="text-sm text-muted">{texts.remove}</p>
            </div>
            <section aria-labelledby="ai-how" className="space-y-2">
              <h2 id="ai-how" className="text-lg font-semibold">{texts["how.title"]}</h2>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6">
                {["how.l1", "how.l2", "how.l3", "how.l4"].map((k) => <li key={k}>{texts[k]}</li>)}
              </ol>
              <details className="rounded-xl border border-line bg-bg p-4">
                <summary className="cursor-pointer text-[15px] font-medium">{texts["how.ready"]}</summary>
                <div className="mt-3"><McpConnectGuide texts={guide} baseUrl={baseUrl} token={created.token} byUrl={false} /></div>
              </details>
              <p className="text-sm leading-6">{texts.reconnect}</p>
            </section>
            <section className="space-y-1 rounded-2xl bg-accent/5 p-4" aria-labelledby="ai-next">
              <h2 id="ai-next" className="font-semibold">{texts["next.title"]}</h2>
              <p className="text-sm leading-6">{texts.next}</p>
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a href={created.id ? `${manageHref}/${encodeURIComponent(created.id)}` : manageHref} className={ui.btn} data-testid="setup-assistant-manage">{texts.manage}</a>
              <a href={backHref} className={ui.btnPrimary} data-testid="setup-assistant-done">{texts.dashboard} →</a>
            </div>
          </div>
        ) : (
          <form ref={form} onSubmit={submitKeepingValues(run)} className="space-y-5" noValidate>
            <div>
              <label className={ui.label} htmlFor="ai-name">{texts.name}</label>
              <input id="ai-name" name="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="ai-name-example" autoComplete="off" className={ui.input} />
              <p id="ai-name-example" className={ui.help}>{texts.nameExample}</p>
            </div>
            <fieldset className="min-w-0" data-testid="setup-assistant-profiles">
              <legend className={`${ui.label} max-w-full`}>{texts.profile}</legend>
              <div className="flex flex-wrap gap-1.5 rounded-2xl border border-line bg-bg p-1" role="presentation">
                {profiles.map((p) => (
                  <label key={p.id} className="relative flex min-h-11 min-w-[7rem] flex-1 cursor-pointer items-center justify-center rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-surface has-[:checked]:bg-accent has-[:checked]:text-accent-fg has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                    <input type="radio" name="profile" value={p.id} checked={profile === p.id} onChange={() => setProfile(p.id)} className="peer sr-only" />
                    <span className="[overflow-wrap:anywhere]">{p.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2 rounded-2xl border border-line p-4" aria-live="polite" data-testid="setup-assistant-allows">
              <p className="text-sm font-semibold">{texts.allows}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6">{chosen.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="text-sm leading-6 text-muted">{always}</p>
            </div>
            {state?.error && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a href={backHref} className="inline-flex min-h-11 items-center px-1 text-sm text-muted underline underline-offset-2" data-testid="setup-assistant-skip">{texts.skip}</a>
              <PendingButton variant="primary" pending={pending}>{texts.create}</PendingButton>
            </div>
            <p className="text-sm text-muted">{texts.skipNote}</p>
          </form>
        )}
      </div>
    </div>
  );
}
