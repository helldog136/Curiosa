"use client";

import { useActionState, useState } from "react";
import type { CreateTokenState } from "@/app/admin/(panel)/assistants/actions";
import { Callout } from "./Page";
import { CopyBlock } from "./CopyBlock";
import { McpConnectGuide, type GuideTexts } from "./McpConnectGuide";
import { ui } from "./ui";
import { PendingButton } from "./PendingButton";

export type CreatorLabels = {
  name: string; nameHelp: string; submit: string; afterCreate: string;
  createdTitle: string; createdSecret: string; createdUrl: string; createdOnce: string; copy: string; copied: string;
  /** Type d'accès (standard / entretien du site) : textes déjà traduits par la page, selon le mode simple ou avancé. */
  profile: { label: string; standard: string; maintenance: string; help: string; levels: string[]; approval: string; approvalHuman: string; approvalDirect: string; notify: string; notifyAdmin: string; notifyEmail: string };
  /** Plafond : lecture seule, ou lecture et écriture. */
  scope: { label: string; help: string; read: string; write: string };
  /** Connexion par adresse (pour Claude sur claude.ai) : une case en mode avancé, un choix entre deux en mode simple. */
  url: { label: string; help: string; keyLabel: string; keyHelp: string };
  /** Mode simple : ce qu'on dit après la création, sans les blocs de configuration techniques. */
  simpleGuide: { claudeTitle: string; claudeText: string; keyText: string; warn: string };
};

/**
 * Formulaire de création d'un accès. Une fois créé, le secret (clé de connexion, ou adresse secrète si l'option est choisie) s'affiche ICI, une seule fois,
 * avec les consignes de branchement déjà remplies. L'état reste dans ce composant : rien n'est relu depuis la base, rien n'est conservé.
 * Mode simple : des mots de tous les jours et une seule consigne. Mode avancé : tous les blocs de configuration des clients courants.
 */
