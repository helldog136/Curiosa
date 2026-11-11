import { toolDescriptionLang, toolGrantedByDefault } from "@/core/modules/mcpProvider";
import type { ParsedManifest } from "@/core/modules/manifest";
import { MAINTENANCE_PROFILE, withinCeiling, type Grants, type Scope } from "@/core/services/mcp/access";
import type { Translator } from "@/core/i18n/dictionary";

/**
 * The AI tools a module ADDS, read from its manifest (`mcp` + the `i18n` overlay): no data entry per module. Used by the catalogue sheet and plan, so that an assistant can say
 * "installing X would let me do Y; you would need to tick Z".
 *
 *  - `kind`: read / write / destructive (the same words as maintenance_my_access);
 *  - `summary`: the first sentence of the description, in the site language when the module provides it, else in English (`textLanguage: "en"`);
 *  - `grantedByDefault`: what a new access gets, as the module declared it;
 *  - `forYourAccess` (when the caller's access is known): `granted_once_installed`, `owner_must_tick` or `access_is_read_only`;
 *  - `rightToTick`: the plain sentence the owner finds on the rights page (the same text as the summary), only when a box has to be ticked.
 * Names, sentences and flags only: no setting value, no secret.
 */
export type DeclaredTool = {
  name: string;
  readOnly: boolean;
  kind: "read" | "write" | "destructive";
  summary: string;
  grantedByDefault: boolean;
  forYourAccess?: "granted_once_installed" | "owner_must_tick" | "access_is_read_only";
  rightToTick?: string;
  textLanguage?: string;
};

const firstSentence = (text: string, max: number): string => {
  const s = text.replace(/^\[[^\]]*\]\s*/, "").split(/(?<=[.!?])\s/)[0]!.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** `access`: the caller's ceiling and grants, when known. `wanted`: the site language (a text found in another language is flagged). */
export function declaredTools(manifest: Pick<ParsedManifest, "mcp" | "i18n">, opts: { locale: string; main: string; access?: { scope: Scope; grants: Grants } | null; instanceKey?: string }): DeclaredTool[] {
  return (manifest.mcp ?? []).slice(0, 40).map((decl) => {
    const { text, lang } = toolDescriptionLang(manifest, decl.name, decl.description, opts.locale, opts.main);
    const readOnly = decl.readOnly === true;
    const byDefault = toolGrantedByDefault(decl);
    const summary = firstSentence(text, 140);
    // A token with the "maintenance" marker never has module tools on by default; every other token follows the module.
    const access = opts.access;
    const explicit = access && opts.instanceKey ? access.grants[`${opts.instanceKey}__${decl.name}`] : undefined;
    const enabledByDefault = explicit ?? (access && access.grants[MAINTENANCE_PROFILE] === true ? false : byDefault);
    const forYourAccess: DeclaredTool["forYourAccess"] | undefined = !access ? undefined : !withinCeiling({ readOnly }, access.scope) ? "access_is_read_only" : enabledByDefault ? "granted_once_installed" : "owner_must_tick";
    return {
      name: decl.name,
      readOnly,
      kind: decl.destructive ? "destructive" : readOnly ? "read" : "write",
      summary,
      grantedByDefault: byDefault,
      ...(forYourAccess ? { forYourAccess } : {}),
      ...(forYourAccess === "owner_must_tick" ? { rightToTick: summary } : {}),
      ...(lang.split("-")[0] !== opts.locale.split("-")[0] ? { textLanguage: lang } : {}),
    };
  });
}

/** The whole block for a sheet: the tools, how many lack a text in the site language, and one sentence ready to tell the owner. Empty when the module adds no tool. */
export function toolsBlock(name: string, tools: DeclaredTool[], t: Translator, wantedLanguage: string): { tools: DeclaredTool[]; note: string; languageGap?: string; sayToTheOwner?: string } | null {
  if (!tools.length) return null;
  const shown = (list: DeclaredTool[]) => list.slice(0, 4).map((x) => x.summary.replace(/[.!?]$/, "")).join("; ") + (list.length > 4 ? "…" : "");
  const now = tools.filter((x) => x.forYourAccess === "granted_once_installed");
  const tick = tools.filter((x) => x.forYourAccess === "owner_must_tick");
  const blocked = tools.filter((x) => x.forYourAccess === "access_is_read_only");
  const untranslated = tools.filter((x) => x.textLanguage).length;
  const say = [
    now.length ? t("aim.mod.say.now", { name, list: shown(now) }) : "",
    tick.length ? t("aim.mod.say.tick", { list: shown(tick) }) : "",
    blocked.length ? t("aim.mod.say.readonly", { n: blocked.length }) : "",
  ].filter(Boolean).join(" ");
  return {
    tools,
    note: t("aim.mod.tools.note"),
    ...(untranslated ? { languageGap: t("aim.mod.lang.gap", { n: untranslated, lang: wantedLanguage }) } : {}),
    ...(say ? { sayToTheOwner: say } : {}),
  };
}
