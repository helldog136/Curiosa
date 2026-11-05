import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Public pages must not ship the admin form kit: a client component reachable from the server code of a public route (even through a dynamic import)
// goes into that route's first load. `Blocks` is shared by public and admin pages, so the admin components reach it through the `kit` prop only.
const read = (f) => fs.readFileSync(f, "utf8");

test("Blocks.tsx (shared with the public pages) does not import the admin form kit", () => {
  const src = read("src/components/site/Blocks.tsx");
  const adminImports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from "\.\.\/admin\/([^"]+)";/gm)].map((m) => ({ type: Boolean(m[1]), file: m[2] }));
  const valueFiles = adminImports.filter((i) => !i.type).map((i) => i.file).sort();
  // Pure helpers, plus TableView (public enhanced tables; the admin row buttons come from the kit).
  assert.deepEqual(valueFiles, ["TableView", "floating", "kitLabels", "ui"]);
  assert.doesNotMatch(src, /import\([^)]*admin/, "no dynamic import of admin code either: it is still reachable from the route");
});

test("TableView (public) does not import AdminBlocks; AdminTable (admin kit) adds the row buttons", () => {
  assert.doesNotMatch(read("src/components/admin/TableView.tsx"), /import \{[^}]*\} from "\.\/AdminBlocks"/, "type imports only");
  assert.match(read("src/components/admin/AdminTable.tsx"), /import \{ RowActionButton, RowMenuItem, RowSwitch[^}]*\} from "\.\/AdminBlocks"/);
});

test("the admin pages that render panels give Blocks the admin kit", () => {
  for (const f of ["src/components/admin/EntryPanels.tsx", "src/app/admin/(panel)/instances/[id]/InstanceView.tsx"]) {
    const src = read(f);
    assert.match(src, /import \* as adminKit from "@\/components\/site\/adminKit"/, f);
    assert.match(src, /<Blocks [^>]*kit=\{adminKit\}/, f);
  }
  // Nothing outside the admin imports the kit.
  for (const f of ["src/app/(site)/layout.tsx", "src/app/(site)/page.tsx", "src/app/(site)/[...path]/page.tsx"]) assert.doesNotMatch(read(f), /adminKit/, f);
});

test("when a production build is present, the public first load stays near the framework floor", { skip: !fs.existsSync(".next/diagnostics/route-bundle-stats.json") }, () => {
  const stats = JSON.parse(read(".next/diagnostics/route-bundle-stats.json"));
  const bytes = (route) => stats.find((r) => r.route === route)?.firstLoadUncompressedJsBytes;
  const floor = bytes("/_not-found");
  const home = bytes("/");
  assert.ok(floor && home);
  // Before this change the home was 593 781 bytes over a 458 123 floor (admin kit shipped to everyone); now ~44 KB over.
  assert.ok(home - floor < 80_000, `home ${home} is ${home - floor} bytes above the framework floor ${floor}`);
});
