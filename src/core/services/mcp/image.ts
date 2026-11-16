/**
 * IMAGE RESULTS of MCP tools (core 0.25.0, additive). A tool normally answers with JSON, which the server sends as one `text` content item. A tool that has
 * a picture to show (the approximate render of a composition, for example) returns `mcpImage(data, mimeType, info)` instead: the server then answers with
 * an `image` content item (base64, MCP "image" content) AND the `text` item of `info`, so a client that does not show pictures still reads the JSON.
 *
 * The mark is a global symbol (`Symbol.for`), so a module builds the same object through `ctx.overlay.mcpImage` without importing the core. Bounds: PNG,
 * JPEG or WebP only, 1 MB at most (larger: the server sends the text alone, and says why); an unknown type is never sent.
 */
export const MCP_IMAGE = Symbol.for("curiosa.mcp.image");
export const MCP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MCP_IMAGE_MAX = 1_000_000;
export type McpImageType = (typeof MCP_IMAGE_TYPES)[number];
export type McpImage = { readonly [MCP_IMAGE]: true; readonly data: Uint8Array; readonly mimeType: McpImageType; readonly info: unknown };

/** An image result for an MCP tool (see the file header). Throws on a type other than PNG, JPEG or WebP: the module made a mistake, never the assistant. */
export function mcpImage(data: Uint8Array, mimeType: string, info: unknown = null): McpImage {
  if (!(MCP_IMAGE_TYPES as readonly string[]).includes(mimeType)) throw new Error(`mcpImage: ${mimeType} is not PNG, JPEG or WebP`);
  if (!(data instanceof Uint8Array)) throw new Error("mcpImage: data must be bytes");
  return Object.freeze({ [MCP_IMAGE]: true as const, data, mimeType: mimeType as McpImageType, info });
}
export const isMcpImage = (v: unknown): v is McpImage => !!v && typeof v === "object" && (v as Record<symbol, unknown>)[MCP_IMAGE] === true;

/** The `content` of a tool result: the text (JSON) as before, or (an image result) the picture then its text. */
export function toolContent(result: unknown): { type: string; [k: string]: unknown }[] {
  const text = (v: unknown) => ({ type: "text", text: JSON.stringify(v ?? null, null, 2).slice(0, 200_000) });
  if (!isMcpImage(result)) return [text(result)];
  const ok = (MCP_IMAGE_TYPES as readonly string[]).includes(result.mimeType) && result.data instanceof Uint8Array && result.data.length > 0 && result.data.length <= MCP_IMAGE_MAX;
  if (!ok) return [text({ ...(result.info && typeof result.info === "object" ? result.info : { info: result.info }), image: `not sent: ${result.data?.length ?? 0} bytes, ${MCP_IMAGE_MAX} at most` })];
  return [{ type: "image", data: Buffer.from(result.data).toString("base64"), mimeType: result.mimeType }, text(result.info)];
}
