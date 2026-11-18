import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { deleteSetting, getSetting, setSetting } from "@/core/settings";
import type { Grants, Scope } from "./access";

/**
 * What the assistant was last shown: the revision of the rights and of the installed features, and the names of the tools of its list, written by `tools/list`.
 *
 * The server is stateless and cannot push a notice (`listChanged` is false, docs/MAINTENANCE-IA.md), so "did my list change since I connected?" is computed when the
 * assistant asks (`maintenance_my_access`, `maintenance_status`): the revision now against the one recorded by the last `tools/list` of this access. A client that fetches its
 * list again gets the new baseline. Several clients on one access share the baseline: the last one to list wins (the answer then says "since the list was last sent").
 * One setting per access (`mcp.listSeen.<id>`), written only when something changed, removed when the access is revoked. No secret, no tool argument.
 */
export type ListSeen = { rev: string; names: string[]; at: string };

const KEY = (tokenId: string) => `mcp.listSeen.${tokenId}`;
const MAX_NAMES = 1000;

/** The revision: the ceiling, the explicit grants and which feature instances exist (not their versions: an update that adds no tool is not a change for the assistant). */
export function accessRevision(token: { scope: Scope; grants: Grants }, instances: { key: string; moduleId: string }[]): string {
  const grants = Object.entries(token.grants).sort(([a], [b]) => (a < b ? -1 : 1));
  const inst = instances.map((i) => `${i.key}:${i.moduleId}`).sort();
  return crypto.createHash("sha256").update(JSON.stringify([token.scope, grants, inst])).digest("hex").slice(0, 16);
}

/** The revision of this access now: one cheap query (feature instances), the rights are already in `token`. */
export async function revisionNow(token: { scope: Scope; grants: Grants }): Promise<string> {
  return accessRevision(token, await prisma.moduleInstance.findMany({ select: { key: true, moduleId: true } }));
}

export async function readListSeen(tokenId: string): Promise<ListSeen | null> {
  const v = await getSetting<Partial<ListSeen>>(KEY(tokenId));
  return v && typeof v.rev === "string" && Array.isArray(v.names) ? { rev: v.rev, names: v.names.filter((n): n is string => typeof n === "string"), at: typeof v.at === "string" ? v.at : "" } : null;
}

/** Called by `tools/list`. Never throws: a failure here must not break the list. */
export async function recordListSeen(tokenId: string, rev: string, names: string[]): Promise<void> {
  try {
    const sorted = [...names].sort().slice(0, MAX_NAMES);
    const before = await readListSeen(tokenId);
    if (before && before.rev === rev && before.names.join("\n") === sorted.join("\n")) return;
    await setSetting(KEY(tokenId), { rev, names: sorted, at: new Date().toISOString() } satisfies ListSeen);
  } catch { /* the baseline is a convenience */ }
}

export async function forgetListSeen(tokenId: string): Promise<void> {
  await deleteSetting(KEY(tokenId)).catch(() => {});
}

export type ListChange = {
  /** `null`: this access never fetched its list (or the baseline is gone): nothing to compare. */
  baselineAt: string | null;
  /** The revision moved since the list was sent. */
  changed: boolean;
  /** With the names of the current list: what appeared and what went away (at most 30 each). Absent when the names were not computed. */
  added?: string[];
  removed?: string[];
};

/** `currentNames`: the names the assistant would get now (omitted by callers that must stay cheap: the answer is then only "the revision moved"). */
export function compareListSeen(seen: ListSeen | null, rev: string, currentNames?: string[]): ListChange {
  if (!seen) return { baselineAt: null, changed: false };
  if (!currentNames) return { baselineAt: seen.at || null, changed: seen.rev !== rev };
  const before = new Set(seen.names);
  const now = new Set(currentNames);
  const added = [...now].filter((n) => !before.has(n)).sort();
  const removed = [...before].filter((n) => !now.has(n)).sort();
  // The names are authoritative: a revision that moved with the same list (a right switched on that the access ceiling blocks) is not a reason to reconnect.
  return { baselineAt: seen.at || null, changed: added.length + removed.length > 0, added: added.slice(0, 30), removed: removed.slice(0, 30) };
}
