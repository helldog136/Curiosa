import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { LOGO_KEYS, type LogoSet } from "@/core/logos";
import { audit } from "@/core/permissions";
import { deleteSetting, getSetting, getSettingByLocale, getSiteConfig, setSetting } from "@/core/settings";
import type { JsonSchemaLite } from "@/core/modules/types";
import { uploadNameOf } from "@/core/services/files";
import { McpToolError } from "@/core/services/mcp/validate";
import type { Outcome } from "./actions";
import { redactSecrets } from "./redact";
import type { Plan } from "./requests";

/**
 * SITE SETTINGS FOR AN AI: `site_settings_get` (read) and `site_settings_set` (a level 3 request that FOLLOWS the approval setting of the access, like publishing and colours).
 *
 * What it can change (the same fields as Admin > Settings, with the same limits): the name, the tagline and the presentation PER LANGUAGE, the public contact e-mail,
 * and the logo slots, from an image that is ALREADY on the site (an address made by media_upload, or an upload of the admin). Nothing else: not the default language, not
 * the enabled languages, not the time zone, domains, roles, secrets, sign-in, mail sending or anything that affects security or addresses. Those arguments do not exist
 * and a forbidden one is refused with a sentence that says where the owner does it.
 *
 * Request flow: the plan freezes every change as old -> new (shown to the owner), the execution re-reads the site and refuses if a value was changed by someone else
 * since the request. When applied, the journal gets one `settings.update` line per call with the OLD values, so the owner can put them back from Admin > Settings.
 */
export const MAX_NAME = 80;
export const MAX_TAGLINE = 200;
export const MAX_ABOUT = 20_000;
/** Total size of the texts of one call: a request is kept in a setting row, and a person has to read it. */
export const MAX_TOTAL = 30_000;
const MAX_EMAIL = 254;

export const LOGO_SLOTS = ["wide", "square", "wideDark", "squareDark", "favicon", "share"] as const;
type Slot = (typeof LOGO_SLOTS)[number];
const SLOT_TEXT: Record<Slot, string> = { wide: "wide logo", square: "square logo", wideDark: "wide logo for dark backgrounds", squareDark: "square logo for dark backgrounds", favicon: "browser tab icon", share: "sharing image" };

/** What the owner does in the admin, for the fields an AI may not touch. */
const FORBIDDEN: Record<string, string> = {
  defaultLocale: "languages", locales: "languages", enabledLocales: "languages", languages: "languages", timezone: "the time zone", domain: "addresses", domains: "addresses", siteUrl: "addresses",
  roles: "people and roles", users: "people and roles", password: "sign-in", secret: "secrets", token: "secrets", mail: "e-mail sending", smtp: "e-mail sending", footer: "the footer", about: "the presentation (use presentation)",
};

const textProp = (what: string) => ({ type: "object", description: what, additionalProperties: { type: "string" } });
export const SITE_SETTINGS_INPUT = {
  type: "object",
  properties: {
    name: textProp(`Site name per language, for example {"en": "Etoile Nord", "fr": "Etoile Nord"}. At most ${MAX_NAME} characters each; cannot be empty.`),
    tagline: textProp(`Tagline per language, for example {"en": "Notes from the north"}. At most ${MAX_TAGLINE} characters each; an empty string removes it.`),
    presentation: textProp(`Presentation of the site or of its author per language (Markdown), at most ${MAX_ABOUT} characters each; an empty string removes it.`),
    contactEmail: { type: "string", maxLength: MAX_EMAIL, description: "Public contact e-mail address, for example hello@example.org. An empty string removes it." },
    logos: { type: "object", description: `Logo slots (${LOGO_SLOTS.join(", ")}) set from an image already on the site: an address like /uploads/<name>.png returned by media_upload (or an upload made in the admin). An empty string removes the logo of that slot. A svg is fine for the logos but not for the sharing image.`, additionalProperties: { type: "string" } },
  },
} as unknown as JsonSchemaLite;

const fp = (v: string) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 16);
const short = (v: string, n = 60) => { const one = v.replace(/\s+/g, " ").trim(); return JSON.stringify(one.length > n ? `${one.slice(0, n - 1)}…` : one); };
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Is this a logo address we accept: a plain `/uploads/<uuid>.<image extension>` that exists on this site. */
async function imageOnSite(value: string): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  const name = uploadNameOf(value);
  // Only the bare address: no crop, no query, no other folder, no outside address (the AI never points the site at somebody else's server).
  if (!name || value !== `/uploads/${name}` || !/\.(png|jpg|webp|gif|svg)$/.test(name)) {
    return { ok: false, why: "must be an image already on this site, written like /uploads/0a1b2c3d-….png (the address media_upload returns). Outside addresses are not accepted" };
  }
  try { if (!(await fs.stat(path.join(UPLOADS_DIR, name))).isFile()) throw new Error("not a file"); } catch { return { ok: false, why: "points to a file that does not exist on this site. Upload the image with media_upload first and use the address it returns" }; }
  return { ok: true, name };
}

