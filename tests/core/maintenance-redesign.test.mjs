import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// C5f: the Maintenance area. One state and one main action per tab, the danger zone apart and visible, no sentence that only says everything is fine.
const PANEL = "src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");
const PAGES = { backup: `${PANEL}/backup/page.tsx`, updates: `${PANEL}/updates/page.tsx`, health: `${PANEL}/maintenance/content/page.tsx`, legacy: `${PANEL}/maintenance/legacy/page.tsx`, audit: `${PANEL}/audit/page.tsx` };

test("every tab of Maintenance names itself once: the tab bar shows it, the heading is for screen readers, the sentence stays", () => {
  for (const [name, file] of Object.entries(PAGES)) {
    const src = read(file);
    assert.match(src, /<TabIntro title=\{t\("[a-z.]+"\)\}/, `${name}: TabIntro`);
    assert.ok(!/<PageHeader level=\{2\}/.test(src), `${name}: no second visible title under the tab bar`);
  }
  const header = read("src/components/admin/MaintenanceHeader.tsx");
  assert.match(header, /<h2 className="sr-only">\{title\}<\/h2>/);
  assert.match(header, /data-testid="maintenance-intro"/);
});

test("the rights that guard each Maintenance page are unchanged", () => {
  assert.match(read(PAGES.backup), /adminCtx\(\{ right: "core:backup" \}\)/);
  assert.match(read(PAGES.updates), /adminCtx\(\{ right: "core:updates" \}\)/);
  assert.match(read(PAGES.legacy), /adminCtx\(\{ right: "core:updates" \}\)/);
  assert.match(read(PAGES.audit), /adminCtx\(\{ right: "core:security" \}\)/);
  assert.match(read(PAGES.health), /adminCtx\("admin"\)/);
});

test("Backup: the backup form first, restoring last in a danger card that writes what is lost; the form stays mounted so a restore in progress is never lost", () => {
  const src = read("src/components/admin/RestoreDanger.tsx");
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls=\{region\}/);
  assert.match(src, /<div id=\{region\} hidden=\{!open\}>\{children\}<\/div>/, "hidden, not unmounted");
  assert.match(src, /ui\.btnDanger/);
  assert.match(src, /data-testid="restore-loss"/);
  const page = read(PAGES.backup);
  assert.match(page, /<RestorePanel labels=\{labels\} \/>/, "the same two-step panel (file, then preview, then confirm)");
  assert.ok(page.indexOf("<BackupForm") < page.indexOf("autobackup-panel") && page.indexOf("autobackup-panel") < page.indexOf("<RestoreDanger"));
});

test("Updates: the one primary button sits right under the versions; notes and what happens are folded; options folded with their state", () => {
  const page = read(PAGES.updates);
  const at = (s) => page.indexOf(s);
  assert.ok(at('data-testid="update-journey"') < at('data-testid="update-action"') && at('data-testid="update-action"') < at('data-testid="update-details"'));
  assert.match(page, /<details className="[^"]*" data-testid="update-details" open=\{check\.level === "major"\}>/, "a major release opens the notes");
  assert.match(page, /data-testid="update-restart"/, "how the restart happens stays visible next to the button");
  assert.match(page, /<StatusPill tone="ok">\{t\("updates\.upToDate"\)\}<\/StatusPill>/);
  assert.match(page, /data-testid="update-options"/);
  assert.ok(!/[✅❌⏳⏸🧩]/u.test(page.replace(/aria-hidden/g, "")), "no emoji used as a state: a shape and a word (StatusPill)");
  assert.match(page, /info\.canUpdate && advanced && \(|\{advanced && \(\s*<section[^>]*update-channel/, "the release-candidate channel stays advanced only");
});

test("Health check and Leftovers: a state is one pill; the explanations are in a tip, not on the page", () => {
  const health = read(PAGES.health);
  assert.match(health, /data-testid="content-verdict-good"/);
  assert.match(health, /data-testid="content-verdict-look"/);
  assert.ok(!/<Callout tone="info" role="status" testid="content-verdict-look">/.test(health), "no information box without an action (R33d)");
  assert.match(health, /<HelpTip help=\{t\(`content\.sev\.\$\{sev\}\.help`\)\}/);
  const legacy = read(PAGES.legacy);
  assert.match(legacy, /data-testid=\{`upkeep-status-\$\{sum\.state\}`\}/);
  assert.match(legacy, /<HelpTip help=\{t\(`upkeep\.group\.\$\{id\}\.help`\)\}/);
  assert.ok(!/<Callout tone=\{sum\.state/.test(legacy));
});

test("new texts: EN and FR together, before the theme group, the last key unchanged", () => {
  const en = JSON.parse(read("src/locales/en.json"));
  const fr = JSON.parse(read("src/locales/fr.json"));
  for (const k of ["backup.restoreLoss", "backup.restoreOpen", "updates.status.available", "updates.optionsTitle", "updates.autoOn", "updates.autoOff"]) {
    assert.ok(en[k] && fr[k], k);
    assert.ok(Object.keys(en).indexOf(k) < Object.keys(en).indexOf("theme.night"), `${k} sits before the theme group`);
  }
  assert.equal(Object.keys(en).at(-1), "settings.contrast.accent2");
  assert.equal(Object.keys(fr).at(-1), "settings.contrast.accent2");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
});
