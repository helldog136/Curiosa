import type { Redirect } from "@prisma/client";
import { prisma } from "@/core/db";
import { makeTranslator } from "@/core/i18n/dictionary";
import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { endInstant, formatEnd } from "./redirectEnd";
import { cleanPastedAddress, createRedirectRecord, deleteRedirectRecord, listRedirects, normalizeRedirectPath, proposeRedirectPath, redirectShortUrl, redirectState, updateRedirectRecord, MAX_END_MESSAGE, type RedirectFail } from "./redirects";
import { redirectStats } from "./redirectStats";
import { destinationKey, destinationSummary, GROUP_MAX_LINKS, type DestinationGroup } from "./redirectGroups";
import { getSiteConfig } from "./settings";
import { siteTimezone } from "./siteTime";

/**
 * OUTILS MCP DES LIENS COURTS (redirections) : lister et lire les chiffres (lecture), créer et modifier (écriture), supprimer (destructif).
 * Les mêmes règles que l'écran d'administration (redirects.ts) : adresses http(s) seulement, noms réservés refusés, le nom court d'un lien ne change jamais
 * (il est dans le QR code imprimé), une date de fin vaut « jusqu'à la fin de ce jour » à l'heure du site.
 * Écriture et suppression ne sont JAMAIS accordées d'office à un jeton ; les erreurs sont lisibles par l'agent, en anglais, avec un nom court de remplacement si le nom est pris.
 * `redirects_summary` est un outil À PART (et non un paramètre de `redirects_stats`) : `redirects_stats` répond pour UN lien et exige son identifiant ; le total par destination
 * répond par une LISTE classée (autre forme de réponse, autre borne : 200 liens, 30 jours). Un outil par forme évite un schéma « l'un ou l'autre » que les assistants remplissent
 * mal, et un jeton qui a reçu `redirects_stats` ne reçoit rien de plus sans le décider (chaque outil est accordé séparément).
 * Aucun de ces outils ne renvoie de secret, ni de provenance ou d'adresse de visiteur (il n'en existe pas).
 */
const en = makeTranslator("en");
const str = (max = 2000) => ({ type: "string" as const, maxLength: max });

const view = (r: Redirect, tz: string) => ({
  id: r.id, path: r.path, address: redirectShortUrl(r.path), target: r.targetUrl, followsEntry: !!r.entryId, permanent: r.permanent,
  state: redirectState(r), endsAt: r.expiresAt ? r.expiresAt.toISOString() : null, endsOn: r.expiresAt ? formatEnd(r.expiresAt, tz, "en") : null,
  endMessage: r.endMessage || null, visits: r.hits, createdAt: r.createdAt.toISOString(),
});

async function find(ref: string): Promise<Redirect> {
  const row = (await prisma.redirect.findUnique({ where: { id: ref } })) ?? (await prisma.redirect.findUnique({ where: { path: normalizeRedirectPath(ref) } }));
  if (!row) throw new McpToolError("redirect not found: pass the \"id\" or the short name (path) of an existing link");
  return row;
}

const groupView = (g: DestinationGroup, rank: number, withSeries: boolean) => ({
  rank, destination: g.destination, today: g.today, week: g.week, month: g.month, total: g.total,
  aliases: g.links.map((l) => ({ id: l.id, path: l.path, address: redirectShortUrl(l.path), state: l.state, today: l.today, week: l.week, month: l.month, total: l.total })),
  ...(withSeries ? { series: g.series } : {}),
});

async function failure(fail: RedirectFail, targetUrl?: string): Promise<never> {
  let message = en(fail.key);
  if (fail.field === "path" && (fail.key === "redirects.error.exists" || fail.key === "redirects.error.reserved" || fail.key === "redirects.error.path")) {
    message += ` Suggestion: "${await proposeRedirectPath({ url: targetUrl, siteName: (await getSiteConfig()).name })}".`;
  }
  throw new McpToolError(`${fail.field}: ${message}`);
}