/** Current values, in one shape (used by the read tool, the plan and the execution). */
async function current() {
  const config = await getSiteConfig();
  const per = async (key: string) => { const all = await getSettingByLocale(key); return Object.fromEntries(config.locales.map((l) => [l, (all[l] as string | undefined) ?? ""])); };
  const logos = Object.fromEntries(await Promise.all(LOGO_SLOTS.map(async (s) => [s, (await getSetting<string>(LOGO_KEYS[s])) ?? ""]))) as Record<Slot, string>;
  return {
    config, name: await per("site.name"), tagline: await per("site.tagline"), presentation: await per("site.about"),
    contactEmail: ((await getSetting<string>("site.contactEmail")) ?? "").toString(), logos,
  };
}

/** Level 1: what the owner would see in Admin > Settings. No secret exists in these fields. */
export async function siteSettingsGet(): Promise<unknown> {
  const c = await current();
  return {
    name: c.name, tagline: c.tagline, presentation: c.presentation, contactEmail: c.contactEmail || null,
    languages: { default: c.config.defaultLocale, enabled: c.config.locales, note: "Languages are changed by the owner in Admin > Settings only." },
    logos: Object.fromEntries(LOGO_SLOTS.map((s) => [s, c.logos[s] || null])) as Record<keyof LogoSet | string, string | null>,
    limits: { name: MAX_NAME, tagline: MAX_TAGLINE, presentation: MAX_ABOUT },
  };
}

type Change = NonNullable<Plan["site"]>["changes"][number];

/** A forbidden argument gets a sentence that says where the owner does it, before the generic "unexpected argument". */
export function refuseForbidden(args: Record<string, unknown>): void {
  for (const k of Object.keys(args ?? {})) if (k in FORBIDDEN) throw new McpToolError(`"${k}" cannot be changed through MCP. ${FORBIDDEN[k] === "the presentation (use presentation)" ? 'Use the "presentation" argument.' : `Only the owner changes ${FORBIDDEN[k]}, in Admin > Settings.`}`);
}

/** Read only: validates everything (nothing is saved when one value is wrong, and every problem is listed) and freezes old -> new. */
export async function prepareSiteSettings(args: Record<string, unknown>): Promise<Plan> {
  refuseForbidden(args);
  const now = await current();
  const problems: string[] = [];
  const changes: Change[] = [];
  let total = 0;

  const perLocale = (field: "name" | "tagline" | "presentation", max: number, multiline: boolean, canEmpty: boolean) => {
    const given = args[field];
    if (given === undefined) return;
    if (!plainObject(given) || !Object.keys(given).length) { problems.push(`${field}: give an object with one text per language, for example {"${now.config.defaultLocale}": "…"}`); return; }
    for (const [locale, raw] of Object.entries(given)) {
      if (!now.config.locales.includes(locale)) { problems.push(`${field}: the language "${redactSecrets(locale, 12)}" is not enabled on this site (enabled: ${now.config.locales.join(", ")}). Only the owner adds a language, in Admin > Settings`); continue; }
      if (typeof raw !== "string") { problems.push(`${field} (${locale}): must be text`); continue; }
      const value = multiline ? raw.replace(/\r\n?/g, "\n").trim() : raw.replace(/\s+/g, " ").trim();
      if (CONTROL.test(value) || (!multiline && /[\n\r]/.test(raw.trim()))) { problems.push(`${field} (${locale}): remove the control characters${multiline ? "" : " and line breaks"}`); continue; }
      if (value.length > max) { problems.push(`${field} (${locale}): ${value.length} characters, at most ${max}. Shorten it`); continue; }
      if (!value && !canEmpty) { problems.push(`${field} (${locale}): cannot be empty, for example "Etoile Nord"`); continue; }
      total += value.length;
      const from = (now[field] as Record<string, string>)[locale] ?? "";
      if (value !== from) changes.push({ field, locale, from: redactSecrets(from, 200), fromFp: fp(from), to: value });
    }
  };
  perLocale("name", MAX_NAME, false, false);
  perLocale("tagline", MAX_TAGLINE, false, true);
  perLocale("presentation", MAX_ABOUT, true, true);
  if (total > MAX_TOTAL) problems.push(`the texts together are ${total} characters, at most ${MAX_TOTAL} per call. Send the presentation in a separate call`);

  if (args.contactEmail !== undefined) {
    if (typeof args.contactEmail !== "string") problems.push("contactEmail: must be text");
    else {
      const v = args.contactEmail.trim();
      // Same check as the e-mail fields of the admin forms: one address, no name part, no spaces.
      if (v && !(v.length <= MAX_EMAIL && /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\.]{2,}$/.test(v))) problems.push('contactEmail: write one address, for example "hello@example.org"');
      else if (v !== now.contactEmail) changes.push({ field: "contactEmail", from: redactSecrets(now.contactEmail, 200), fromFp: fp(now.contactEmail), to: v });
    }
  }

  if (args.logos !== undefined) {
    if (!plainObject(args.logos) || !Object.keys(args.logos).length) problems.push(`logos: give an object like {"wide": "/uploads/….png"} with slots among ${LOGO_SLOTS.join(", ")}`);
    else for (const [slot, raw] of Object.entries(args.logos)) {
      if (!(LOGO_SLOTS as readonly string[]).includes(slot)) { problems.push(`logos: unknown slot "${redactSecrets(slot, 20)}" (slots: ${LOGO_SLOTS.join(", ")})`); continue; }
      if (typeof raw !== "string") { problems.push(`logos.${slot}: must be an address like /uploads/….png, or an empty string to remove it`); continue; }
      const v = raw.trim();
      const from = now.logos[slot as Slot] ?? "";
      if (v) {
        const r = await imageOnSite(v);
        if (!r.ok) { problems.push(`logos.${slot}: ${r.why}`); continue; }
        if (slot === "share" && r.name.endsWith(".svg")) { problems.push("logos.share: social networks do not show svg images; use a png, jpeg or webp image"); continue; }
      }
      if (v !== from) changes.push({ field: `logo.${slot}`, from: from, fromFp: fp(from), to: v });
    }
  }

  if (problems.length) throw new McpToolError(`Nothing was saved. ${problems.join(". ")}.`);
  if (!changes.length) throw new McpToolError(Object.keys(args).length ? "Nothing to change: these values are already in place." : "Give at least one of: name, tagline, presentation, contactEmail, logos.");
  const names = changes.slice(0, 8).map((c) => `${label(c)}: ${c.from ? short(c.from) : "(empty)"} → ${c.to ? short(c.to) : "(empty)"}`).join("; ") + (changes.length > 8 ? ` (+${changes.length - 8} more)` : "");
  return { site: { changes, names } };
}

