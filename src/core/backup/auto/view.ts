import { getSiteConfig } from "@/core/settings";
import { siteTimezone } from "@/core/siteTime";
import { getMailConfig } from "@/core/services/mail";
import { DATA_DIR } from "@/core/config";
import { administratorAccounts, hasPassphrase, maskEmail, readConfig, readState, resolveRecipient, type AutoConfig, type Reason } from "./config";
import { nextSlot, type Frequency } from "./schedule";
import { listCopies, type KeptCopy } from "./store";

/** The three states of a feature (R33): written the same way everywhere. */
export type AutoState3 = "configured" | "degraded" | "notConfigured";

export type AutoStatus = {
  state: AutoState3;
  enabled: boolean;
  frequency: Frequency;
  maxMb: number;
  /** Masked address (`c***@example.org`), or null when none can be resolved. Never the full address. */
  recipient: string | null;
  mailConfigured: boolean;
  /** Why the state is "degraded". */
  reason: Reason | null;
  last: { at: string; ok: boolean; attached: boolean; sizeBytes: number | null; reason: Reason | null } | null;
  nextAt: string | null;
  kept: KeptCopy | null;
};

/**
 * What the page and the read-only maintenance report say about the feature. NO secret in it: the passphrase is only asked whether it can be opened, the address is masked.
 */
export async function autoBackupStatus(now = new Date(), dataDir = DATA_DIR): Promise<AutoStatus> {
  const config = await readConfig();
  const mailConfigured = (await getMailConfig()) !== null;
  const kept = listCopies(dataDir)[0] ?? null;
  if (!config?.enabled) {
    return { state: "notConfigured", enabled: false, frequency: config?.frequency ?? "weekly", maxMb: config?.maxMb ?? 20, recipient: null, mailConfigured, reason: null, last: null, nextAt: null, kept };
  }
  const state = await readState();
  const address = await resolveRecipient(config.recipient);
  let reason: Reason | null = null;
  if (!mailConfigured) reason = "mail_not_configured";
  else if (!address) reason = "no_recipient";
  else if (!(await hasPassphrase())) reason = "passphrase_unreadable";
  else if (state.ok === false) reason = state.reason ?? "backup_failed";
  else if (state.ok === true && state.attached === false) reason = "too_big";
  const site = await getSiteConfig();
  const next = nextSlot(now, config.frequency, site.name, await siteTimezone());
  return {
    state: reason ? "degraded" : "configured", enabled: true, frequency: config.frequency, maxMb: config.maxMb,
    recipient: address ? maskEmail(address) : null, mailConfigured, reason,
    last: state.lastAt ? { at: state.lastAt, ok: state.ok === true, attached: state.attached === true, sizeBytes: state.sizeBytes ?? null, reason: state.reason ?? null } : null,
    nextAt: next ? next.toISOString() : null, kept,
  };
}

/** The recipient choice as the form needs it (the full address of a typed one, so that it can be edited; the page is for people who hold the backup right). */
export async function recipientForm(config: AutoConfig | null): Promise<{ kind: "owner" | "user" | "address"; userId: string; address: string; accounts: Awaited<ReturnType<typeof administratorAccounts>> }> {
  const r = config?.recipient ?? { kind: "owner" as const };
  return { kind: r.kind, userId: r.kind === "user" ? r.userId : "", address: r.kind === "address" ? r.address : "", accounts: await administratorAccounts() };
}
