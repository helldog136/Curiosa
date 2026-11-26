/**
 * FORGOT PASSWORD, self-service (next core version). Only when the site can send e-mail (the login page shows the link, and the server refuses without it).
 *
 *  - A request answers the SAME thing and takes about the same time whether the address has an account, has none, is suspended, or is the owner's. The mail, when there is one, is sent
 *    after the answer is ready (never awaited), and the answer waits for a fixed minimum, so the clock tells nothing.
 *  - The link holds a 256-bit token, only its keyed hash is stored, one row per person (a new request replaces the old link), valid 45 minutes, single use.
 *  - THE OWNER NEVER USES IT. The owner account is the root of trust of the site: its recovery stays the console script (`scripts/auth-recover.mjs reset-password`, docs/SECURITE.md),
 *    which needs the server, not a mailbox. A mailbox takeover must never be a site takeover. The page answers the owner exactly like everyone else; no link is made.
 *    Every other account, technical coordinators included, can use it. A technical coordinator who is the only operator is therefore never locked out by this rule: the owner can set a
 *    temporary password for them, and so can another coordinator.
 *  - A reset NEVER touches the second factor: authenticator, passkeys and recovery codes stay. It cuts every session and pauses personal AI accesses, clears "must choose a password",
 *    audits, and tells the person by e-mail. It does not sign anyone in: the next sign-in asks for the second factor as usual.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { getSiteConfig } from "../settings";
import { makeTranslator } from "../i18n/dictionary";
import { isValidEmail, sendCoreMail } from "../services/mail";
import { accessOf, currentCatalogue, levelOf } from "./access";
import { auditAccount } from "./accountAudit";
import { hashToken, looksLikeToken, newToken, sameDigest } from "./oneTimeToken";
import { passwordProblem } from "./passwordPolicy";
import { allowGlobal, allowTry, wouldAllow } from "./rateLimit";
import { CORE_RESERVED, type RightInfo } from "./rights";
import { lastRestoreAt } from "./restoreMark";
import { pausePersonalAccesses } from "./sessions";
import { RESET_PASSWORD_HREF } from "../adminLinks";

export const RESET_TTL_MINUTES = 45;
/** Every answer to a request takes at least this long. */
export const REQUEST_FLOOR_MS = 400;
/** A link made less than this long ago is kept: a second request does not replace it nor send another mail (same generic answer). */
export const REISSUE_AFTER_MINUTES = 5;
const HOUR = 3_600_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const short = (s: string) => hashToken("reset", `d|${s}`).slice(0, 16);

/**
 * Who can use the public reset. Never the owner, never a suspended account. An account whose rights include a RESERVED right (the coordinator, or any level that holds one:
 * team, roles, backup, updates, modules, assistant accesses, security) can use it ONLY if it has a second factor (authenticator or passkey): the reset keeps the second factor,
 * so a stolen mailbox alone is not enough. Without one, such an account is reset by the owner (or, for a non-coordinator, by a coordinator) with a temporary password.
 * Read from the database each time: a link made before the account gained such a right stops working.
 */
async function eligible(user: { id: string; role: string; coordinator: boolean; suspendedAt: Date | null; totpEnabledAt: Date | null }, db: Pick<typeof prisma, "userRole" | "passkey"> = prisma, catalogue?: RightInfo[]): Promise<boolean> {
  if (user.suspendedAt || levelOf(user) === "owner") return false;
  const { rights } = await accessOf(user, catalogue, db);
  if (!CORE_RESERVED.some((r) => rights.has(r))) return true;
  if (user.totpEnabledAt) return true;
  return (await db.passkey.count({ where: { userId: user.id } })) > 0;
}
const ELIGIBILITY_SELECT = { id: true, email: true, name: true, locale: true, role: true, coordinator: true, suspendedAt: true, totpEnabledAt: true } as const;

async function resetMail(user: { email: string; name: string; locale: string | null }, kind: "link" | "done", link?: string): Promise<void> {
  try {
    const cfg = await getSiteConfig().catch(() => null);
    const t = makeTranslator(user.locale ?? cfg?.defaultLocale ?? "en");
    const site = cfg?.name || "Curiosa";
    if (kind === "link") await sendCoreMail({ to: user.email, subject: t("reset.mail.subject", { site }), text: t("reset.mail.body", { name: user.name, site, link: link ?? "", minutes: RESET_TTL_MINUTES }) }, "reset");
    else await sendCoreMail({ to: user.email, subject: t("reset.done.subject", { site }), text: t("reset.done.body", { name: user.name, site }) }, "notice");
  } catch { /* a mail that cannot leave never changes the outcome */ }
}

/**
 * Someone asked for a link for this address. Always resolves the same value; `limited` is only for the caller's own address-independent limits (it is also generic: the page shows
 * the same words). Pass `mailConfigured` read by the caller; without mail nothing is created.
 */
