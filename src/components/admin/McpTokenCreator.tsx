"use client";

import { useActionState, useState } from "react";
import type { CreateTokenState } from "@/app/admin/(panel)/mcp/actions";
import { Callout } from "./Page";
import { CopyBlock } from "./CopyBlock";
import { McpConnectGuide, type GuideTexts } from "./McpConnectGuide";
import { ui } from "./ui";

type Labels = {
  name: string; nameHelp: string; scope: string; scopeHelp: string; read: string; write: string;
  urlOption: string; urlOptionHelp: string; submit: string; afterCreate: string;
  createdTitle: string; createdToken: string; createdUrl: string; createdOnce: string; copy: string; copied: string;
  /** Profils prêts à l'emploi (« Maintenance ») : textes déjà traduits par la page. */
  profile: { label: string; standard: string; maintenance: string; help: string; levels: string[]; approval: string; approvalHuman: string; approvalDirect: string; notify: string; notifyAdmin: string; notifyEmail: string };
};

/**
 * Formulaire de création d'un jeton. Une fois créé, le jeton (et l'adresse secrète si l'option est cochée) s'affichent ICI, une seule fois,
 * avec les consignes de branchement déjà remplies. L'état reste dans ce composant : rien n'est relu depuis la base, rien n'est conservé.
 */
export function McpTokenCreator({ action, baseUrl, labels, guide, advanced, defaultProfile = "standard" }: { action: (prev: CreateTokenState, form: FormData) => Promise<CreateTokenState>; baseUrl: string; labels: Labels; guide: GuideTexts; advanced: boolean; defaultProfile?: "standard" | "maintenance" }) {
  const [state, run, pending] = useActionState(action, null);
  const [profile, setProfile] = useState(defaultProfile);
  const maintenance = profile === "maintenance";
  const created = state?.created;
  const copy = { copyLabel: labels.copy, copiedLabel: labels.copied };
  return (
    <div className="space-y-4">
      {created && (
        <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status" data-testid="mcp-created">
          <h3 className="text-base font-semibold">{labels.createdTitle.replace("{name}", created.name)}</h3>
          <CopyBlock text={created.token} label={labels.createdToken} {...copy} />
          {created.byUrl && <CopyBlock text={`${baseUrl}/api/mcp/${created.token}`} label={labels.createdUrl} {...copy} />}
          <p className="text-sm font-medium">{labels.createdOnce}</p>
          <McpConnectGuide texts={guide} baseUrl={baseUrl} token={created.token} byUrl={created.byUrl} advanced={advanced} />
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={ui.label} htmlFor="mcp-name">{labels.name}</label>
            <input id="mcp-name" name="name" required placeholder="Claude" className={ui.input} />
            <p className={ui.help}>{labels.nameHelp}</p>
          </div>
          <div className={maintenance ? "hidden" : undefined}>
            <label className={ui.label} htmlFor="scope">{labels.scope}</label>
            <select id="scope" name="scope" defaultValue="read" className={ui.input}>
              <option value="read">{labels.read}</option>
              <option value="write">{labels.write}</option>
            </select>
            <p className={ui.help}>{labels.scopeHelp}</p>
          </div>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="byUrl" className="h-4 w-4 accent-[var(--v-accent)]" />
            {labels.urlOption}
          </label>
          <p className={ui.help}>{labels.urlOptionHelp}</p>
        </div>
        {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
        <button type="submit" disabled={pending} className={ui.btnPrimary}>{labels.submit}</button>
      </form>
      <Callout tone="info">{labels.afterCreate}</Callout>
    </div>
  );
}
