// A real, tiny, licensed font and a builder of overlay skin folders that embark it (core 0.47.0, contract 6). The font is Fredoka (SIL OFL 1.1), already shipped with the core in
// fonts/files/ (fonts/CREDITS.md); the skin folders are made in a temporary directory, with invented names only.
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./tmp.mjs";

export const FONT_FILE = "fonts/files/fredoka-400-latin.woff2";
export const FONT = fs.readFileSync(FONT_FILE);
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
export const TOKENS = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-border": "#e8a23b", "--ov-accent": "#e8a23b", "--ov-accent-fg": "#111111", "--ov-radius": "6px", "--ov-shadow": "0 4px 14px rgba(0,0,0,.5)", "--ov-font": '"Fredoka", Georgia, serif', "--ov-font-heading": '"Fredoka", "Georgia", serif' };
export const FONT_ASSET = { file: "fonts/fredoka.woff2", kind: "font", family: "Fredoka", weight: "400", license: "SIL Open Font License 1.1 (free text, never judged)", author: "The Fredoka Project Authors", source: "https://example.invalid/fredoka" };
export const CSS = `[data-ov-part="title"]{font-family:"Fredoka","Georgia",serif;letter-spacing:0.02em}\n[data-ov-part="panel"]{border-radius:var(--ov-radius,6px)}`;

/** `over.manifest`: manifest overrides (`undefined` removes a key). `over.fonts`: file name under fonts/ -> bytes (default: the one font); `over.tokens`, `over.css`: replace them. */
export function fontSkin(id, over = {}) {
  const dir = makeTempDir(`ovfont-${id}-`);
  const manifest = { skinContract: 6, kind: "overlay", id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: "0.47.0", license: "MIT", tags: ["dark"], tokens: "tokens.json", stylesheet: "skin.css",
    previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }], assets: [FONT_ASSET], ...over.manifest };
  for (const k of Object.keys(manifest)) if (manifest[k] === undefined) delete manifest[k];
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: over.tokens ?? TOKENS }));
  fs.writeFileSync(path.join(dir, "skin.css"), over.css ?? CSS);
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT");
  const fonts = over.fonts ?? { "fredoka.woff2": FONT };
  if (Object.keys(fonts).length) { fs.mkdirSync(path.join(dir, "fonts")); for (const [n, b] of Object.entries(fonts)) fs.writeFileSync(path.join(dir, "fonts", n), b); }
  return dir;
}
