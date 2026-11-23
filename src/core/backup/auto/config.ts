import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { deleteSetting, getSetting, setSetting } from "@/core/settings";
import { seal, unseal } from "@/core/seal";
import { isValidEmail } from "@/core/services/mail";
import { levelOf } from "@/core/auth/access";
import { DEFAULT_FREQUENCY, isFrequency, type Frequency } from "./schedule";

/**
 * AUTOMATIC BACKUP BY E-MAIL: what is saved, and where (docs/BACKUP.md).
 *
 *  - `autobackup.config`            the choices (on or off, frequency, recipient, size limit, switch-on date). No secret.
 *  - `autobackup.state`             the result of the last run and the retry counter. No secret, no server text.
 *  - `autobackup.secret.passphrase` the passphrase that encrypts the e-mailed files, SEALED (AES-256-GCM, key from the site secret: src/core/seal.ts).
 *
 * The three keys are left out of backups (export.ts): they describe THIS server (its site secret opens the passphrase, its mail settings send the file).
 * After a restore the feature is off and is switched on again, which makes a new passphrase.
 * The passphrase is read in ONE place (`openPassphrase`, used by the run) and written in ONE place (`switchOn` / `regeneratePassphrase`). It is never part of a log line,
 * an audit row, a mail, a file name, a tool answer or a page, except the one-time display right after it is created.
 */
export const CONFIG_KEY = "autobackup.config";
export const STATE_KEY = "autobackup.state";
export const SECRET_KEY = "autobackup.secret.passphrase";
export const AUTO_SETTING_KEYS: readonly string[] = [CONFIG_KEY, STATE_KEY, SECRET_KEY];
const PURPOSE = "auto-backup-passphrase";

export const DEFAULT_MAX_MB = 20;
export const MAX_MB_RANGE = { min: 1, max: 25 } as const;

export type Recipient = { kind: "owner" } | { kind: "user"; userId: string } | { kind: "address"; address: string };
export type AutoConfig = { enabled: boolean; frequency: Frequency; recipient: Recipient; maxMb: number; since: string; passphraseAt: string };

/** Plain-word reasons of a failed or partial run (each has a text and a "what to do" text in the language files). */
export const REASONS = ["mail_not_configured", "no_recipient", "mail_refused", "mail_login", "mail_unreachable", "mail_rate_limited", "backup_failed", "passphrase_unreadable", "disk_full", "too_big"] as const;
export type Reason = (typeof REASONS)[number];

export type AutoState = {
  /** Time of the last run (ISO). */
  lastAt?: string;
  /** The last run worked (a mail left the server). false = failed; absent = no run yet. */
  ok?: boolean;
  /** The backup file was attached to the mail (false: it was too big and stays on the server). */
  attached?: boolean;
  sizeBytes?: number;
  /** A copy is kept on the server (data/backups/auto). */
  kept?: boolean;
  reason?: Reason;
  /** Consecutive failed attempts on the current slot. */
  failures?: number;
  retryAt?: string;
  /** Slot (ISO) handled by the last success or by the last attempt whose retries ran out. */
  lastSlot?: string;
};

export const readConfig = async (): Promise<AutoConfig | null> => normalizeConfig(await getSetting<unknown>(CONFIG_KEY));
export const readState = async (): Promise<AutoState> => normalizeState(await getSetting<unknown>(STATE_KEY));
export const writeState = (state: AutoState) => setSetting(STATE_KEY, state);

export function normalizeConfig(raw: unknown): AutoConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const recipient = normalizeRecipient(r.recipient) ?? { kind: "owner" as const };
  const maxMb = Number(r.maxMb);
  return {
    enabled: r.enabled === true,
    frequency: isFrequency(r.frequency) ? r.frequency : DEFAULT_FREQUENCY,
    recipient,
    maxMb: Number.isFinite(maxMb) ? Math.min(MAX_MB_RANGE.max, Math.max(MAX_MB_RANGE.min, Math.trunc(maxMb))) : DEFAULT_MAX_MB,
    since: typeof r.since === "string" ? r.since : new Date(0).toISOString(),
    passphraseAt: typeof r.passphraseAt === "string" ? r.passphraseAt : "",
  };
}

export function normalizeRecipient(raw: unknown): Recipient | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "owner") return { kind: "owner" };
  if (r.kind === "user" && typeof r.userId === "string" && r.userId) return { kind: "user", userId: r.userId };
  if (r.kind === "address" && typeof r.address === "string" && isValidEmail(r.address.trim())) return { kind: "address", address: r.address.trim() };
  return null;
}

function normalizeState(raw: unknown): AutoState {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  return {
    lastAt: str("lastAt"), lastSlot: str("lastSlot"), retryAt: str("retryAt"),
    ...(typeof r.ok === "boolean" ? { ok: r.ok } : {}),
    ...(typeof r.attached === "boolean" ? { attached: r.attached } : {}),
    ...(typeof r.kept === "boolean" ? { kept: r.kept } : {}),
    ...(typeof r.sizeBytes === "number" ? { sizeBytes: r.sizeBytes } : {}),
    ...(typeof r.failures === "number" ? { failures: r.failures } : {}),
    ...((REASONS as readonly string[]).includes(String(r.reason)) ? { reason: r.reason as Reason } : {}),
  };
}

