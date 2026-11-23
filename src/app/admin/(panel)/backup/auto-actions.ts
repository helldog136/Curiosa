"use server";

import { revalidatePath } from "next/cache";
import { adminCtx } from "@/core/admin";
import { BACKUP_HREF } from "@/core/adminLinks";
import { audit } from "@/core/permissions";
import { getMailConfig, isValidEmail } from "@/core/services/mail";
import { administratorAccounts, DEFAULT_MAX_MB, MAX_MB_RANGE, maskEmail, readConfig, regeneratePassphrase, resolveRecipient, saveOptions, switchOff, switchOn, type Recipient } from "@/core/backup/auto/config";
import { isFrequency } from "@/core/backup/auto/schedule";
import { runAutoBackup } from "@/core/backup/auto/run";
import { formatBytes } from "@/core/backup/auto/message";
import type { ActionState } from "@/components/admin/ActionForm";

/** What the panel gets back. `passphrase` exists only in the answer to the action that creates it (switch on, new passphrase): it is shown once and kept nowhere on the page. */
export type AutoResult = { ok?: string; error?: string; passphrase?: string; errors?: Record<string, string> };

const right = { right: "core:backup" } as const;
const done = () => revalidatePath(BACKUP_HREF);

export async function enableAutoBackup(): Promise<AutoResult> {
  const { user, t } = await adminCtx(right);
  if (!(await getMailConfig())) return { error: t("autobackup.error.noMail") };
  const before = await readConfig();
  if (!(await resolveRecipient(before?.recipient ?? { kind: "owner" }))) return { error: t("autobackup.reason.no_recipient") };
  const { passphrase } = await switchOn({});
  await audit(user.email, "autobackup.on");
  done();
  return { ok: t("autobackup.on.done"), passphrase };
}

export async function disableAutoBackup(): Promise<AutoResult> {
  const { user, t } = await adminCtx(right);
  await switchOff();
  await audit(user.email, "autobackup.off");
  done();
  return { ok: t("autobackup.off.done") };
}

export async function setAutoFrequency(frequency: string): Promise<AutoResult> {
  const { user, t } = await adminCtx(right);
  if (!isFrequency(frequency)) return { error: t("autobackup.error.frequency") };
  if (!(await saveOptions({ frequency }))) return { error: t("autobackup.error.off") };
  await audit(user.email, "autobackup.options", "frequency");
  done();
  return { ok: t("action.saved") };
}

/** The folded options: recipient and size limit, in one form. Errors come back under their field, with an example. */
export async function saveAutoOptions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await adminCtx(right);
  const kind = String(formData.get("recipientKind") ?? "owner");
  const errors: Record<string, string> = {};
  let recipient: Recipient = { kind: "owner" };
  if (kind === "user") {
    const id = String(formData.get("recipientUser") ?? "");
    if ((await administratorAccounts()).some((a) => a.id === id)) recipient = { kind: "user", userId: id };
    else errors.recipientUser = t("autobackup.error.account");
  } else if (kind === "address") {
    const address = String(formData.get("recipientAddress") ?? "").trim();
    if (isValidEmail(address)) recipient = { kind: "address", address };
    else errors.recipientAddress = t("autobackup.error.address");
  } else if (kind !== "owner") errors.recipientKind = t("autobackup.error.address");
  const raw = String(formData.get("maxMb") ?? "").trim();
  const maxMb = raw === "" ? DEFAULT_MAX_MB : Number(raw);
  if (!Number.isInteger(maxMb) || maxMb < MAX_MB_RANGE.min || maxMb > MAX_MB_RANGE.max) errors.maxMb = t("autobackup.error.maxMb", { min: MAX_MB_RANGE.min, max: MAX_MB_RANGE.max });
  if (Object.keys(errors).length) return { errors };
  if (!(await resolveRecipient(recipient))) return { errors: { recipientKind: t("autobackup.reason.no_recipient") } };
  if (!(await saveOptions({ recipient, maxMb }))) return { error: t("autobackup.error.off") };
  await audit(user.email, "autobackup.options", "recipient, size limit");
  done();
  return { ok: t("action.saved") };
}

/** A new passphrase for the next backups. The files already e-mailed keep the old one. */
export async function renewAutoPassphrase(): Promise<AutoResult> {
  const { user, t } = await adminCtx(right);
  if (!(await readConfig())?.enabled) return { error: t("autobackup.error.off") };
  const passphrase = await regeneratePassphrase();
  await audit(user.email, "autobackup.passphrase");
  done();
  return { ok: t("autobackup.renew.done"), passphrase };
}

/** "Send a backup now": the same run as the schedule, started by a person. */
export async function sendAutoBackupNow(): Promise<AutoResult> {
  const { user, t } = await adminCtx(right);
  const outcome = await runAutoBackup("manual", new Date(), user.email);
  done();
  if ("skipped" in outcome) return { error: t(outcome.skipped === "busy" ? "autobackup.error.busy" : "autobackup.error.off") };
  if (!outcome.ok) return { error: `${t(`autobackup.reason.${outcome.reason}`)} ${t(`autobackup.fix.${outcome.reason}`)}` };
  const to = await resolveRecipient((await readConfig())?.recipient ?? { kind: "owner" });
  return { ok: t(outcome.attached ? "autobackup.now.sent" : "autobackup.now.tooBig", { to: to ? maskEmail(to) : "", size: formatBytes(outcome.sizeBytes, t) }) };
}