async function endFrom(a: Record<string, unknown>, current?: Date | null): Promise<Date | null | undefined> {
  if (a.endDate === undefined) return undefined; // pas demandé : inchangé
  const at = endInstant(String(a.endDate), String(a.endTime ?? ""), await siteTimezone());
  if (at === undefined) throw new McpToolError("endDate: use YYYY-MM-DD (and endTime as HH:MM), or an empty string to remove the end date");
  if (at && at.getTime() <= Date.now() && at.getTime() !== current?.getTime()) throw new McpToolError("endDate: " + en("redirects.error.datePast"));
  return at;
}

export const redirectsToolProvider: McpToolProvider = {
  id: "redirects",
  async list() {
    const base = { source: "core", destructive: false };
    const listSchema: JsonSchemaLite = { type: "object", properties: { q: str(100), page: { type: "integer", minimum: 1, maximum: 100000 } } };
    const statsSchema: JsonSchemaLite = { type: "object", required: ["redirect"], properties: { redirect: str(80) } };
    const summarySchema: JsonSchemaLite = { type: "object", properties: { destination: str(2000) } };
    const writeProps = {
      targetUrl: str(2000), endDate: str(10), endTime: str(5), endMessage: str(MAX_END_MESSAGE), permanent: { type: "boolean" as const },
    };
    const createSchema: JsonSchemaLite = { type: "object", required: ["targetUrl"], properties: { path: str(80), ...writeProps } };
    const updateSchema: JsonSchemaLite = { type: "object", required: ["redirect"], properties: { redirect: str(80), ...writeProps, active: { type: "boolean" } } };
    const deleteSchema: JsonSchemaLite = { type: "object", required: ["redirect"], properties: { redirect: str(80) } };

    const tools: McpTool[] = [
      {
        ...base, name: "redirects_list", title: "Short links: list", readOnly: true, default: true, input: listSchema,
        description: "List the site's short links (redirects), newest first, 50 per page. Each has: id, path (short name), address (the full short address, which is what its QR code contains), target, state (active, ended or off), endsAt, visits (total). Optional \"q\" searches names and targets; \"page\" selects the page. Answer: { items, total, page, pages }.",
        call: async (raw) => {
          const a = validateArgs(listSchema, raw);
          const [tz, data] = await Promise.all([siteTimezone(), listRedirects({ q: a.q as string | undefined, page: a.page as number | undefined })]);
          return { items: data.items.map((r) => view(r, tz)), total: data.total, page: data.page, pages: data.pages };
        },
      },
      {
        ...base, name: "redirects_stats", title: "Short links: statistics", readOnly: true, default: true, input: statsSchema,
        description: "Visits of one short link (\"redirect\" = its id or short name): today, last 7 days, last 30 days, total, and the last 30 days day by day. Counts are anonymous per-day totals (robots and message previews are not counted; no IP address, cookie or origin is kept).",
        call: async (raw) => {
          const a = validateArgs(statsSchema, raw);
          const row = await find(a.redirect as string);
          const stats = (await redirectStats(row.id))!;
          return { id: row.id, path: row.path, address: redirectShortUrl(row.path), ...stats };
        },
      },
      {
        ...base, name: "redirects_summary", title: "Short links: totals by destination", readOnly: true, default: true, input: summarySchema,
        description: "Total visits per DESTINATION: short links that lead to the same address (/instagram, /ig, /insta) are added together (same address ignoring http/https, www., capital letters in the domain, a trailing slash and tracking parameters such as utm_*; other parameters count). Answer: { destinations: [{ rank, destination, today, week, month (30 days), total, aliases: [{ path, address, state, today, week, month, total }] }], linksRead, linksTotal, truncated, hidden }, best-visited first. At most " + GROUP_MAX_LINKS + " links (the most visited) and 30 days are read; 50 destinations are returned. Optional \"destination\" (an address, or the short name of one link) answers for that one destination only, with its last 30 days day by day (\"series\"). Anonymous per-day totals only: robots and message previews are not counted and no IP address, cookie or origin is kept.",
        call: async (raw) => {
          const a = validateArgs(summarySchema, raw);
          const sum = await destinationSummary();
          const rest = { linksRead: sum.linksRead, linksTotal: sum.linksTotal, truncated: sum.linksTotal > sum.linksRead || sum.hidden > 0, hidden: sum.hidden };
          const ask = typeof a.destination === "string" ? a.destination.trim() : "";
          if (!ask) return { destinations: sum.groups.map((g, i) => groupView(g, i + 1, false)), ...rest };
          // Un nom court connu désigne la destination de ce lien ; sinon on comprend l'adresse comme on le fait à la saisie.
          const byName = sum.groups.findIndex((g) => g.links.some((l) => l.path === normalizeRedirectPath(ask)));
          const key = byName >= 0 ? sum.groups[byName]!.key : destinationKey(cleanPastedAddress(ask));
          const at = sum.groups.findIndex((g) => g.key === key);
          if (!key || at < 0) throw new McpToolError("destination not found: pass an address that one of your short links leads to, or the short name of one of them (see redirects_summary without arguments)");
          return { destinations: [groupView(sum.groups[at]!, at + 1, true)], ...rest };
        },
      },
      {
        ...base, name: "redirects_create", title: "Short links: create", readOnly: false, default: false, audited: true, input: createSchema,
        description: "Create a short link. \"targetUrl\" is required (an http(s) address; a missing https:// is added). \"path\" is the short name (lowercase letters, digits, - and _); leave it out and a readable one is suggested. The short name can never be changed later because it is inside the printed QR code. Optional: \"endDate\" (YYYY-MM-DD, the link works until the end of that day, site time) with \"endTime\" (HH:MM), \"endMessage\" shown on the ended-link page, \"permanent\" (301/308). Answer: the new link, including its full short \"address\".",
        call: async (raw, actor) => {
          const a = validateArgs(createSchema, raw);
          const expiresAt = await endFrom(a);
          const result = await createRedirectRecord({ path: a.path as string | undefined, targetUrl: a.targetUrl as string, permanent: a.permanent as boolean | undefined, expiresAt: expiresAt ?? null, endMessage: a.endMessage as string | undefined }, { siteName: (await getSiteConfig()).name });
          if (!result.ok) return failure(result.fail, a.targetUrl as string);
          await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, action: "redirect.create", target: result.redirect.path } }).catch(() => {});
          return view(result.redirect, await siteTimezone());
        },
      },
      {
        ...base, name: "redirects_update", title: "Short links: update", readOnly: false, default: false, audited: true, input: updateSchema,
        description: "Change a short link (\"redirect\" = its id or short name). Only the fields you pass change: \"targetUrl\" (the QR code and short name stay the same), \"endDate\"/\"endTime\" (an empty \"endDate\" removes the end date, which also turns an ended link back on), \"endMessage\", \"permanent\", \"active\" (false pauses it: visitors see the same 404 as for an unknown link). The short name itself cannot be changed.",
        call: async (raw, actor) => {
          const a = validateArgs(updateSchema, raw);
          const row = await find(a.redirect as string);
          const expiresAt = await endFrom(a, row.expiresAt);
          const result = await updateRedirectRecord(row.id, {
            ...(a.targetUrl !== undefined ? { targetUrl: a.targetUrl as string } : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
            ...(a.endMessage !== undefined ? { endMessage: a.endMessage as string } : {}),
            ...(a.permanent !== undefined ? { permanent: a.permanent as boolean } : {}),
            ...(a.active !== undefined ? { active: a.active as boolean } : {}),
          });
          if (!result.ok) return failure(result.fail);
          await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, action: "redirect.update", target: row.path } }).catch(() => {});
          return view(result.redirect, await siteTimezone());
        },
      },
      {
        ...base, name: "redirects_delete", title: "Short links: delete", readOnly: false, default: false, destructive: true, audited: true, input: deleteSchema,
        description: "Permanently delete a short link and its statistics (\"redirect\" = its id or short name). QR codes already printed for it will lead to a \"page not found\". To pause a link without losing anything, use redirects_update with active=false instead.",
        call: async (raw, actor) => {
          const a = validateArgs(deleteSchema, raw);
          const row = await find(a.redirect as string);
          const path = await deleteRedirectRecord(row.id);
          if (path !== null) await prisma.auditLog.create({ data: { actor: `mcp:${actor.name}`, action: "redirect.delete", target: path } }).catch(() => {});
          return { deleted: path !== null, path: row.path };
        },
      },
    ];
    return tools;
  },
};
