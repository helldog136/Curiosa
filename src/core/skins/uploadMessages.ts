/**
 * Words for the owner when a dropped file is refused (core 0.46.1): every refusal says what is wrong, what to do, and gives one example, in plain words.
 * No code, no path trace. The sentences live in the language files (`skins.upload.*`, `skins.upload.issue.*`); this file only chooses which one.
 */
import type { SkinIssue } from "./messages";

/** The refusals of the skin check that a person making a skin by hand is likely to meet: they get a sentence of their own (the others read as the check says them). */
export const FRIENDLY_ISSUES = ["manifest-unreadable", "skin-file-unlisted", "asset-missing", "tokens-missing", "stylesheet-missing", "asset-license-missing", "asset-signature", "asset-svg-refused"] as const;

/** Several codes say the same thing to the owner. */
const SAME: Record<string, string> = { ambiguous: "unusual", overlap: "unusual", method: "unusual", zip64: "unusual", ratio: "too-large" };

/** The language key of a refusal (`skins.upload.*` from the zip and the layout, `skins.error.*` from the skin check). */
export function uploadErrorKey(error: string): string {
  const m = /^skins\.upload\.(.+)$/.exec(error);
  return m ? `skins.upload.${SAME[m[1]!] ?? m[1]!}` : error;
}

/** The file a message names, between parentheses (the check puts it there). */
const fileOf = (message: string): string => /\(([^()]{1,120})\)/.exec(message)?.[1] ?? "";

export function friendlyIssue(issue: SkinIssue, t: (key: string, params?: Record<string, string | number>) => string, locale: string): string {
  if ((FRIENDLY_ISSUES as readonly string[]).includes(issue.code)) return t(`skins.upload.issue.${issue.code}`, { file: fileOf(locale === "fr" ? issue.message.fr : issue.message.en) });
  return locale === "fr" ? issue.message.fr : issue.message.en;
}