const label = (c: Pick<Change, "field" | "locale">): string => c.field.startsWith("logo.") ? SLOT_TEXT[c.field.slice(5) as Slot] ?? c.field : c.field === "contactEmail" ? "contact e-mail" : `${c.field === "presentation" ? "presentation" : c.field}${c.locale ? ` (${c.locale})` : ""}`;

const KEYS: Record<string, string> = { name: "site.name", tagline: "site.tagline", presentation: "site.about" };

/** After the owner's approval (or at once): re-reads the site, refuses when someone changed a value since the request, then writes like the admin form does. */
export async function executeSiteSettings(plan: Plan, actorLabel: string): Promise<Outcome> {
  const wanted = plan.site!.changes;
  const now = await current();
  const stale: string[] = [];
  for (const c of wanted) {
    const here = c.field.startsWith("logo.") ? now.logos[c.field.slice(5) as Slot] ?? "" : c.field === "contactEmail" ? now.contactEmail : ((now as unknown as Record<string, Record<string, string>>)[c.field]?.[c.locale ?? ""] ?? "");
    if (fp(here) !== c.fromFp) stale.push(label(c));
  }
  if (stale.length) return { ok: false, message: `Not done: ${stale.join(", ")} changed since the request (somebody edited it). Read site_settings_get and ask again.` };
  // Logos are checked again: the file must still exist.
  for (const c of wanted) if (c.field.startsWith("logo.") && c.to) {
    const r = await imageOnSite(c.to);
    if (!r.ok) return { ok: false, message: `Not done: ${label(c)} ${r.why}.` };
  }
  for (const c of wanted) {
    if (c.field.startsWith("logo.")) {
      const key = LOGO_KEYS[c.field.slice(5) as keyof typeof LOGO_KEYS];
      if (c.to) await setSetting(key, c.to); else await deleteSetting(key);
    } else if (c.field === "contactEmail") await setSetting("site.contactEmail", c.to);
    else if (c.to) await setSetting(KEYS[c.field]!, c.to, c.locale);
    else await deleteSetting(KEYS[c.field]!, c.locale);
  }
  // The journal keeps the OLD values (cut at 200 characters each): the owner can put them back in Admin > Settings.
  const old = wanted.map((c) => `${label(c)}: was ${c.from ? JSON.stringify(c.from.length >= 200 ? `${c.from}… (cut)` : c.from) : "(empty)"}`).join("; ");
  // Text values were masked when the plan was made; logo addresses are public paths and must stay readable.
  await audit(actorLabel, "settings.update", `${wanted.length} change${wanted.length > 1 ? "s" : ""} by an assistant. ${old}`.slice(0, 4000));
  try { (await import("next/cache")).revalidatePath("/", "layout"); } catch { /* outside a request: nothing to refresh */ }
  return { ok: true, message: `Site settings updated (${plan.site!.names}). The owner can put the old values back in Admin > Settings; they are in the journal.` };
}
