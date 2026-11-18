// R32 and R3, as an automatic check on the admin screens of the core (core 0.32.0). Two defects of the same class kept coming back:
//  1. an information box (a `Callout` that is neither a warning nor an error) that asks for no action: reassuring filler ("everything is up to date", "all is well").
//     A status is one word in a chip, the precision is in its tooltip (R32). A box is kept only when it carries an action (link, button, form), or when it is the
//     feedback of an action the person has just made (listed below, with the reason). Any new box without an action fails here until it is listed or turned into a chip.
//  2. a rare destructive action (delete, revoke, reset, erase...) drawn as the big full-colour main button (R3): a submit button of such an action is outlined
//     (`secondary`, `danger`) or in a confirmation window, never the primary one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith(".tsx")) out.push(p.replaceAll("\\", "/"));
  }
  return out;
};
const files = walk("src");
const line = (s, i) => s.slice(0, i).split("\n").length;
const keysOf = (body) => [...body.matchAll(/t\("([^"]+)"/g)].map((m) => m[1]);

/** Information boxes without an action that are allowed, by the message they show. Each one says why. */
const ALLOWED_INFO = new Map([
  // Feedback of an action just made (R23): shown once, next to what was clicked.
  ["remove.noticeKept", "feedback after removing a module"], ["remove.noticeErased", "feedback after erasing a module"], ["kept.noticeRestored", "feedback after bringing data back"],
  ["ovp.skin.ok.removed", "feedback after a skin action"], ["ovp.skin.ok.installed", "feedback after a skin action"], ["ovp.skin.ok.refreshed", "feedback after a skin action"], ["ovp.skin.ok.skin", "feedback after a skin action"],
  ["domain.cmd.applied", "feedback after the address command ran"], ["domain.cmd.pending", "the command is still running"],
  // A state the person has to read to decide something, with no better place for it.
  ["content.verdict.none", "no check has run yet: says so"], ["content.verdict.look", "the check found things to look at: the list follows"],
  ["upkeep.status.todo", "upkeep verdict heading the list below"], ["upkeep.status.kept", "upkeep verdict heading the list below"], ["upkeep.status.clean", "upkeep verdict heading the list below"],
  ["domain.current.local", "the site is visited by a local address: says why the check is off"],
  ["updates.dontClose", "tells the person they can leave while the update runs"], ["updates.docker.unplanned", "how the update is done on this installation"], ["updates.docker.lastOk", "result of the last update"],
  ["dashboard.welcome", "first-visit pointer (R26)"],
]);

test("an information box with no action is a chip with a tooltip, not a banner (R32)", () => {
  const found = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g)) {
      const tone = /tone="(\w+)"/.exec(m[1])?.[1] ?? "info";
      if (tone === "warn" || tone === "danger") continue;
      const body = m[2];
      if (/<a |<form|Button|<Link|onClick|href=/.test(body)) continue;
      const keys = keysOf(body);
      const label = keys.length ? keys : [/labels\.(\w+)/.exec(body)?.[0] ?? /\{(v\.\w+)\}/.exec(body)?.[1] ?? body.replace(/\s+/g, " ").slice(0, 50)];
      // A box showing a computed message (`{t(`x.${k}`)}`, a prop) is judged by its file: those are feedback boxes.
      if (keys.length && keys.some((k) => ALLOWED_INFO.has(k))) continue;
      if (!keys.length && /\$\{|labels\.|v\.warning/.test(body)) continue;
      found.push(`${f}:${line(s, m.index)} (${label.join(", ")})`);
    }
  }
  assert.deepEqual(found, [], `Information box(es) with no action: turn each into a status chip (ui.chip / chipOk, sentence in title=) or list it in ALLOWED_INFO with a reason (docs/ERGONOMIE-ADMIN.md R32):\n${found.join("\n")}`);
});

test("every allowed information box still exists (the list does not rot)", () => {
  const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const k of ALLOWED_INFO.keys()) assert.ok(all.includes(`"${k}"`), `${k}: no longer shown in a Callout, remove it from ALLOWED_INFO`);
});

const DESTRUCTIVE = /(delete|remove|revoke|reset|erase|wipe|uninstall|purge|destroy|forget)/i;

test("a rare destructive action is never the big main button (R3)", () => {
  const found = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    // <ActionForm ... /> opening tags: single-line starts, read up to the closing ">" of the tag.
    for (const m of s.matchAll(/<ActionForm\b([\s\S]*?)>\s*(?=\n|<|\{)/g)) {
      const tag = m[1];
      const action = /action=\{([^}]*)\}/.exec(tag)?.[1] ?? "";
      const label = /submitLabel=\{([^}]*)\}/.exec(tag)?.[1] ?? "";
      if (!DESTRUCTIVE.test(action) && !DESTRUCTIVE.test(label)) continue;
      if (/\bsecondary\b|\bdanger\b|hideSubmit/.test(tag)) continue;
      found.push(`${f}:${line(s, m.index)} <ActionForm ${action}>`);
    }
    for (const m of s.matchAll(/<PendingButton\b([^>]*)variant="primary"([^>]*)>([^<]*)/g)) {
      if (DESTRUCTIVE.test(m[3]) || DESTRUCTIVE.test(m[1] + m[2])) found.push(`${f}:${line(s, m.index)} <PendingButton variant="primary"> ${m[3].trim()}`);
    }
  }
  assert.deepEqual(found, [], `Destructive action drawn as the main button: add \`danger\` (ActionForm) or a "danger" variant:\n${found.join("\n")}`);
});

test("the check itself catches both defects (proof it can fail)", () => {
  const box = `<Callout tone="info" role="status">{t("something.upToDate")}</Callout>`;
  const m = /<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/.exec(box);
  assert.deepEqual(keysOf(m[2]), ["something.upToDate"]);
  assert.ok(!ALLOWED_INFO.has("something.upToDate"));
  const form = `<ActionForm action={deleteRoleAction.bind(null, r.id)} submitLabel={t("roles.delete")} className="w-full">`;
  const tag = /<ActionForm\b([\s\S]*?)>/.exec(form)[1];
  assert.ok(DESTRUCTIVE.test(/action=\{([^}]*)\}/.exec(tag)[1]) && !/\bsecondary\b|\bdanger\b/.test(tag));
});