export function McpTokenCreator({ action, baseUrl, labels, guide, advanced, defaultProfile = "standard" }: { action: (prev: CreateTokenState, form: FormData) => Promise<CreateTokenState>; baseUrl: string; labels: CreatorLabels; guide: GuideTexts; advanced: boolean; defaultProfile?: "standard" | "maintenance" }) {
  const [state, run, pending] = useActionState(action, null);
  const [profile, setProfile] = useState(defaultProfile);
  const maintenance = profile === "maintenance";
  const created = state?.created;
  const copy = { copyLabel: labels.copy, copiedLabel: labels.copied };
  const group = "rounded-xl border border-line p-4";
  const radio = "mt-1 h-4 w-4 shrink-0 accent-[var(--v-accent)]";
  return (
    <div className="space-y-4">
      {created && (
        <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status" data-testid="mcp-created">
          <h3 className="text-base font-semibold">{labels.createdTitle.replace("{name}", created.name)}</h3>
          {advanced ? (
            <>
              <CopyBlock text={created.token} label={labels.createdSecret} {...copy} />
              {created.byUrl && <CopyBlock text={`${baseUrl}/api/mcp/${created.token}`} label={labels.createdUrl} {...copy} />}
            </>
          ) : created.byUrl ? (
            <CopyBlock text={`${baseUrl}/api/mcp/${created.token}`} label={labels.createdUrl} {...copy} />
          ) : (
            <CopyBlock text={created.token} label={labels.createdSecret} {...copy} />
          )}
          <p className="text-sm font-medium">{labels.createdOnce}</p>
          {advanced ? (
            <McpConnectGuide texts={guide} baseUrl={baseUrl} token={created.token} byUrl={created.byUrl} advanced />
          ) : (
            <div className="space-y-2 text-sm leading-6" data-testid="assistants-simple-guide">
              {created.byUrl && <p className="font-semibold">{labels.simpleGuide.claudeTitle}</p>}
              <p>{created.byUrl ? labels.simpleGuide.claudeText : labels.simpleGuide.keyText}</p>
              {created.byUrl && <Callout tone="warn">{labels.simpleGuide.warn}</Callout>}
            </div>
          )}
        </div>
      )}
      {/* `key` : le formulaire est vidé après chaque création. */}
      <form action={run} key={created?.token ?? "new"} className="space-y-4">
        <div>
          <label className={ui.label} htmlFor="mcp-profile">{labels.profile.label}</label>
          <select id="mcp-profile" name="profile" value={profile} onChange={(e) => setProfile(e.target.value === "maintenance" ? "maintenance" : "standard")} className={ui.input}>
            <option value="standard">{labels.profile.standard}</option>
            <option value="maintenance">{labels.profile.maintenance}</option>
          </select>
          {maintenance && (
            <div className="mt-3 space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm" data-testid="mcp-profile-maintenance">
              <p className="leading-6">{labels.profile.help}</p>
              <ul className="space-y-1 leading-6">{labels.profile.levels.map((l, i) => <li key={l}>{i === 0 ? "✅" : "⛔"} {l}</li>)}</ul>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium" htmlFor="mcp-approval">{labels.profile.approval}</label>
                  <select id="mcp-approval" name="approval" defaultValue="human" className={ui.input}>
                    <option value="human">{labels.profile.approvalHuman}</option>
                    <option value="direct">{labels.profile.approvalDirect}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium" htmlFor="mcp-notify">{labels.profile.notify}</label>
                  <select id="mcp-notify" name="notify" defaultValue="admin" className={ui.input}>
                    <option value="admin">{labels.profile.notifyAdmin}</option>
                    <option value="email">{labels.profile.notifyEmail}</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
        <div>
          <label className={ui.label} htmlFor="mcp-name">{labels.name}</label>
          <input id="mcp-name" name="name" required maxLength={80} placeholder="Claude" className={ui.input} />
          <p className={ui.help}>{labels.nameHelp}</p>
        </div>
        <div className={maintenance ? "hidden" : undefined}>
          {advanced ? (
            <>
              <label className={ui.label} htmlFor="scope">{labels.scope.label}</label>
              <select id="scope" name="scope" defaultValue="read" className={ui.input}>
                <option value="read">{labels.scope.read}</option>
                <option value="write">{labels.scope.write}</option>
              </select>
              <p className={ui.help}>{labels.scope.help}</p>
            </>
          ) : (
            <fieldset className={group}>
              <legend className="px-1 text-[15px] font-medium">{labels.scope.label}</legend>
              {(["read", "write"] as const).map((v) => (
                <label key={v} className="flex items-start gap-3 py-1.5 text-sm">
                  <input type="radio" name="scope" value={v} defaultChecked={v === "read"} className={radio} />
                  <span>{labels.scope[v]}</span>
                </label>
              ))}
              <p className={ui.help}>{labels.scope.help}</p>
            </fieldset>
          )}
        </div>
        {advanced ? (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="byUrl" className="h-4 w-4 accent-[var(--v-accent)]" />
              {labels.url.label}
            </label>
            <p className={ui.help}>{labels.url.help}</p>
          </div>
        ) : (
          <fieldset className={group}>
            <legend className="px-1 text-[15px] font-medium">{labels.url.label}</legend>
            <label className="flex items-start gap-3 py-1.5 text-sm">
              <input type="radio" name="byUrl" value="on" defaultChecked className={radio} />
              <span><span className="block">{labels.url.help}</span></span>
            </label>
            <label className="flex items-start gap-3 py-1.5 text-sm">
              <input type="radio" name="byUrl" value="off" className={radio} />
              <span><span className="block">{labels.url.keyLabel}</span><span className="mt-0.5 block text-[13px] leading-5 text-muted">{labels.url.keyHelp}</span></span>
            </label>
          </fieldset>
        )}
        {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
        <PendingButton variant="primary" pending={pending}>{labels.submit}</PendingButton>
      </form>
      <Callout tone="info">{labels.afterCreate}</Callout>
    </div>
  );
}
