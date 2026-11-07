import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));

test("site settings : no game covers tab any more (handled by the module); the tabs are identity, languages, privacy, search, mail", () => {
  assert.ok(!/id: "services"|data-tab="services"|rawg-moved-card|rawg-pending-card|rawgHandover|retryRawgHandover/.test(page));
  const ids = [...page.matchAll(/\{ id: "(\w+)", label: t\("settings\.\w+"\) \}/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["site", "languages", "privacy", "search", "mail"]);
  assert.ok(!fs.existsSync("src/app/admin/(panel)/settings/rawg-actions.ts"));
  for (const dict of [en, fr]) assert.deepEqual(Object.keys(dict).filter((k) => /^settings\.(services|servicesHelp|rawg\w*)$/.test(k)), []);
});

test("site settings : an old #services bookmark falls back to the first tab (no error), and the old cover-fix address still redirects to the module", () => {
  const tabs = fs.readFileSync("src/components/admin/Tabs.tsx", "utf8");
  assert.match(tabs, /known\(hash\) \? hash : known\(initial\) \? initial : tabs\[0\]!\.id/);
  const old = fs.readFileSync("src/app/admin/(panel)/settings/rawg-covers/page.tsx", "utf8");
  assert.match(old, /redirect\(instanceHref\(provider\.instance\.id/);
  assert.match(old, /redirect\(`\$\{EXTENSIONS_ADD_DETAILS_HREF\}\?id=\$\{COVERS_MODULE\}`\)/);
});
