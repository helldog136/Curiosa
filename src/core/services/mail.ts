import nodemailer from "nodemailer";
import { prisma } from "@/core/db";
import { getSetting, setSetting } from "@/core/settings";

/**
 * SERVICE « e-mail » — offert aux modules par le cœur (`ctx.api.mail`).
 *
 * Le cœur détient la configuration SMTP (réglée dans l'admin) et fait l'envoi ; un module ne voit jamais les
 * identifiants. Garde-fous, quel que soit l'appelant :
 *  - l'expéditeur est celui du site : un module ne peut pas choisir « De » ;
 *  - un seul destinataire par envoi (« owner » = le contact du site, ou une adresse précise) ;
 *  - texte brut uniquement, en-têtes nettoyés (aucune injection de ligne), tailles bornées ;
 *  - débit limité, par instance et pour tout le site ;
 *  - chaque envoi est consigné dans le journal d'audit (jamais son contenu) ;
 *  - jamais d'exception ni de message technique renvoyé à l'appelant : seulement une raison courte.
 */
export type MailConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
export type MailRequest = { to: "owner" | string; subject: string; text: string; replyTo?: string };
export type MailResult = { ok: true } | { ok: false; reason: "not_configured" | "no_recipient" | "invalid" | "rate_limited" | "failed" };

const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;
export const isValidEmail = (value: string): boolean => value.length <= 200 && EMAIL_RE.test(value);
const KEYS = { host: "mail.host", port: "mail.port", secure: "mail.secure", user: "mail.user", pass: "mail.pass", from: "mail.from" } as const;

export async function getMailConfig(): Promise<MailConfig | null> {
  const host = ((await getSetting<string>(KEYS.host)) ?? process.env.SMTP_HOST ?? "").trim();
  const from = ((await getSetting<string>(KEYS.from)) ?? process.env.SMTP_FROM ?? "").trim();
  if (!host || !EMAIL_RE.test(from.replace(/^.*<(.+)>$/, "$1"))) return null;
  const port = Number((await getSetting<number>(KEYS.port)) ?? process.env.SMTP_PORT ?? 587) || 587;
  return {
    host,
    port,
    secure: (await getSetting<boolean>(KEYS.secure)) ?? port === 465,
    user: ((await getSetting<string>(KEYS.user)) ?? process.env.SMTP_USER ?? "").trim(),
    pass: (await getSetting<string>(KEYS.pass)) ?? process.env.SMTP_PASS ?? "",
    from,
  };
}

export async function isMailConfigured(): Promise<boolean> {
  return (await getMailConfig()) !== null;
}

/** Enregistre la configuration. Un mot de passe vide conserve l'ancien (il n'est jamais réaffiché). */
export async function saveMailConfig(input: { host: string; port: number; secure: boolean; user: string; pass?: string; from: string }): Promise<void> {
  await setSetting(KEYS.host, input.host.trim());
  await setSetting(KEYS.port, Math.min(65535, Math.max(1, Math.trunc(input.port) || 587)));
  await setSetting(KEYS.secure, input.secure);
  await setSetting(KEYS.user, input.user.trim());
  if (input.pass) await setSetting(KEYS.pass, input.pass);
  await setSetting(KEYS.from, input.from.trim());
}

type Transport = { sendMail(message: Record<string, unknown>): Promise<unknown> };
/** `large`: the message carries a big attachment (a backup): the socket gets more time. */
type TransportFactory = (config: MailConfig, options?: { large?: boolean }) => Transport;

const defaultFactory: TransportFactory = (c, options) =>
  nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: options?.large ? 120_000 : 15_000,
  }) as unknown as Transport;
let factory: TransportFactory = defaultFactory;
/** Pour les tests : remplace le transport SMTP. Sans argument, remet le vrai. */
export function setMailTransportFactory(f?: TransportFactory): void { factory = f ?? defaultFactory; }

const PER_INSTANCE = 10;
const PER_SITE = 40;
const WINDOW = 60 * 60_000;
const sent = new Map<string, number[]>();
export function resetMailLimits(): void { sent.clear(); }
/** Core mail about people ("core.onboarding", "core.reset", "core.notice") has its OWN site-wide bucket, apart from the one every module shares: a module cannot use up the invitations, nor the other way round. */
const PER_SITE_CORE = 60;
const isCoreKind = (actor: string) => actor.startsWith("core.");
function allow(actor: string, perActor = PER_INSTANCE): boolean {
  const now = Date.now();
  const recent = (key: string) => (sent.get(key) ?? []).filter((t) => now - t < WINDOW);
  const bucket = isCoreKind(actor) ? "core:*" : "*";
  const cap = isCoreKind(actor) ? PER_SITE_CORE : PER_SITE;
  const mine = recent(actor), all = recent(bucket);
  if (mine.length >= perActor || all.length >= cap) return false;
  sent.set(actor, [...mine, now]);
  sent.set(bucket, [...all, now]);
  return true;
}

