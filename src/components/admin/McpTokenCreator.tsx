"use client";

import { useActionState, useMemo, useState } from "react";
import type { CreateTokenState } from "@/app/admin/(panel)/assistants/actions";
import { Callout } from "./Page";
import { CopyBlock } from "./CopyBlock";
import { McpConnectGuide, type GuideTexts } from "./McpConnectGuide";
import { ui } from "./ui";
import { PendingButton } from "./PendingButton";
import { submitKeepingValues } from "./keepValues";
import { MoreOptions } from "./MoreOptions";
import { MANAGER_IGNORE, PLAIN_INPUT } from "./managerHints";
import { createGate } from "./singleFlight";

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
  /** Mode compact (page Équipe) : titre et résumé de « Plus d'options ». */
  more?: { title: string; summary: string };
  /** (0.47.0) Every access belongs to a person: the summary line ("Belongs to you") and the label of the select that changes it. */
  owner?: { summary: string; change: string };
};

/** The people who may own an access, for the select under "More options" (only passed to holders of `core:mcp.tokens`). */
export type OwnerChoice = { id: string; label: string };

/** What is shown once after a creation: the secret (or the secret address) and the connection steps. Pure: everything comes from its props, nothing is read back or kept. */
export function CreatedAccess({ created, baseUrl, labels, guide, advanced }: { created: NonNullable<NonNullable<CreateTokenState>["created"]>; baseUrl: string; labels: CreatorLabels; guide: GuideTexts; advanced: boolean }) {
  const copy = { copyLabel: labels.copy, copiedLabel: labels.copied };
  return (
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
  );
}

/**
 * Formulaire de création d'un accès. Une fois créé, le secret (clé de connexion, ou adresse secrète si l'option est choisie) s'affiche ICI, une seule fois,
 * avec les consignes de branchement déjà remplies. L'état reste dans ce composant : rien n'est relu depuis la base, rien n'est conservé.
 * Mode simple : des mots de tous les jours et une seule consigne. Mode avancé : tous les blocs de configuration des clients courants.
 */
export function McpTokenCreator({ action, baseUrl, labels, guide, advanced, defaultProfile = "standard", compact = false, owners = [], ownerId }: { action: (prev: CreateTokenState, form: FormData) => Promise<CreateTokenState>; baseUrl: string; labels: CreatorLabels; guide: GuideTexts; advanced: boolean; defaultProfile?: "standard" | "maintenance"; /** Chemin court : le nom et ce qu'il peut faire ; le type d'assistant et la façon de se connecter sont repliés. */ compact?: boolean; owners?: OwnerChoice[]; /** The signed-in person: the default owner. */ ownerId?: string }) {
  // One creation at a time: a second submit while the first is running (double click, Enter twice, an extension re-dispatching the event) would create a SECOND access
  // and replace the result of the first, whose secret would then never be shown. The gate is not React state: `pending` only changes after the next render.
  const [gate] = useState(createGate);
  const [state, run, pending] = useActionState(useMemo(() => gate.wrap(action), [gate, action]), null);
  // The native submit is always cancelled by `submitKeepingValues`; the gate decides whether this one goes through.
  const submit = (data: FormData) => { if (gate.enter()) run(data); };
  const [profile, setProfile] = useState(defaultProfile);
  const maintenance = profile === "maintenance";
  const created = state?.created;
  const group = "rounded-xl border border-line p-4";
  const radio = "mt-1 h-4 w-4 shrink-0 accent-[var(--v-accent)]";
  const profileBlock = (
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
  );
  const nameBlock = (
        <div>
          <label className={ui.label} htmlFor="mcp-name">{labels.name}</label>
          <input {...PLAIN_INPUT} id="mcp-name" name="accessLabel" required maxLength={80} placeholder="Claude" className={ui.input} />
          <p className={ui.help}>{labels.nameHelp}</p>
        </div>
  );
  const scopeBlock = (
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
  );
  const ownerBlock = labels.owner && owners.length > 1 ? (
    <div>
      <label className={ui.label} htmlFor="mcp-owner">{labels.owner.change}</label>
      <select id="mcp-owner" name="owner" defaultValue={ownerId ?? ""} className={ui.input}>{owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
    </div>
  ) : null;
  return (
    <div className="space-y-4">
      {created && <CreatedAccess created={created} baseUrl={baseUrl} labels={labels} guide={guide} advanced={advanced} />}
      {/* `key` : le formulaire est vidé après chaque création. */}
      {/* The label of an assistant is not a person's name, and nothing here is a login: the password managers are told to offer and save nothing. */}
      <form onSubmit={submitKeepingValues(submit)} key={created?.token ?? "new"} autoComplete="off" {...MANAGER_IGNORE} className="space-y-4">
        {!compact && profileBlock}
        {nameBlock}
        {scopeBlock}
        {labels.owner && <p className="text-sm text-muted" data-testid="mcp-owner-summary">{labels.owner.summary}</p>}
        {!compact && ownerBlock}
        {compact && (
          <MoreOptions title={labels.more?.title ?? ""} summary={labels.more?.summary}>
            {profileBlock}
            {ownerBlock}
          </MoreOptions>
        )}
        {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
        <PendingButton variant="primary" pending={pending}>{labels.submit}</PendingButton>
      </form>
      <Callout tone="info">{labels.afterCreate}</Callout>
    </div>
  );
}
