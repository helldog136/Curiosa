// Fixture pages for the render migration tests (0.21.0): the same input rendered by two core versions must give the same bytes.
// `node --import ./tests/helpers/register.mjs tests/fixtures/overlays/render-cases.mjs > tests/fixtures/overlays/render-<version>.json` on the older core.
import crypto from "node:crypto";

const look0 = { skin: null, byContext: { enabled: false, instance: null, context: null, rules: [] } };
const layout = { iframeW: 640, iframeH: 260, scale: 1, offsetX: 0, offsetY: 0, boxW: 640, boxH: 260 };
const fx = (uid, extra = {}) => ({ uid, instance: "al", element: "alerts", x: 10, y: 20, w: 640, h: 260, visible: true, options: {}, ...extra });
export const STYLES = { none: null, readable: { preset: "readable" }, bareSquare: { preset: "bare", corners: "square" }, custom: { preset: "discreet", background: "solid", opacity: 70, color: "#203040", outline: "thick", text: "light" } };
export function renderCase(R, makeTranslator, c) {
  const pg = { id: "p", name: "Page <1>", width: 1920, height: 1080, active: true, style: { text: c.text, background: c.background, corners: "round", ...(c.scale ? { textScale: 150 } : {}) }, look: c.skin ? { ...look0, skin: "night" } : look0, elements: [], rev: 3, testUntil: c.test ? 2_000_000 : null };
  const style = STYLES[c.style];
  const elements = [
    { el: fx("aaaaaa1111", style ? { style } : {}), title: "Alerts", status: "ok", layout, follows: true, src: "/overlays/al?ov-w=640", demoSrc: "/overlays/al?ov-w=640&ov-demo=1" },
    { el: fx("eeeeee5555", { element: "poll" }), title: "Poll", status: "ok", layout, follows: true, src: "/overlays/po?ov-w=640" },
    { el: fx("bbbbbb2222", { element: "maze" }), title: "Maze", status: "ok", layout, follows: false, src: "/overlays/mz?ov-w=640" },
    { el: fx("cccccc3333"), title: "Gone", status: "missing", reason: "gone" },
  ];
  const skin = c.skin ? { id: "night", version: "1.0.0", css: "html[data-ov-skin=\"night\"]{--ov-fg:#fff!important;--ov-surface:rgba(10,10,20,.8)!important}", key: "night@1.0.0:abc" } : null;
  return R.renderPage({ page: pg, elements, t: makeTranslator("en"), lang: "en", test: c.test, now: 1_000_000, nonce: "N0nce", stateUrl: "/overlays/page/x/state", skin, contextual: false });
}
export const CASES = [];
for (const background of ["transparent", "soft", "opaque"]) for (const text of ["light", "dark"]) for (const skin of [false, true]) for (const style of Object.keys(STYLES)) for (const test of [false, true])
  CASES.push({ id: `${background}-${text}-${skin ? "skin" : "plain"}-${style}-${test ? "test" : "live"}`, background, text, skin, style, test, scale: style === "custom" });
export const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const R = await import("@/core/overlays/render");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  const hashes = Object.fromEntries(CASES.map((c) => [c.id, sha(renderCase(R, makeTranslator, c))]));
  process.stdout.write(JSON.stringify({ core: process.env.CORE_VERSION ?? "", hashes }, null, 1) + "\n");
}
