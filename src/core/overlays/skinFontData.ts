import fs from "node:fs";
import { encodeCssString } from "../skins/valueTokens";
import { resolveSkinAsset } from "../skins/serve";
import type { OverlayFont } from "./skinFonts";

/**
 * (core 0.47.0) The sample scene of an overlay skin (overlays/sample.ts) is shown in a sandboxed frame WITHOUT the site's origin, so it cannot fetch a font from the site:
 * its copy of the sheet carries the skin's fonts as `data:` addresses instead (administration only, read from the installed files through the same checks as the public
 * serving, `skins/serve.ts`). A font that cannot be read stays an address: the sample then shows the fallback list, never an error.
 */
const URL_RE = /^\/skins\/([a-z][a-z0-9-]{1,40})\/(\d+\.\d+\.\d+)\/fonts\/([a-z0-9][a-z0-9._-]{0,63}\.woff2)$/;

export function inlineSkinFonts(css: string, fonts: readonly OverlayFont[], root?: string): { css: string; inlined: number } {
  let out = css, inlined = 0;
  for (const f of fonts) {
    const m = URL_RE.exec(f.url);
    const asset = m ? (root ? resolveSkinAsset(m[1]!, m[2]!, "fonts", m[3]!, root) : resolveSkinAsset(m[1]!, m[2]!, "fonts", m[3]!)) : null;
    if (!asset) continue;
    try {
      const b64 = fs.readFileSync(asset.file).toString("base64");
      const needle = `url(${encodeCssString(f.url)})`;
      if (out.includes(needle)) { out = out.split(needle).join(`url("data:font/woff2;base64,${b64}")`); inlined++; }
    } catch { /* unreadable: the address stays, the fallback list shows */ }
  }
  return { css: out, inlined };
}
