import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { png } from "../helpers/images.mjs";

// The site icon behind a reverse proxy: /favicon.ico and the MCP `serverInfo.icons` must be served directly or point to the PUBLIC host, never to `localhost`.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { publicOrigin, relativeLocation } = await import("@/core/publicOrigin");
const { setSetting } = await import("@/core/settings");
const { UPLOADS_DIR } = await import("@/core/config");
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { mcpServerIcons } = await import("@/core/siteIcon");
const { listMcpTools } = await import("@/core/platform");
const favicon = await import("../../src/app/favicon.ico/route.ts");
const mcpIcon = await import("../../src/app/mcp-icon/route.ts");
const { siteIconLinks } = await import("@/core/favicon");

const NAME = "123e4567-e89b-12d3-a456-426614174000";
beforeEach(async () => {
  await db.reset();
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  await setSetting("site.name", "Etoile Nord", "en");
  await setSetting("i18n.default", "en");
});
after(() => db.close());

const headers = (h) => new Headers(h);
const get = (route, h = {}) => route.GET(new Request("https://localhost:3003/favicon.ico", { headers: h }));
function putIcon(ext, buf) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, `${NAME}.${ext}`), buf);
}
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456"/></svg>';

test("publicOrigin: SITE_URL wins; without it the forwarded host; never localhost", () => {
  assert.equal(publicOrigin(headers({ host: "localhost:3003", "x-forwarded-host": "evil.example" }), "https://curiosa.example.org/"), "https://curiosa.example.org");
  assert.equal(publicOrigin(headers({ host: "localhost:3002", "x-forwarded-host": "ccd.example.org", "x-forwarded-proto": "https" }), "http://localhost:3000"), "https://ccd.example.org");
  assert.equal(publicOrigin(headers({ host: "a.example.org", "x-forwarded-proto": "https, http" }), "http://localhost:3000"), "https://a.example.org");
  assert.equal(publicOrigin(headers({ host: "localhost:3003" }), "http://localhost:3000"), "http://localhost:3000", "an internal host is never believed");
  assert.equal(publicOrigin(headers({ "x-forwarded-host": "bad host/x" }), "https://s.example.org"), "https://s.example.org");
  assert.equal(relativeLocation("/admin/login"), "/admin/login");
  assert.equal(relativeLocation("//evil.example/x"), "/evil.example/x");
});

test("/favicon.ico answers 200 with the icon bytes and type (png), never a redirect; ETag gives 304", async () => {
  const buf = png(64, 64);
  putIcon("png", buf);
  await setSetting("site.favicon", `/uploads/${NAME}.png`);
  const res = await get(favicon, { host: "localhost:3003", "x-forwarded-host": "curiosa.example.org" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.ok(!res.headers.get("location"));
  assert.match(res.headers.get("cache-control"), /max-age=300/);
  assert.match(res.headers.get("vary"), /Host/i);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(buf));
  const again = await get(favicon, { "if-none-match": res.headers.get("etag") });
  assert.equal(again.status, 304);
});

test("/favicon.ico: svg source, cropped raster variant (?c=), square-logo fallback, generated fallback", async () => {
  putIcon("svg", SVG);
  await setSetting("site.favicon", `/uploads/${NAME}.svg`);
  let res = await get(favicon);
  assert.equal([res.status, res.headers.get("content-type")].join(), "200,image/svg+xml");
  assert.match(await res.text(), /#123456/);
  fs.rmSync(path.join(UPLOADS_DIR, `${NAME}.svg`));
  putIcon("png", png(80, 40));
  await setSetting("site.favicon", `/uploads/${NAME}.png?c=1_1_0.5_0.5_t`);
  res = await get(favicon);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^image\/(webp|png)$/, "the framed version, or the original when the engine is missing");
  await setSetting("site.favicon", "");
  await setSetting("site.logo", `/uploads/${NAME}.png`);
  assert.equal((await get(favicon)).headers.get("content-type"), "image/png", "square logo when no favicon");
  await setSetting("site.logo", "");
  res = await get(favicon);
  assert.equal([res.status, res.headers.get("content-type")].join(), "200,image/svg+xml", "generated icon: never nothing");
  await setSetting("site.favicon", "https://cdn.example.org/i.png");
  res = await get(favicon, { host: "localhost:3003" });
  assert.equal(res.headers.get("location"), "https://cdn.example.org/i.png");
});

test("MCP initialize: serverInfo.icons are absolute https URLs on the request host; two sites, two icons", async () => {
  const token = await T.createToken("Camille", "read", "o");
  const init = async (origin) => {
    const res = await handleMcpRequest(new Request("http://localhost:3003/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", host: "localhost:3003", "x-forwarded-host": origin, "x-forwarded-proto": "https" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) }), listMcpTools, undefined, mcpServerIcons);
    return (await res.json()).result;
  };
  putIcon("png", png(192, 192));
  await setSetting("site.favicon", `/uploads/${NAME}.png`);
  const a = await init("curiosa.example.org");
  assert.equal(a.protocolVersion, "2025-11-25");
  assert.equal(a.serverInfo.name, "Etoile Nord", "name unchanged");
  const [icon] = a.serverInfo.icons;
  assert.match(icon.src, /^https:\/\/curiosa\.example\.org\/mcp-icon\?v=[0-9a-f]+$/);
  assert.deepEqual([icon.mimeType, icon.sizes], ["image/png", ["192x192"]]);
  assert.ok(!JSON.stringify(a).includes("localhost"));
  const b = await init("ccd.example.org");
  assert.match(b.serverInfo.icons[0].src, /^https:\/\/ccd\.example\.org\//);
  // Per-site isolation: another site (own database) has another favicon, hence another icon; here the same site changes it and the address changes.
  fs.rmSync(path.join(UPLOADS_DIR, `${NAME}.png`));
  putIcon("svg", SVG);
  await setSetting("site.favicon", `/uploads/${NAME}.svg`);
  const c = await init("curiosa.example.org");
  assert.notEqual(c.serverInfo.icons[0].src, icon.src);
  assert.deepEqual([c.serverInfo.icons[0].mimeType, c.serverInfo.icons[0].sizes], ["image/svg+xml", ["any"]]);
  const served = await get(mcpIcon);
  assert.equal([served.status, served.headers.get("content-type"), served.headers.get("access-control-allow-origin")].join(), "200,image/svg+xml,*");
});

test("page links: type, sizes=any for svg, apple-touch-icon only for a raster", () => {
  assert.deepEqual(siteIconLinks(`/uploads/${NAME}.svg`, null), { icon: [{ url: `/uploads/${NAME}.svg`, type: "image/svg+xml", sizes: "any" }] });
  const both = siteIconLinks(`/uploads/${NAME}.svg`, `/uploads/${NAME}.png?c=1_1_0.5_0.5_t`);
  assert.equal(both.apple[0].type, "image/png");
  assert.deepEqual(siteIconLinks(null, null), { icon: [{ url: "/icon" }] });
});

test("redirects that were built from request.url: none left (the proxy and the bug-report route answer path-only locations)", () => {
  for (const f of ["src/app/admin/bug-report/route.ts", "src/app/favicon.ico/route.ts"]) {
    const code = fs.readFileSync(f, "utf8");
    assert.ok(!/NextResponse\.redirect\(|Response\.redirect\(|new URL\([^)]*request\.url\)\.toString/.test(code), f);
  }
  assert.match(fs.readFileSync("src/proxy.ts", "utf8"), /relativeLocation\(`\$\{clean\.pathname\}\$\{clean\.search\}`\)/);
});