/* ───────────── passphrase ───────────── */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols: no 0/O, no 1/I
/** 25 random symbols of 5 bits each (125 bits), from the system CSPRNG, in five groups: `ABCDE-FGHJK-...`. */
export function generatePassphrase(): string {
  const groups: string[] = [];
  for (let g = 0; g < 5; g++) {
    let s = "";
    for (let i = 0; i < 5; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

/** Opens the sealed passphrase; null when there is none or when this server's site secret cannot open it. */
export async function openPassphrase(): Promise<string | null> {
  return unseal(PURPOSE, await getSetting<string>(SECRET_KEY));
}
export async function hasPassphrase(): Promise<boolean> { return (await openPassphrase()) !== null; }

/** A new passphrase, sealed and saved; returned ONCE to show it to the person. */
async function storeNewPassphrase(): Promise<string> {
  const phrase = generatePassphrase();
  await setSetting(SECRET_KEY, seal(PURPOSE, phrase));
  return phrase;
}

/* ───────────── recipient ───────────── */

/** `c***@example.org`: enough to recognise the address, not enough to read it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** The real address of a recipient choice, or null (no owner address, unknown or no longer administrator account). */
export async function resolveRecipient(recipient: Recipient): Promise<string | null> {
  if (recipient.kind === "address") return isValidEmail(recipient.address) ? recipient.address : null;
  const user = recipient.kind === "owner"
    ? await prisma.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } })
    : await prisma.user.findFirst({ where: { id: recipient.userId, role: { in: ["owner", "admin"] } } });
  return user && isValidEmail(user.email) ? user.email : null;
}

/** The administrator accounts a person can choose from (owner first). Names only; the e-mail is shown masked. */
export async function administratorAccounts(): Promise<{ id: string; name: string; masked: string; owner: boolean }[]> {
  const rows = await prisma.user.findMany({ where: { role: { in: ["owner", "admin"] } }, orderBy: [{ createdAt: "asc" }] });
  return rows.map((u) => ({ id: u.id, name: u.name, masked: maskEmail(u.email), owner: levelOf(u) === "owner" })).sort((a, b) => Number(b.owner) - Number(a.owner));
}

/* ───────────── switching on and off ───────────── */

export type SwitchOnInput = { frequency?: Frequency; recipient?: Recipient; maxMb?: number };

/** Switches the feature on with a NEW passphrase (returned once). Saves the previous recipient and limit if the feature had been on before. */
export async function switchOn(input: SwitchOnInput, now = new Date()): Promise<{ passphrase: string; config: AutoConfig }> {
  const before = await readConfig();
  const passphrase = await storeNewPassphrase();
  const config: AutoConfig = {
    enabled: true,
    frequency: input.frequency ?? before?.frequency ?? DEFAULT_FREQUENCY,
    recipient: input.recipient ?? before?.recipient ?? { kind: "owner" },
    maxMb: input.maxMb ?? before?.maxMb ?? DEFAULT_MAX_MB,
    since: now.toISOString(),
    passphraseAt: now.toISOString(),
  };
  await setSetting(CONFIG_KEY, config);
  await writeState({});
  return { passphrase, config };
}

/** Switches the feature off: the sealed passphrase is deleted, the schedule stops, the last result is forgotten. The kept copies on the server stay (docs/BACKUP.md). */
export async function switchOff(): Promise<void> {
  await deleteSetting(SECRET_KEY);
  await deleteSetting(STATE_KEY);
  const before = await readConfig();
  if (before) await setSetting(CONFIG_KEY, { ...before, enabled: false });
}

/** A new passphrase for the next backups. The e-mails already sent keep the old one (nothing is re-encrypted). Returned once. */
export async function regeneratePassphrase(now = new Date()): Promise<string> {
  const config = await readConfig();
  const passphrase = await storeNewPassphrase();
  if (config) await setSetting(CONFIG_KEY, { ...config, passphraseAt: now.toISOString() });
  return passphrase;
}

export async function saveOptions(patch: { frequency?: Frequency; recipient?: Recipient; maxMb?: number }): Promise<AutoConfig | null> {
  const config = await readConfig();
  if (!config) return null;
  const next: AutoConfig = {
    ...config,
    ...(patch.frequency ? { frequency: patch.frequency } : {}),
    ...(patch.recipient ? { recipient: patch.recipient } : {}),
    ...(patch.maxMb !== undefined ? { maxMb: Math.min(MAX_MB_RANGE.max, Math.max(MAX_MB_RANGE.min, Math.trunc(patch.maxMb))) } : {}),
    // A new frequency starts from now: the slot that fits the old one is not run at once.
    ...(patch.frequency && patch.frequency !== config.frequency ? { since: new Date().toISOString() } : {}),
  };
  await setSetting(CONFIG_KEY, next);
  if (next.since !== config.since) await writeState({ ...(await readState()), failures: 0, retryAt: undefined });
  return readConfig();
}
