import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { getCoreVersion } from "../modules/compat";
import { rawBase, rawFileUrl, rawGet } from "../modules/rawRead";
import { readSkinCatalogue } from "../skins/catalogue";
import { hasSignature } from "../skins/validate";

/**
 * PREVIEW IMAGE OF A CATALOGUE OVERLAY SKIN (core 0.8.2), served from the site itself: the browser never loads an image from a third-party site.
 * The id must be an overlay entry of the skin catalogue (never an address from the request); the 640 x 360 `.webp` of the entry is read from the repository
 * (one bounded request, https, no redirection: modules/rawRead.ts), checked on its bytes (webp signature, 150 KB at most) and kept in `data/cache`,
 * pinned to the entry's tag, so a skin is read at most once per version and only when its card scrolls into view. Any failure gives null (the page draws a placeholder).
 */
export const PREVIEW_MAX_BYTES = 150 * 1024;
const dir = () => path.join(DATA_DIR, "cache", "overlay-skin-previews");

export async function catalogueSkinPreview(id: string): Promise<Buffer | null> {
  try {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) return null;
    const cat = await readSkinCatalogue({ coreVersion: getCoreVersion() });
    const e = cat.entries.find((x) => x.id === id && x.kind === "overlay");
    if (!e?.preview || !e.subdir || !e.preview.startsWith(`${e.subdir}/`)) return null;
    const file = e.preview.slice(e.subdir.length + 1);
    const key = `${id}-${crypto.createHash("sha256").update(`${e.ref ?? ""}|${e.preview}`).digest("hex").slice(0, 12)}.webp`;
    const cached = path.join(dir(), key);
    try { const b = fs.readFileSync(cached); if (b.length <= PREVIEW_MAX_BYTES && hasSignature(".webp", b)) return b; } catch { /* not cached yet */ }
    const base = rawBase(e.repo, e.ref);
    const url = base ? rawFileUrl(base, e.subdir, file) : null;
    if (!url) return null;
    const bytes = await rawGet(url, PREVIEW_MAX_BYTES);
    if (!bytes || !hasSignature(".webp", bytes)) return null;
    fs.mkdirSync(dir(), { recursive: true });
    for (const old of fs.readdirSync(dir())) if (old.startsWith(`${id}-`) && old !== key) fs.rmSync(path.join(dir(), old), { force: true });
    const tmp = `${cached}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, cached);
    return bytes;
  } catch { return null; }
}

/** What the page shows while a preview is not available: a neutral picture, never an error. */
export const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#2b2d33"/><rect x="40" y="40" width="300" height="90" rx="10" fill="#3a3d46"/><rect x="40" y="160" width="300" height="60" rx="10" fill="#3a3d46"/><rect x="380" y="250" width="220" height="70" rx="10" fill="#3a3d46"/></svg>`;
