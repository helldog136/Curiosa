import { audit } from "@/core/permissions";
import { cleanAlt, DAILY_BYTES, DAILY_FILES, MAX_ALT, saveAlt, storeCheckedImage, TYPE_OF, usedToday } from "@/core/mediaMcp";
import { takeSlot } from "@/core/maintenance/slots";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import type { JsonSchemaLite } from "@/core/modules/types";
import { stripMetadata } from "@/core/stripMetadata";
import { checkTrustedUrl, fetchTrustedImage, shown } from "@/core/trustedImageFetch";
import { listTrustedSources } from "@/core/trustedImageSources";

/**
 * `media_import`: the ONE tool that makes the site download an image, and only from the "trusted image sources" the OWNER wrote in
 * Admin > AI assistants (the list starts empty = the tool answers "off"; no MCP tool can write the list). The download rules are in
 * trustedImageFetch.ts; what happens to the bytes is exactly what `media_upload` does (storeCheckedImage): type from the content, pixel limit,
 * svg only through the logo pipeline, random stored name, alternative text required.
 * Unlike media_upload, EXIF/GPS/XMP/IPTC and comments are removed first from JPEG and the text chunks from PNG (stripMetadata.ts, lossless); WebP and GIF are kept as received. Own right (`aim.tool.media_import`), never granted by default.
 *
 * One slot of the "content" counter per image actually fetched, and the daily quota of the site (shared with media_upload). A list of up to 10
 * images goes in one call; each one is handled in turn and reports for itself, so one failure does not lose the others.
 * Journal: `media.import` = the stored file name, its size, and the web address WITHOUT its query. Never the bytes.
 */
export const MAX_BATCH = 10;

export const MEDIA_IMPORT_INPUT: JsonSchemaLite = {
  type: "object",
  properties: {
    url: { type: "string", maxLength: 2000, description: "One image: its https address, from a trusted image source the owner has set up (for example https://images.example.org/screens/home.png). Use urls instead for several." },
    alt: { type: "string", maxLength: MAX_ALT + 40, description: `With url: the alternative text that describes the image, ${MAX_ALT} characters at most. Required.` },
    urls: {
      type: "array", maxItems: MAX_BATCH,
      description: `Several images in one call, ${MAX_BATCH} at most, each { url, alt }. They are imported one after the other and each has its own result; a failure does not stop the others.`,
      items: { type: "object", properties: { url: { type: "string", maxLength: 2000, description: "https address of the image." }, alt: { type: "string", maxLength: MAX_ALT + 40, description: `Alternative text, ${MAX_ALT} characters at most.` } }, required: ["url", "alt"] },
    },
  },
};

type Actor = { name: string; tokenId?: string };
type Item = { url: string; alt: string };
type Imported = { address: string; id: string; type: string; bytes: number; width?: number; height?: number; alt: string; from: string };
class Stop extends McpToolError {}

async function importOne(item: Item, actor: Actor, sources: Awaited<ReturnType<typeof listTrustedSources>>): Promise<Imported> {
  const alt = cleanAlt(item.alt);
  checkTrustedUrl(item.url, sources); // refuses before any slot is used or any connection is made
  try { await takeSlot(actor.tokenId, "content"); } catch (error) { throw error instanceof McpToolError ? new Stop(error.message) : error; }
  const day = await usedToday();
  if (day.files >= DAILY_FILES || day.bytes >= DAILY_BYTES) throw new Stop(`The daily image quota of the site is used up (${DAILY_FILES} images or ${DAILY_BYTES / 1024 / 1024} MB per 24 hours, all assistants together). Try again later, or the owner can upload in the admin.`);
  const got = await fetchTrustedImage(item.url, sources);
  if (day.bytes + got.bytes.length > DAILY_BYTES) throw new Stop(`The daily image quota of the site is used up (${DAILY_FILES} images or ${DAILY_BYTES / 1024 / 1024} MB per 24 hours, all assistants together). Try again later, or the owner can upload in the admin.`);
  const { address, name, kind, size, stored } = await storeCheckedImage(stripMetadata(got.bytes), "import");
  await saveAlt(name, alt);
  const origin = shown(got.requested);
  const via = shown(got.from) !== origin ? ` via ${shown(got.from)}` : "";
  await audit(`mcp:${actor.name}`, "media.import", `${name} ${stored} bytes from ${origin}${via}`);
  return { address, id: name, type: TYPE_OF[kind]!, bytes: stored, ...(size.width ? { width: size.width, height: size.height } : {}), alt, from: origin };
}

/** Never put a query in an answer: it can hold a secret. */
function safeLabel(raw: string): string {
  try { const u = new URL(raw); return shown(u); } catch { return String(raw).slice(0, 80).replace(/[?#].*$/, ""); }
}

export async function mediaImport(rawArgs: Record<string, unknown>, actor: Actor): Promise<unknown> {
  const args = validateArgs(MEDIA_IMPORT_INPUT, rawArgs);
  const list = args.urls as Item[] | undefined;
  const single = args.url !== undefined || args.alt !== undefined;
  if (list && single) throw new McpToolError('Give either "url" and "alt" for one image, or "urls" for several, not both.');
  if (!list && !single) throw new McpToolError('Give "url" and "alt" for one image, or "urls": [{ "url": …, "alt": … }] for several.');
  if (single && (!args.url || !args.alt)) throw new McpToolError('Both "url" and "alt" are required (the alternative text describes the image).');
  if (list && list.length === 0) throw new McpToolError('"urls" is empty. Give at least one { url, alt }.');
  const items: Item[] = list ?? [{ url: String(args.url), alt: String(args.alt) }];

  const sources = await listTrustedSources();
  if (sources.length === 0) throw new McpToolError("Importing images from an address is off: the owner has not set up any trusted image source. The owner can add one in Admin > AI assistants > Trusted image sources. Until then, send the image itself with media_upload.");

  const results: ({ ok: true; url: string } & Imported | { ok: false; url: string; error: string })[] = [];
  let stopped: string | null = null;
  for (const item of items) {
    const url = safeLabel(item.url);
    if (stopped) { results.push({ ok: false, url, error: `Not tried: ${stopped}` }); continue; }
    try { results.push({ ok: true, url, ...(await importOne(item, actor, sources)) }); }
    catch (error) {
      if (!(error instanceof McpToolError)) throw error;
      if (error instanceof Stop) stopped = error.message;
      results.push({ ok: false, url, error: error.message });
    }
  }
  const imported = results.filter((r) => r.ok).length;
  if (!list) {
    const only = results[0]!;
    if (!only.ok) throw new McpToolError(only.error);
    const { ok: _ok, url: _url, ...rest } = only; void _ok; void _url;
    return { ...rest, usage: "Use this address in a Markdown image ![alt](address), in site_settings_set (logos), or in an image setting of a module (maintenance_module_configure)." };
  }
  return { imported, failed: results.length - imported, results, ...(imported ? { usage: "Use each address in a Markdown image ![alt](address), in site_settings_set (logos), or in an image setting of a module." } : {}) };
}
