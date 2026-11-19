// Node.js end-of-life warning: the support state is computed locally from process.version and a static table; shown on the dashboard only when not ok.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { nodeSupport, NODE_END_OF_LIFE } from "../../src/core/maintenance/nodeSupport.ts";
import { healthPoints, summarize } from "../../src/core/dashboard/health.ts";
import { makeTranslator } from "../../src/core/i18n/dictionary.ts";

const day = (iso) => Date.parse(`${iso}T12:00:00Z`);

test("nodeSupport: ok, ending soon (6 months or less), end of life, unknown", () => {
  assert.deepEqual(nodeSupport("v24.22.3", day("2026-11-19")), { major: 24, state: "ok", endsOn: "2028-04-30", to: null });
  assert.equal(nodeSupport("v22.23.4", day("2026-11-19")).state, "ending-soon", "22 ends on 2027-04-30: less than 6 months away on 2026-11-19");
  assert.equal(nodeSupport("v22.23.4", day("2026-10-30")).state, "ending-soon", "exactly 6 months before the end");
  assert.equal(nodeSupport("v22.23.4", day("2026-10-29")).state, "ok");
  assert.equal(nodeSupport("v22.23.4", day("2027-04-30")).state, "ending-soon", "the last day is still maintained");
  assert.equal(nodeSupport("v22.23.4", day("2027-05-01")).state, "end-of-life");
  assert.deepEqual(nodeSupport("v20.20.2", day("2026-11-19")), { major: 20, state: "end-of-life", endsOn: "2026-04-30", to: 24 });
  assert.deepEqual(nodeSupport("v99.0.0", day("2026-11-19")), { major: 99, state: "unknown", endsOn: null, to: null });
  assert.equal(nodeSupport("garbage").state, "unknown");
  assert.deepEqual(Object.keys(NODE_END_OF_LIFE).map(Number), [20, 22, 24, 26]);
});

const t = (l) => makeTranslator(l);
const owner = { id: "o", email: "o@example.org", name: "o", level: "owner", roles: ["owner"], rights: new Set(["core:backup", "core:updates"]), locale: null, advanced: false, totp: true };
const editor = { ...owner, level: "editor", roles: ["editor"], rights: new Set() };
const base = { databaseOk: true, disk: "ok", instancesSetAside: 0, updateFailed: false, backup: { at: "2026-11-01T10:00:00Z", recent: true } };
const facts = (node, locale) => ({ glance: { ...base, ...(node ? { node } : {}) }, contentLook: false, ...(locale ? { locale } : {}) });

test("dashboard health: nothing when Node.js is ok or unknown; one actionable line when not", () => {
  for (const node of [undefined, nodeSupport("v24.22.3", day("2026-11-19")), nodeSupport("v99.0.0", day("2026-11-19"))]) assert.deepEqual(summarize(healthPoints(owner, facts(node), t("fr"))), { points: [], ok: true, problems: 0 });
  const eol = nodeSupport("v20.20.2", day("2026-11-19"));
  const fr = healthPoints(owner, facts(eol, "fr"), t("fr"));
  assert.equal(fr.length, 1);
  assert.equal(fr[0].id, "node");
  assert.equal(fr[0].severity, "problem");
  assert.equal(fr[0].label, "Node.js 20 n'est plus maintenu depuis le 30 avril 2026. Passez à Node.js 24.");
  assert.match(fr[0].help, /Sauvegardez le site, installez Node\.js 24/);
  const en = healthPoints(owner, facts(eol, "en"), t("en"));
  assert.equal(en[0].label, "Node.js 20 has not been maintained since April 30, 2026. Move to Node.js 24.");
  const soon = healthPoints(owner, facts(nodeSupport("v22.23.4", day("2027-02-01")), "fr"), t("fr"));
  assert.equal(soon[0].severity, "advice");
  assert.equal(soon[0].label, "Node.js 22 ne sera plus maintenu après le 30 avril 2027. Passez à Node.js 24.");
  const last = healthPoints(owner, facts(nodeSupport("v24.22.3", day("2028-03-01")), "fr"), t("fr"));
  assert.equal(last[0].label, "Node.js 24 ne sera plus maintenu après le 30 avril 2028.");
  assert.equal(last[0].help, undefined, "no step to give when there is no newer supported major");
  assert.deepEqual(healthPoints(editor, facts(eol), t("fr")), [], "a person without technical rights does not see it");
});

test("locales: the Node.js health texts exist in both languages with the same variables", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of ["nodeEnded", "nodeEnding", "nodeEndedLast", "nodeEndingLast", "nodeHelp"]) assert.equal(vars(en[`dash.health.${k}`]), vars(fr[`dash.health.${k}`]), k);
});
