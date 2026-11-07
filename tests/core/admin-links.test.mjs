// adminLinks.ts is the only place where admin paths are written. This test:
//   1. checks the helpers (encoding, query handling, anchors);
//   2. scans the sources and fails on a stray `"/admin/…"` literal outside the allowlist;
//   3. checks that every old admin address still answers with its new place (query strings kept).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const L = await import("@/core/adminLinks");
const X = await import("@/core/modules/extensionsLinks");
const A = await import("@/core/services/mcp/assistantsLinks");

test("helpers build the same addresses as before", () => {
  assert.equal(L.entriesHref("blog"), "/admin/entries?c=blog");
  assert.equal(L.entriesHref("blog", { state: "published", q: "" }), "/admin/entries?c=blog&state=published");
  assert.equal(L.entryNewHref("blog"), "/admin/entries/new?c=blog");
  assert.equal(L.entryTemplatesHref("blog"), "/admin/entries/templates?c=blog");
  assert.equal(L.entryHref("e1", { locale: "fr", created: "1" }), "/admin/entries/e1?locale=fr&created=1");
  assert.equal(L.instanceHref("i1"), "/admin/instances/i1");
  assert.equal(L.instanceHref("i1", "?"), "/admin/instances/i1");
  assert.equal(L.instanceHref("i1", "?tab=x"), "/admin/instances/i1?tab=x");
  assert.equal(L.instanceHref("i1", "tab=x"), "/admin/instances/i1?tab=x");
  assert.equal(L.moduleHref("a b"), "/admin/modules/a%20b");
  assert.equal(L.redirectHref("r1", { created: "1" }), "/admin/redirects/r1?created=1");
  assert.equal(L.redirectsHref({ deleted: "1" }), "/admin/redirects?deleted=1");
  assert.equal(L.overlayPagePreviewHref("p1"), "/admin/overlay-pages/p1/preview");
  assert.equal(L.SETTINGS_PRIVACY_HREF, "/admin/settings#privacy");
  assert.equal(X.EXTENSIONS_ADD_HREF, "/admin/extensions/add");
  assert.equal(A.ASSISTANTS_HREF, "/admin/assistants");
  assert.equal(A.TEAM_HREF, "/admin/users");
});

test("isAdminPath accepts the administration only", () => {
  for (const ok of ["/admin", "/admin/x", "/admin?a=1"]) assert.equal(L.isAdminPath(ok), true, ok);
  for (const no of ["//admin/x", "/administrator", "https://evil.test/admin/", "/api/admin", ""]) assert.equal(L.isAdminPath(no), false, no);
});

// Files that legitimately mention "/admin" as a prefix to test or exclude, not as a link.
const ALLOWED = new Set([
  "src/core/adminLinks.ts",
  "src/core/adminkit/image.ts",
  "src/core/adminkit/dialog.ts",
  "src/core/stats.ts",
  "src/core/seo.ts",
  "src/core/dashboard/spec.ts",
]);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no admin address is written outside adminLinks.ts", () => {
  const stray = [];
  for (const f of walk("src")) {
    const rel = f.split(path.sep).join("/");
    if (ALLOWED.has(rel)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /from "@\/app/.test(line)) return;
      if (/["'`]\/admin(["'`/?#]|\b)/.test(line.replace(/\/api\/admin/g, ""))) stray.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(stray, [], "write the address in src/core/adminLinks.ts and import it");
});

test("old admin addresses still lead to their new place, query kept", () => {
  assert.equal(X.legacyExtensionsTarget("/admin/catalogue", { id: "blog" }), "/admin/extensions/add?id=blog");
  assert.equal(X.legacyExtensionsTarget("/admin/catalogue/details", { repo: "a/b" }), "/admin/extensions/add/details?repo=a%2Fb");
  assert.equal(X.legacyExtensionsTarget("/admin/integrations"), "/admin/extensions?family=connections");
  assert.equal(X.legacyExtensionsTarget("/admin/overlays"), "/admin/extensions?family=overlays");
  assert.equal(X.legacyExtensionsTarget("/admin/modules", { tab: "updates", x: "1" }), "/admin/extensions/updates?x=1");
  assert.equal(X.legacyExtensionsTarget("/admin/modules", { module: "blog", update: "ok" }), "/admin/modules/blog?module=blog&update=ok");
  assert.equal(A.legacyAssistantsTarget("/admin/mcp"), "/admin/assistants");
  assert.equal(A.legacyAssistantsTarget("/admin/mcp/abc"), "/admin/assistants/abc");
  assert.equal(A.legacyAssistantsTarget("/admin/maintenance-ia", { notice: "busy" }), "/admin/assistants?tab=requests&notice=busy");
  assert.equal(X.legacyExtensionsTarget("/admin/blog"), null);
});