const oneLine = (s: string, max: number) => String(s ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

async function ownerAddress(): Promise<string | null> {
  const contact = ((await getSetting<string>("site.contactEmail")) ?? "").trim();
  if (EMAIL_RE.test(contact)) return contact;
  const owner = await prisma.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
  return owner && EMAIL_RE.test(owner.email) ? owner.email : null;
}

/** Why a send failed, in one word (never the server's own text, which can name accounts and hosts). */
export type MailCause = "login" | "unreachable" | "refused" | "unknown";
export function mailCause(error: unknown): MailCause {
  const code = String((error as { code?: unknown })?.code ?? "");
  const response = Number((error as { responseCode?: unknown })?.responseCode);
  if (code === "EAUTH" || response === 535 || response === 534) return "login";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EDNS", "EHOSTUNREACH", "ETLS"].includes(code)) return "unreachable";
  if (code === "EMESSAGE" || code === "EENVELOPE" || (response >= 400 && response < 600)) return "refused";
  return "unknown";
}

export type MailAttachment = { filename: string; content: Buffer };
export type MailResultWithCause = MailResult | { ok: false; reason: "failed"; cause: MailCause };

async function deliver(request: MailRequest, actor: string, attachment?: MailAttachment, perActor?: number): Promise<MailResultWithCause> {
  try {
    const config = await getMailConfig();
    if (!config) return { ok: false, reason: "not_configured" };

    const subject = oneLine(request.subject, 150);
    const text = String(request.text ?? "").replace(/\u0000/g, "").slice(0, 20_000);
    if (!subject || !text.trim()) return { ok: false, reason: "invalid" };
    const replyTo = request.replyTo ? oneLine(request.replyTo, 200) : undefined;
    if (replyTo && !EMAIL_RE.test(replyTo)) return { ok: false, reason: "invalid" };

    let to: string | null;
    if (request.to === "owner") {
      to = await ownerAddress();
      if (!to) return { ok: false, reason: "no_recipient" };
    } else {
      to = oneLine(request.to, 200);
      if (!EMAIL_RE.test(to)) return { ok: false, reason: "invalid" };
    }

    if (!allow(actor, perActor)) return { ok: false, reason: "rate_limited" };
    const files = attachment ? [{ filename: oneLine(attachment.filename, 120).replace(/[\\/"]/g, "-"), content: attachment.content, contentType: "application/octet-stream" }] : [];
    try {
      await factory(config, { large: files.length > 0 }).sendMail({ from: config.from, to, subject, text, ...(replyTo ? { replyTo } : {}), ...(files.length ? { attachments: files } : {}) });
    } catch (error) {
      // Jamais de détail (identifiants, serveur, adresse) vers l'appelant : seulement dans les journaux du serveur.
      console.error("[mail] send failed:", (error as Error)?.message);
      return { ok: false, reason: "failed", cause: mailCause(error) };
    }
    await prisma.auditLog.create({ data: { actor: `module:${actor}`, action: "mail.sent", target: request.to === "owner" ? "owner" : "address" } }).catch(() => {});
    return { ok: true };
  } catch (error) {
    console.error("[mail] send failed:", (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
}

/** Envoie un e-mail au nom du site. `actor` identifie l'appelant (clé d'instance, ou « core »). Ne lève jamais. */
export async function sendMail(request: MailRequest, actor: string): Promise<MailResult> {
  const result = await deliver(request, actor);
  return result.ok ? result : { ok: false, reason: result.reason };
}

/**
 * CORE ONLY (not offered to modules): the same mail, with ONE attached file and the reason of a failure in one word. The automatic backup uses it
 * (src/core/backup/auto/run.ts). Same sender, same limits, same audit row; the only new thing is the attachment.
 */
export function sendCoreMailWithAttachment(request: MailRequest, attachment: MailAttachment | undefined): Promise<MailResultWithCause> {
  return deliver(request, "core", attachment);
}

/** Per hour, per kind of core mail about people (invitations, reset links, notices): a team of a few dozen can be invited in a day without touching the module quota. */
const PER_ONBOARDING_KIND = 30;

/**
 * CORE ONLY (not offered to modules): a plain mail about a person's account (invitation, password reset link, change notice). `kind` names the bucket
 * ("onboarding", "reset", "notice"): each kind has its own hourly limit, so a flood of reset requests never uses the invitations' share. Same sender, same
 * audit row (never the content). The caller decides what to say about a refusal; a token in `text` is never logged here.
 */
export function sendCoreMail(request: MailRequest, kind: "onboarding" | "reset" | "notice"): Promise<MailResultWithCause> {
  return deliver(request, `core.${kind}`, undefined, PER_ONBOARDING_KIND);
}
