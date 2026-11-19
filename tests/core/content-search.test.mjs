// 0.41.0: the global search also finds content entries (bounded, titles only, editors and above), and the extensions list shows a visible "Content" button.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("content search: bounded, titles and addresses only, behind the editor role", () => {
  const route = read("src/app/api/admin/content-search/route.ts");
  assert.match(route, /hasRole\(user, "editor"\)/);
  assert.match(route, /private, no-store/);
  const core = read("src/core/content/adminSearch.ts");
  assert.match(core, /CONTENT_SEARCH_LIMIT = 20/);
  assert.match(core, /take: CONTENT_SEARCH_LIMIT/);
  assert.ok(!/body|content:\s*\{/.test(core.replace(/\/\*[\s\S]*?\*\//g, "")), "the body of an entry is never searched");
});

test("content search: wording says setting or content, FR and EN", () => {
  for (const loc of ["en", "fr"]) {
    const d = JSON.parse(read(`src/locales/${loc}.json`));
    assert.match(d["settingsSearch.label"], /contenu|content/i);
    assert.match(d["settingsSearch.none"], /contenu|content/i);
  }
});

test("extensions list: a visible Content button, no longer hidden in the menu", () => {
  const card = read("src/components/admin/ExtensionCard.tsx");
  const menu = card.slice(card.indexOf("function InstanceActions"), card.indexOf("function Chips"));
  assert.ok(!menu.includes("integrations.items"));
  assert.match(card, /data-testid=\{`content-\$\{m\.id\}`\}/);
});
