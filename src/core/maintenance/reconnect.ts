import type { Translator } from "@/core/i18n/dictionary";
import { compareListSeen, readListSeen, revisionNow } from "@/core/services/mcp/listSeen";
import type { Grants, Scope } from "@/core/services/mcp/access";

/**
 * "Do I have to reconnect?", computed when the assistant asks (the site cannot push a notice, see docs/MAINTENANCE-IA.md).
 * `reconnectNeeded` is true when the rights of this access or the installed features changed after the last time the tool list was sent to a client of this access
 * (the baseline `tools/list` records, listSeen.ts). `sayToTheUser` is one short sentence the assistant can repeat to the owner as it is, in the site language.
 * `currentNames`: the names of the tools the access has now (my_access has them; status stays cheap and only compares the revision, so it can over-report).
 */
export async function reconnectView(tokenId: string | undefined, token: { scope: Scope; grants: Grants }, t: Translator, currentNames?: string[]) {
  const seen = tokenId ? await readListSeen(tokenId).catch(() => null) : null;
  const change = compareListSeen(seen, await revisionNow(token).catch(() => ""), currentNames);
  if (!change.changed) {
    return { reconnectNeeded: false, toolsChangedSince: change.baselineAt ? { listSentAt: change.baselineAt, added: [] as string[], removed: [] as string[] } : null };
  }
  // Without the names (status stays cheap) the sentence has no detail; the assistant can call maintenance_my_access for them.
  const parts = [change.added?.length ? t("aim.my.detail.added", { n: change.added.length }) : "", change.removed?.length ? t("aim.my.detail.removed", { n: change.removed.length }) : ""].filter(Boolean);
  return {
    reconnectNeeded: true,
    toolsChangedSince: { listSentAt: change.baselineAt, added: change.added ?? [], removed: change.removed ?? [] },
    sayToTheUser: parts.length ? t("aim.my.changed.say", { detail: parts.join(", ") }) : t("aim.my.changed.say.short"),
  };
}
