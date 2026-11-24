// Overlay skins of contracts 2 to 5 must keep working BYTE FOR BYTE when overlay skins learn to embark fonts (core 0.47.0, contract 6): the validation result, the
// installed files' fingerprint, the compiled sheet and the page that wears it are hashed here against hashes recorded on the core that came BEFORE contract 6
// (RECORD=<file> writes them; they were recorded on 0.46.1 and must never be re-recorded to make this test pass).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/tmp.mjs";

const V = await import("@/core/skins/validate");
const Sh = await import("@/core/overlays/skinSheet");
const R = await import("@/core/overlays/render");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const GOLDEN_FILE = "tests/fixtures/overlay-fonts/golden-contracts-2-5.json";
const sha = (s) => crypto.createHash("sha256").update(typeof s === "string" ? s : JSON.stringify(s)).digest("hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(24)]);
const TOKENS = { "--ov-fg": "#ffffff", "--ov-surface": "rgba(10,10,20,0.85)", "--ov-border": "#e8a23b", "--ov-accent": "#e8a23b", "--ov-accent-fg": "#111111", "--ov-radius": "6px", "--ov-border-width": "2px", "--ov-shadow": "0 4px 14px rgba(0,0,0,.5)", "--ov-font": "Georgia, serif", "--ov-font-heading": "\"Trebuchet MS\", sans-serif", "--ov-anim": "rise" };
const CSS2 = `[data-ov-part="panel"]{border-radius:var(--ov-radius,6px);font-family:"Georgia",serif}\n[data-ov-part="title"]{font-family:var(--ov-font-heading);letter-spacing:0.05em;text-transform:uppercase}`;
const CSS3 = `${CSS2}\n[data-ov-part="panel"]{ov-shape:notch 12px;ov-font:serif}`;

function folder(id, contract, extra = {}) {
  const dir = makeTempDir(`ovreg-${id}-`);
  const manifest = { skinContract: contract, kind: "overlay", id, name: { fr: id, en: id }, description: { fr: "Un skin d'essai.", en: "A test skin." }, version: "1.0.0", minCore: contract >= 4 ? "0.30.0" : "0.8.0", license: "MIT", tags: ["dark"], tokens: "tokens.json", stylesheet: "skin.css", previews: [{ file: "previews/a.webp", width: 640, alt: { fr: "Aperçu", en: "Preview" } }], ...(extra.manifest ?? {}) };
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ tokens: TOKENS }));
  fs.writeFileSync(path.join(dir, "skin.css"), extra.css ?? CSS2);
  if (extra.animation) fs.writeFileSync(path.join(dir, "animation.json"), fs.readFileSync("tests/fixtures/animate/mosaic-sample.json"));
  fs.mkdirSync(path.join(dir, "previews")); fs.writeFileSync(path.join(dir, "previews/a.webp"), WEBP);
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT");
  return dir;
}
const SKINS = {
  "contract-2": () => folder("old-two", 2),
  "contract-3": () => folder("old-three", 3, { css: CSS3 }),
  "contract-4": () => folder("old-four", 4, { css: CSS3, manifest: { animation: "animation.json" }, animation: true }),
  "contract-5-scene": () => "tests/fixtures/scene-skins/lantern-vine",
};

function measure(dir) {
  const v = V.validateSkinFolder(dir, { coreVersion: "0.46.1" });
  const payload = v.ok ? Sh.compileSkin({ id: v.manifest.id, version: v.manifest.version, tokens: v.tokens.common, css: v.css }) : null;
  const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
  const page = { id: "p", name: "Page", width: 1920, height: 1080, active: true, style: { text: "light", background: "transparent", corners: "round" }, look: { skin: v.manifest?.id ?? null, byContext: { enabled: false, instance: null, context: null, rules: [] } }, elements: [{ uid: "aaaaaa1111", instance: "al", element: "alerts", x: 10, y: 20, w: 640, h: 260, visible: true, options: {} }], rev: 1 };
  const html = payload ? R.renderPage({ page, elements: [{ el: page.elements[0], title: "Alerts", status: "ok", layout, follows: true, src: "/overlays/al?ov-w=640" }], t: makeTranslator("en"), lang: "en", test: false, now: 1_000_000, nonce: "N0nce", stateUrl: "/overlays/page/x/state", skin: { ...payload, key: `${v.manifest.id}@1.0.0:abc` }, contextual: false }) : "";
  return {
    ok: v.ok, issues: v.issues.map((i) => i.code), fingerprint: v.fingerprint, files: sha(v.files), css: sha(v.css), tokens: sha(v.tokens ?? {}), animation: sha(v.animation ?? null), scene: sha(v.scene ?? null),
    sheet: sha(payload?.css ?? ""), payloadKeys: Object.keys(payload ?? {}).sort().join(","), page: sha(html),
  };
}

test("overlay skins of contracts 2 to 5: validation, fingerprint, compiled sheet and the page that wears them are unchanged", (t) => {
  const now = Object.fromEntries(Object.entries(SKINS).map(([k, f]) => [k, measure(f())]));
  if (process.env.RECORD) { fs.writeFileSync(process.env.RECORD, JSON.stringify(now, null, 1) + "\n"); t.skip("RECORD is set: the golden hashes were written to that file, nothing was compared"); return; }
  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"));
  for (const [k, v] of Object.entries(now)) {
    assert.equal(v.ok, true, `${k} still installs: ${v.issues}`);
    assert.deepEqual(v, golden[k], k);
  }
});

test("overlay skins of contracts 2 to 5 may still name system fonts that are not declared (contract 6 is stricter, they are not)", () => {
  const v = V.validateSkinFolder(folder("system-names", 5, { css: `[data-ov-part="panel"]{font-family:"Cinzel Decorative","Georgia",serif}` }), { coreVersion: "0.46.1" });
  assert.equal(v.ok, true, JSON.stringify(v.issues.map((i) => i.code)));
  assert.match(v.css, /font-family:"Cinzel Decorative","Georgia",serif/);
});
