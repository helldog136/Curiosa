// A builder of overlay skin folders that ship their own mosaic pieces (core 0.48.0, contract 7: `patterns/*.json` declared in `assets` with `kind: "pattern"`, named by the
// `patterns` table of `animation.json`). Made in a temporary directory, with invented names only. The pattern is the neutral L/T demo geometry of the test fixtures.
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./tmp.mjs";

export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
export const TOKENS = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-border": "#e8a23b", "--ov-accent": "#e8a23b", "--ov-accent-fg": "#111111", "--ov-radius": "6px", "--ov-shadow": "0 4px 14px rgba(0,0,0,.5)" };
export const LT = JSON.parse(fs.readFileSync("tests/fixtures/animate/pattern-lt.json", "utf8"));
const rect = (w, h, tones) => ({ patternContract: 1, domain: [w, h], cells: tones.map((t, i) => ({ p: [[(i * w) / tones.length, 0], [((i + 1) * w) / tones.length, 0], [((i + 1) * w) / tones.length, h], [(i * w) / tones.length, h]], tone: t })) });
export const NARROW = rect(60, 90, [0.1, 0.5, 0.9]);
export const PATTERN_ASSET = (file) => ({ file, kind: "pattern", license: "CC0-1.0 (free text, never judged)", author: "Curiosa tests", source: "Neutral geometry invented for the tests" });
export const RECIPE = (patterns = { arch: [{ file: "patterns/wide.json" }] }, body = {}) => ({ animateContract: 4, patterns, genres: { gauge: { body: { draw: "mosaic", pattern: "file", source: "arch", seed: 5, ...body } } } });

/**
 * `over.manifest`: manifest overrides (`undefined` removes a key). `over.patterns`: file name under patterns/ -> object (JSON-encoded) or Buffer (default: wide.json = the L/T demo).
 * `over.recipe`: replaces animation.json. `over.assets`: replaces the declared assets (default: one `pattern` asset per file under patterns/).
 */
export function patternSkin(id, over = {}) {
  const dir = makeTempDir(`ovpat-${id}-`);
  const files = over.patterns ?? { "wide.json": LT };
  const assets = over.assets ?? Object.keys(files).map((n) => PATTERN_ASSET(`patterns/${n}`));
  const manifest = { skinContract: 7, kind: "overlay", id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: "0.48.0", license: "MIT", tags: ["dark"], tokens: "tokens.json", animation: "animation.json",
    previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }], assets, ...over.manifest };
  for (const k of Object.keys(manifest)) if (manifest[k] === undefined) delete manifest[k];
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: over.tokens ?? TOKENS }));
  fs.writeFileSync(path.join(dir, "animation.json"), JSON.stringify(over.recipe ?? RECIPE()));
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT");
  if (Object.keys(files).length) { fs.mkdirSync(path.join(dir, "patterns")); for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, "patterns", n), Buffer.isBuffer(b) ? b : JSON.stringify(b)); }
  return dir;
}
