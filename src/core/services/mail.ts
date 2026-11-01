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
type TransportFactory = (config: MailConfig) => Transport;

const defaultFactory: TransportFactory = (c) =>
  nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  }) as unknown as Transport;
let factory: TransportFactory = defaultFactory;
/** Pour les tests : remplace le transport SMTP. Sans argument, remet le vrai. */
export function setMailTransportFactory(f?: TransportFactory): void { factory = f ?? defaultFactory; }

const PER_INSTANCE = 10;
const PER_SITE = 40;
const WINDOW = 60 * 60_000;
const sent = new Map<string, number[]>();
export function resetMailLimits(): void { sent.clear(); }
function allow(actor: string): boolean {
  const now = Date.now();
  const recent = (key: string) => (sent.get(key) ?? []).filter((t) => now - t < WINDOW);
  const mine = recent(actor), all = recent("*");
  if (mine.length >= PER_INSTANCE || all.length >= PER_SITE) return false;
  sent.set(actor, [...mine, now]);
  sent.set("*", [...all, now]);
  return true;
}

const oneLine = (s: string, max: number) => String(s ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

async function ownerAddress(): Promise<string | null> {
  const contact = ((await getSetting<string>("site.contactEmail")) ?? "").trim();
  if (EMAIL_RE.test(contact)) return contact;
  const owner = await prisma.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
  return owner && EMAIL_RE.test(owner.email) ? owner.email : null;
}

/** Envoie un e-mail au nom du site. `actor` identifie l'appelant (clé d'instance, ou « core »). Ne lève jamais. */
export async function sendMail(request: MailRequest, actor: string): Promise<MailResult> {
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

    if (!allow(actor)) return { ok: false, reason: "rate_limited" };
    await factory(config).sendMail({ from: config.from, to, subject, text, ...(replyTo ? { replyTo } : {}) });
    await prisma.auditLog.create({ data: { actor: `module:${actor}`, action: "mail.sent", target: request.to === "owner" ? "owner" : "address" } }).catch(() => {});
    return { ok: true };
  } catch (error) {
    // Jamais de détail (identifiants, serveur, adresse) vers l'appelant : seulement dans les journaux du serveur.
    console.error("[mail] send failed:", (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
}
