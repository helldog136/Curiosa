import { getSiteConfig } from "@/core/settings";
import { siteTimezone, dayKey } from "@/core/siteTime";
import { makeTranslator } from "@/core/i18n/dictionary";
import { audit } from "@/core/permissions";
import { getMailConfig, sendCoreMailWithAttachment } from "@/core/services/mail";
import { createBackup } from "../export";
import { openPassphrase, readConfig, readState, resolveRecipient, writeState, type AutoState, type Reason } from "./config";
import { dueSlot, latestSlot, retryDelay } from "./schedule";
import { keepCopy } from "./store";
import { backupMail } from "./message";

/**
 * ONE RUN of the automatic backup, the same code for the schedule and for "Send a backup now" (docs/BACKUP.md):
 *   backup (existing encrypted format) -> kept copy on the server -> mail (file attached, or a notice when it is over the limit) -> result saved -> audit row.
 * It never throws: a failure becomes a result with a reason in plain words, a counter and a time for the next attempt. The passphrase is opened for the call to `createBackup`
 * and goes nowhere else: not into the mail, the audit row, the result or any log line.
 */
export type RunOutcome =
  | { ok: true; attached: boolean; sizeBytes: number; kept: boolean }
  | { ok: false; reason: Reason }
  | { ok: false; skipped: "busy" | "off" };

const g = globalThis as unknown as { curiosaAutoBackupRunning?: boolean };

export async function runAutoBackup(trigger: "schedule" | "manual", now = new Date(), actor = "system"): Promise<RunOutcome> {
  if (g.curiosaAutoBackupRunning) return { ok: false, skipped: "busy" };
  g.curiosaAutoBackupRunning = true;
  try {
    const config = await readConfig();
    if (!config?.enabled) return { ok: false, skipped: "off" };
    const outcome = await attempt(config, now);
    await record(trigger, outcome, config, now, actor);
    return outcome;
  } catch (error) {
    console.error("[autobackup] run failed:", (error as Error)?.name);
    return { ok: false, reason: "backup_failed" };
  } finally {
    g.curiosaAutoBackupRunning = false;
  }
}

async function attempt(config: NonNullable<Awaited<ReturnType<typeof readConfig>>>, now: Date): Promise<RunOutcome> {
  if (!(await getMailConfig())) return { ok: false, reason: "mail_not_configured" };
  const to = await resolveRecipient(config.recipient);
  if (!to) return { ok: false, reason: "no_recipient" };

  let file: { buffer: Buffer; filename: string };
  try {
    const passphrase = await openPassphrase();
    if (!passphrase) return { ok: false, reason: "passphrase_unreadable" };
    const made = await createBackup(passphrase, { now });
    file = { buffer: made.buffer, filename: made.filename };
  } catch (error) {
    console.error("[autobackup] backup failed:", (error as Error)?.name);
    return { ok: false, reason: "backup_failed" };
  }

  const sizeBytes = file.buffer.length;
  const kept = keepCopy(file.buffer, now.getTime());
  const attached = sizeBytes <= config.maxMb * 1024 * 1024;
  // A notice that says "kept on the server" must be true: without a kept copy, a file over the limit is a failure.
  if (!attached && !kept) return { ok: false, reason: "disk_full" };

  const site = await getSiteConfig();
  const t = makeTranslator(site.adminLocale ?? site.defaultLocale, site.defaultLocale);
  const mail = backupMail(t, { site: site.name, day: dayKey(now, await siteTimezone()), filename: file.filename, sizeBytes, limitMb: config.maxMb, attached, kept });
  const sent = await sendCoreMailWithAttachment({ to, subject: mail.subject, text: mail.text }, attached ? { filename: file.filename, content: file.buffer } : undefined);
  if (sent.ok) return { ok: true, attached, sizeBytes, kept };
  if (sent.reason === "not_configured") return { ok: false, reason: "mail_not_configured" };
  if (sent.reason === "no_recipient" || sent.reason === "invalid") return { ok: false, reason: "no_recipient" };
  if (sent.reason === "rate_limited") return { ok: false, reason: "mail_rate_limited" };
  const cause = "cause" in sent ? sent.cause : "unknown";
  return { ok: false, reason: cause === "login" ? "mail_login" : cause === "unreachable" ? "mail_unreachable" : "mail_refused" };
}

/** Saves the result (for the page, the tools and the next attempt) and writes ONE audit row: words only, never an address, a server message or a secret. */
async function record(trigger: "schedule" | "manual", outcome: RunOutcome, config: { frequency: Parameters<typeof latestSlot>[1]; since: string }, now: Date, actor: string): Promise<void> {
  if ("skipped" in outcome) return;
  const before = await readState();
  const site = await getSiteConfig();
  const tz = await siteTimezone();
  const slot = latestSlot(now, config.frequency, site.name, tz);
  const slotIso = slot && slot.getTime() > Date.parse(config.since) ? slot.toISOString() : undefined;
  const newer = (a?: string, b?: string) => (a && b ? (Date.parse(a) >= Date.parse(b) ? a : b) : a ?? b);
  let next: AutoState;
  if (outcome.ok) {
    next = { lastAt: now.toISOString(), ok: true, attached: outcome.attached, sizeBytes: outcome.sizeBytes, kept: outcome.kept, failures: 0, lastSlot: newer(before.lastSlot, slotIso) };
  } else {
    // The schedule retries a limited number of times with growing waits; a manual try does not touch the counter.
    const failures = trigger === "schedule" ? (before.failures ?? 0) + 1 : before.failures ?? 0;
    const delay = trigger === "schedule" ? retryDelay(failures) : null;
    next = {
      ...before, lastAt: now.toISOString(), ok: false, reason: outcome.reason, failures,
      retryAt: trigger === "schedule" && delay ? new Date(now.getTime() + delay).toISOString() : trigger === "schedule" ? undefined : before.retryAt,
      lastSlot: trigger === "schedule" && !delay ? newer(before.lastSlot, slotIso) : before.lastSlot,
    };
    delete next.attached; delete next.sizeBytes;
  }
  await writeState(next);
  if (outcome.ok) await audit(actor, "autobackup.sent", `${trigger} ${outcome.attached ? "attached" : "too-big"}`);
  else await audit(actor, "autobackup.failed", `${trigger} ${outcome.reason}`, { level: "warn" });
}

/** One tick of the scheduler: runs the due slot, if any. Never throws. */
export async function runDueAutoBackup(now = new Date()): Promise<RunOutcome | null> {
  try {
    const config = await readConfig();
    if (!config?.enabled) return null;
    const site = await getSiteConfig();
    if (!dueSlot(now, config, await readState(), site.name, await siteTimezone())) return null;
    return await runAutoBackup("schedule", now);
  } catch (error) {
    console.error("[autobackup] tick failed:", (error as Error)?.name);
    return null;
  }
}
