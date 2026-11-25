/**
 * FORGOT PASSWORD, self-service (core 0.49.0). Only when the site can send e-mail (the login page shows the link, and the server refuses without it).
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
import { levelOf } from "./access";
import { auditAccount } from "./accountAudit";
import { hashToken, looksLikeToken, newToken, sameDigest } from "./oneTimeToken";
import { passwordProblem } from "./passwordPolicy";
import { allowTry } from "./rateLimit";
import { pausePersonalAccesses } from "./sessions";
import { RESET_PASSWORD_HREF } from "../adminLinks";

export const RESET_TTL_MINUTES = 45;
/** Every answer to a request takes at least this long. */
export const REQUEST_FLOOR_MS = 400;
const HOUR = 3_600_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const short = (s: string) => hashToken("reset", `d|${s}`).slice(0, 16);

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
  // Limits that do not depend on the address existing: per network address, per address typed, and for the whole site (mail quota).
  const within = allowTry(`reset:ip:${input.ip}`, 10, HOUR, now.getTime()) && allowTry(`reset:mail:${short(email)}`, 3, HOUR, now.getTime()) && allowTry("reset:site", 20, HOUR, now.getTime());
  const token = newToken();
  const tokenHash = hashToken("reset", token);
  const user = within ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, locale: true, role: true, coordinator: true, suspendedAt: true } }) : null;
  if (user && !user.suspendedAt && levelOf(user) !== "owner") {
    await prisma.passwordReset.upsert({ where: { userId: user.id }, create: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000) }, update: { tokenHash, expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000), createdAt: now } });
    await auditAccount(user.email, levelOf(user), "password.reset.request", user.email);
    const link = `${input.origin.replace(/\/+$/, "")}${RESET_PASSWORD_HREF}#t=${token}`;
    void resetMail(user, "link", link);
  }
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
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { role: true, coordinator: true, suspendedAt: true } });
  return !!user && !user.suspendedAt && levelOf(user) !== "owner";
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
  const found: { user?: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> } = {};
  try {
    await prisma.$transaction(async (tx) => {
      const spent = await tx.passwordReset.deleteMany({ where: { id: row.id, tokenHash: hash, expiresAt: { gt: now } } });
      if (spent.count !== 1) throw new Error("spent");
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!user || user.suspendedAt || levelOf(user) === "owner") throw new Error("not-eligible");
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
