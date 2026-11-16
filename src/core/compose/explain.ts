/**
 * The problems of a composition in plain English (core 0.25.0), one sentence per problem, for an assistant that fixes everything at once (MCP tools of the
 * modules). People never read these: the editor writes its own words in their language. Pure.
 */
import { LIMITS, type ComposeError } from "./model";

const BOX = /^boxes\[(\d+)\]\.?(.*)$/;
/** "boxes[1].size" → "text box 2, size". */
function where(path: string): string {
  if (!path) return "The composition";
  const m = BOX.exec(path);
  if (m) return m[2] ? `Text box ${Number(m[1]) + 1} (boxes[${m[1]}].${m[2]})` : `Text box ${Number(m[1]) + 1} (boxes[${m[1]}])`;
  return path;
}

export function explainComposeError(e: ComposeError, opts: { variables?: readonly string[] } = {}): string {
  const d = e.detail ?? {};
  const at = where(e.path);
  switch (e.code) {
    case "json": return "The composition is not valid JSON. Send one JSON object as a string.";
    case "format": return `${at} has the wrong shape (an object, a list or a text was expected there).`;
    case "version": return `v must be ${d.expected ?? 1}.`;
    case "unknown_key": return `${e.path} is not a known key. Known keys here: ${d.known ?? "see composition_get"}.`;
    case "required": return `${at} is missing.`;
    case "boxes": return `A composition has ${d.min ?? 1} to ${d.max ?? LIMITS.boxes} text boxes (${d.given ?? "?"} were sent).`;
    case "variable": return `${at} uses {${String(d.unknown ?? "?").split(", ").join("}, {")}}; this place knows ${(opts.variables?.length ? opts.variables : String(d.known ?? "").split(", ").filter(Boolean)).map((v) => `{${v}}`).join(", ") || "no automatic value"}.`;
    case "file": return e.path === "backdrop.poster" ? "backdrop.poster must be a picture (png, jpg, webp) of this site." : `${at}: the backdrop must be the file this composition belongs to (src), a picture, GIF or video of this site.`;
    case "size": return `The composition is ${d.length ?? "?"} characters once written; ${d.max ?? LIMITS.bytes} at most. Remove a box or shorten texts.`;
    case "choice": {
      if (d.videoOnly) return `${at} belongs to a video backdrop; leave it out for a picture or a GIF (a GIF always loops).`;
      if (d.duplicate) return `${at}: the id "${d.duplicate}" is used twice; give each box its own id (1 to 8 lower-case letters or digits).`;
      return `${at} is not one of: ${d.allowed ?? "the listed values"}.`;
    }
    case "range": {
      if (d.step) return `${at} goes by steps of ${d.step}.`;
      if (d.length !== undefined) return `${at} is ${d.length} characters; ${d.max} at most.`;
      if (d.min !== undefined && d.max !== undefined) return `${at} must be between ${d.min} and ${d.max}${/\.(size|minSize)$/.test(e.path) ? " (px on a frame 1080 high)" : /\.(x|y|w|h)$/.test(e.path) ? " (percent of the frame; x + w and y + h stay within 100)" : /seconds|\.at$|\.dur$/.test(e.path) ? " (seconds)" : ""}.`;
      if (d.max !== undefined) return `${at}: ${d.max} at most.`;
      return `${at} is out of bounds.`;
    }
    default: return `${at}: ${e.code}.`;
  }
}
/** Every problem, one sentence each, in the checker's order. */
export const explainComposeErrors = (errors: ComposeError[], opts: { variables?: readonly string[] } = {}): string[] => errors.map((e) => explainComposeError(e, opts));