export async function requestPasswordReset(input: { email: unknown; ip: string; origin: string; mailConfigured: boolean; now?: Date }): Promise<{ accepted: true }> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const email = String(input.email ?? "").trim().toLowerCase();
  const answer = async () => { const wait = REQUEST_FLOOR_MS - (Date.now() - started); if (wait > 0) await sleep(wait); return { accepted: true as const }; };
  if (!input.mailConfigured || !isValidEmail(email)) { hashToken("reset", newToken()); return answer(); }
  // Only the network address is counted for every request. The address typed and the site-wide mail quota are counted only when a mail is really sent, so requests that
  // lead to nothing (unknown address, owner, suspended, no second factor, a link just made) never use them up.
  const within = allowTry(`reset:ip:${input.ip}`, 10, HOUR, now.getTime());
  const user = within ? await prisma.user.findUnique({ where: { email }, select: ELIGIBILITY_SELECT }) : null;
  if (user && (await eligible(user))) {
    const mailKey = `reset:mail:${short(email)}`;
    const existing = await prisma.passwordReset.findUnique({ where: { userId: user.id } });
    const fresh = !!existing && existing.expiresAt > now && now.getTime() - existing.createdAt.getTime() < REISSUE_AFTER_MINUTES * 60_000;
    if (!fresh && wouldAllow(mailKey, 3, HOUR, now.getTime()) && wouldAllow("reset:site", 20, HOUR, now.getTime())) {
      allowTry(mailKey, 3, HOUR, now.getTime());
      allowGlobal("reset:site", 20, HOUR, now.getTime());
      const token = newToken();
      const tokenHash = hashToken("reset", token);
      await prisma.passwordReset.upsert({ where: { userId: user.id }, create: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000), createdAt: now }, update: { tokenHash, expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000), createdAt: now } });
      await auditAccount(user.email, levelOf(user), "password.reset.request", user.email);
      const link = `${input.origin.replace(/\/+$/, "")}${RESET_PASSWORD_HREF}#t=${token}`;
      void resetMail(user, "link", link);
    }
  } else hashToken("reset", newToken());
  return answer();
}

export type ResetFailure = "invalid" | "rate" | "password" | "mismatch";
export type ResetResult = { ok: true } | { ok: false; reason: ResetFailure };

/** Is this link still usable? (page load; does not consume.) Generic: `false` for unknown, used, expired, owner, suspended. */
export async function peekReset(token: unknown, ip: string, now = new Date()): Promise<boolean | "rate"> {
  if (!allowTry(`reset:use:ip:${ip}`, 30, HOUR, now.getTime())) return "rate";
  if (!looksLikeToken(token)) return false;
  if (!allowTry(`reset:use:tok:${short(token)}`, 12, 15 * 60_000, now.getTime())) return "rate";
  const hash = hashToken("reset", token);
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hash } });
  if (!row || !sameDigest(row.tokenHash, hash) || row.expiresAt <= now) return false;
  const restored = await lastRestoreAt();
  if (restored && row.createdAt.getTime() < restored.getTime()) return false;
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: ELIGIBILITY_SELECT });
  return !!user && (await eligible(user));
}

export async function completePasswordReset(input: { token: unknown; password: unknown; confirm: unknown; ip: string; now?: Date }): Promise<ResetResult> {
  const now = input.now ?? new Date();
  const ok = await peekReset(input.token, input.ip, now);
  if (ok === "rate") return { ok: false, reason: "rate" };
  if (!ok) return { ok: false, reason: "invalid" };
  const password = String(input.password ?? "");
  if (passwordProblem(password)) return { ok: false, reason: "password" };
  if (password !== String(input.confirm ?? "")) return { ok: false, reason: "mismatch" };
  const hash = hashToken("reset", input.token as string);
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hash } });
  if (!row) return { ok: false, reason: "invalid" };
  const passwordHash = await bcrypt.hash(password, 12);
  // Read before the transaction opens: nothing inside it may wait for the one database connection the transaction holds.
  const catalogue = await currentCatalogue();
  const found: { user?: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> } = {};
  try {
    await prisma.$transaction(async (tx) => {
      const spent = await tx.passwordReset.deleteMany({ where: { id: row.id, tokenHash: hash, expiresAt: { gt: now } } });
      if (spent.count !== 1) throw new Error("spent");
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!user || !(await eligible(user, tx, catalogue))) throw new Error("not-eligible");
      // The password and the end of every session in ONE write. The second factor (authenticator, passkeys, recovery codes) is not touched.
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
      found.user = user;
    });
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const done = found.user!;
  await pausePersonalAccesses(done.id);
  await auditAccount(done.email, levelOf(done), "password.reset.done", done.email);
  void resetMail(done, "done");
  return { ok: true };
}

/** Links that are no longer usable are removed (sweep at start-up and when someone asks). */
export async function purgeExpiredResets(now = new Date()): Promise<number> {
  return (await prisma.passwordReset.deleteMany({ where: { expiresAt: { lte: now } } })).count;
}
