// R33, core 0.36.0: the `connection` block (one-line state + ONE edit button), `valueHint` and `kind: "secret"` of the module forms, and the silent `netHealth`.
// The behaviour in a real browser (dialog opening, buttons) is checked with the screenshots of the pull request; here: the pure rules, the HTML the server renders and the wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const read = (f) => fs.readFileSync(f, "utf8");
const { connectionView, sinceText, safeTarget, CONNECTION_STATES } = await import("@/core/adminkit/connection");
const { valueHintView } = await import("@/core/adminkit/valueHint");
const { describeNetHealth } = await import("@/core/netHealthText");
const { connectionLabels, formLabels } = await import("@/components/admin/kitLabels");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { HelpTipProvider } = await import("@/components/admin/HelpTip");
const { NetHealthNote } = await import("@/components/admin/NetHealthNote");
const { AdminBlockForm } = await import("@/components/admin/AdminBlocks");
const E = await import("../../testsupport/ergonomics.mjs");

const base = { type: "connection", id: "app", title: "Application de démonstration", edit: { href: "?edit=app" } };
const conf = { ...base, state: "configured", summary: "Client …a1b2 · 2 comptes connectés" };

/* ───────────── pure rules ───────────── */

test("the three states, and nothing else: an unknown state or a missing title shows nothing", () => {
  assert.deepEqual([...CONNECTION_STATES], ["configured", "degraded", "notConfigured"]);
  assert.equal(connectionView({ ...conf, state: "ready" }), null);
  assert.equal(connectionView({ ...conf, state: "taken-over" }), null);
  assert.equal(connectionView({ ...conf, title: "  " }), null);
  assert.equal(connectionView(null), null);
});

test("configured: summary and edit only; the setup blocks, the reason and the fix are never shown (R33.3, R33.5)", () => {
  const v = connectionView({ ...conf, reason: "ne devrait pas apparaître", primary: { label: "Corriger", href: "/x" }, setup: [{ type: "copy", text: "https://exemple.test/retour" }], since: "2026-11-01T10:00:00Z" });
  assert.equal(v.state, "configured");
  assert.equal(v.summary, "Client …a1b2 · 2 comptes connectés");
  assert.equal(v.reason, "");
  assert.equal(v.primary, null);
  assert.deepEqual(v.setup, []);
  assert.equal(v.since, null);
  assert.deepEqual(v.edit, { href: "?edit=app", label: undefined });
});

test("degraded: reason, fix and since; the edit button stays", () => {
  const v = connectionView({ ...base, state: "degraded", summary: "Compte etoile_nord", reason: "Twitch refuse l'autorisation de etoile_nord", since: "2026-11-15T15:54:00Z", primary: { label: "Autoriser de nouveau", href: "https://id.example.test/authorize" } });
  assert.equal(v.state, "degraded");
  assert.equal(v.reason, "Twitch refuse l'autorisation de etoile_nord");
  assert.equal(v.primary.label, "Autoriser de nouveau");
  assert.ok(v.since instanceof Date);
  assert.ok(v.edit);
  assert.match(sinceText(v.since, "fr", new Date("2026-11-18").getTime()), /15 novembre/);
  assert.doesNotMatch(sinceText(v.since, "fr", new Date("2026-11-18").getTime()), /2026/);
  assert.match(sinceText(v.since, "en", new Date("2027-02-01").getTime()), /2026/);
});

test("not configured: reason and setup blocks, a fix, and NO edit button (the setup is the edit)", () => {
  const v = connectionView({ ...base, state: "notConfigured", summary: "ignored", reason: "Aucun identifiant n'est enregistré", setup: [{ type: "copy", text: "https://exemple.test/retour" }, { type: "markdown", text: "Étape 1" }], primary: { label: "Enregistrer l'application", action: "openSetup" } });
  assert.equal(v.state, "notConfigured");
  assert.equal(v.edit, null);
  assert.equal(v.summary, "", "nothing is configured: no summary");
  assert.equal(v.setup.length, 2);
  assert.deepEqual(v.primary, { label: "Enregistrer l'application", action: "openSetup" });
});

test("a configured connection whose services have a problem is degraded, with one line; healthy services add nothing", () => {
  const lookup = (host) => (host === "down.example.org" ? { host, state: "down", since: Date.now() - 3600_000 } : { host, state: "ok", since: Date.now() - 86_400_000 });
  const sick = describeNetHealth([{ host: "down.example.org", label: "Service A" }, { host: "ok.example.org", label: "Service B" }], "fr", { lookup }).lines;
  const v = connectionView({ ...conf, net: [] }, sick);
  assert.equal(v.state, "degraded");
  assert.equal(v.fromNet, true);
  assert.match(v.reason, /^Service A ne répond pas depuis /);
  assert.equal(v.since, null, "the time is already in the line");
  const fine = describeNetHealth([{ host: "ok.example.org", label: "Service B" }], "fr", { lookup }).lines;
  assert.equal(connectionView(conf, fine).state, "configured");
  assert.equal(connectionView({ ...base, state: "notConfigured", reason: "Rien n'est enregistré" }, sick).state, "notConfigured");
});

test("rows keep only the accounts that need attention; the menu is capped and checked; links are checked", () => {
  const v = connectionView({ ...conf, rows: [{ text: "etoile_nord", state: "configured" }, { text: "lune_douce", state: "degraded", reason: "À renouveler", primary: { label: "Renouveler", href: "javascript:alert(1)" } }, { text: "camille", state: "notConfigured", primary: { label: "Connecter", href: "/admin/x" } }],
    menu: [1, 2, 3, 4, 5].map((n) => ({ label: `Action ${n}`, action: `a${n}` })).concat([{ label: "Mauvaise", action: "bad action" }]) });
  assert.deepEqual(v.rows.map((r) => r.text), ["lune_douce", "camille"]);
  assert.equal(v.rows[0].primary, undefined, "an unsafe link is dropped");
  assert.equal(v.rows[1].primary.href, "/admin/x");
  assert.equal(v.menu.length, 4);
  assert.equal(safeTarget("javascript:alert(1)"), null);
  assert.equal(safeTarget("//evil.test"), null);
  assert.equal(safeTarget("http://plain.test"), null);
  assert.equal(safeTarget("?edit=app"), "?edit=app");
  assert.equal(safeTarget("https://ok.example.org/x"), "https://ok.example.org/x");
});

/* ───────────── netHealth ───────────── */

const now = new Date(2026, 9, 20, 11, 0, 0).getTime();
const at = (hh, m) => new Date(2026, 9, 20, hh, m, 0).getTime();
const states = {
  "ok.example.org": { host: "ok.example.org", state: "ok", since: at(9, 0) },
  "ok2.example.org": { host: "ok2.example.org", state: "ok", since: at(9, 0) },
  "slow.example.org": { host: "slow.example.org", state: "slow", since: at(10, 42) },
  "rate.example.org": { host: "rate.example.org", state: "rate", since: at(10, 50), retryAt: at(11, 30) },
  "down.example.org": { host: "down.example.org", state: "down", since: at(10, 15) },
  "down2.example.org": { host: "down2.example.org", state: "down", since: at(10, 15) },
};
const lookup = (h) => states[h] ?? null;

test("netHealth is silent when every host answers, and never says a host was not contacted (R33.1, R33.7)", () => {
  for (const locale of ["fr", "en"]) {
    const v = describeNetHealth([{ host: "ok.example.org", label: "Twitch" }, { host: "ok2.example.org", label: "Connexion à Twitch" }, { host: "never.example.org", label: "Jamais appelé" }], locale, { now, lookup });
    assert.deepEqual(v.lines, [], "nothing to say");
    assert.equal(v.hint, null);
  }
});

test("netHealth: one line per problem, hosts with the same problem since the same time share ONE line (the per-host duplicate)", () => {
  const items = [{ host: "ok.example.org", label: "Twitch" }, { host: "down.example.org", label: "Twitch" }, { host: "down2.example.org", label: "Connexion à Twitch" }, { host: "slow.example.org", label: "Service B", lastGoodAt: new Date(at(10, 30)).toISOString() }, { host: "rate.example.org", label: "Service C" }];
  const fr = describeNetHealth(items, "fr", { now, lookup });
  assert.deepEqual(fr.lines.map((l) => l.text), ["Twitch et Connexion à Twitch ne répondent pas depuis 10:15.", "Service B répond lentement depuis 10:42. Les données affichées datent de 10:30.", "Service C : trop de demandes, pause jusqu'à 11:30."]);
  assert.deepEqual(fr.lines[0].hosts, ["down.example.org", "down2.example.org"]);
  assert.match(fr.hint, /reprend tout seul/);
  const en = describeNetHealth(items, "en", { now, lookup });
  assert.equal(en.lines[0].text, "Twitch and Connexion à Twitch have not been responding since 10:15 AM.");
  // The same label twice stays singular.
  const same = describeNetHealth([{ host: "down.example.org", label: "Twitch" }, { host: "down2.example.org", label: "Twitch" }], "fr", { now, lookup });
  assert.deepEqual(same.lines.map((l) => l.text), ["Twitch ne répond pas depuis 10:15."]);
  // The fixed sentences about "works normally", "not contacted yet" and the summary are gone from both languages.
  for (const lang of ["fr", "en"]) {
    const loc = JSON.parse(read(`src/locales/${lang}.json`));
    for (const k of ["net.health.ok", "net.health.unknown", "net.health.summary"]) assert.ok(!(k in loc), `${lang} ${k}`);
  }
});

test("the netHealth block renders nothing when healthy and one compact line with a ? bubble when not; the hint is not printed", () => {
  const view = describeNetHealth([{ host: "down.example.org", label: "Service A" }], "fr", { now, lookup });
  const out = html(h(HelpTipProvider, { label: "Aide : {name}" }, h(NetHealthNote, { view })));
  assert.match(out, /Service A ne répond pas depuis 10:15/);
  assert.match(out, /data-helptip/);
  assert.match(out, /role="tooltip"/);
  assert.doesNotMatch(out, /<h3/, "no card heading for a problem line");
  const src = read("src/components/site/Blocks.tsx");
  const at0 = src.indexOf('case "netHealth"');
  assert.match(src.slice(at0, at0 + 700), /if \(view\.lines\.length === 0\) break;/);
  assert.match(src.slice(at0, at0 + 400), /if \(!adminInstanceId\) break;/);
});

/* ───────────── valueHint and secret ───────────── */

const t = makeTranslator("fr");
const texts = { kept: t("field.kept"), carried: t("field.carried", { source: "{source}" }) };

test("valueHint: a secret never looks empty and says to leave it empty; a text shows its last characters; carried names its source", () => {
  assert.deepEqual(valueHintView({ kind: "secret", valueHint: "kept" }, texts), { placeholder: "••••••••", line: "Laisser vide pour garder l'actuel" });
  assert.deepEqual(valueHintView({ kind: "text", valueHint: "kept", valueTail: "mnop34" }, texts), { placeholder: "…op34", line: "Laisser vide pour garder l'actuel" });
  assert.equal(valueHintView({ kind: "secret", valueHint: "kept", valueTail: "abcd" }, texts).placeholder, "••••••••", "never a piece of a secret");
  assert.equal(valueHintView({ kind: "text", valueHint: "carried", valueSource: "le connecteur Twitch" }, texts).line, "Réglé dans le connecteur Twitch · Laisser vide pour garder l'actuel");
  assert.equal(valueHintView({ kind: "text" }, texts), null);
  assert.equal(valueHintView({ kind: "text", valueHint: "kept" }, undefined), null);
});

test("the form dialog fields: kind secret is a hidden password field (never the value), valueHint adds the sentence and removes `required`", () => {
  const block = { type: "adminForm", action: "saveApp", submitLabel: "Enregistrer l'application", presentation: undefined, fields: [
    { name: "clientId", label: "Identifiant de l'application", kind: "text", required: true, value: "", valueHint: "carried", valueSource: "Twitch", valueTail: "a1b2" },
    { name: "secret", label: "Code secret", kind: "secret", required: true, value: "ne-doit-jamais-sortir", valueHint: "kept" },
    { name: "fresh", label: "Nouveau code", kind: "secret" },
  ] };
  const labels = formLabels(t, "fr", block);
  assert.deepEqual(labels.valueHint, texts);
  const out = html(h(HelpTipProvider, { label: "Aide : {name}" }, h(AdminBlockForm, { instanceId: "abc", block, labels })));
  assert.doesNotMatch(out, /ne-doit-jamais-sortir/, "a secret value is never sent back to the page");
  assert.equal([...out.matchAll(/type="password"/g)].length, 2);
  assert.match(out, /placeholder="…a1b2"/);
  assert.equal([...out.matchAll(/placeholder="••••••••"/g)].length, 1);
  assert.equal([...out.matchAll(/Laisser vide pour garder l&#x27;actuel/g)].length, 2);
  assert.match(out, /Réglé dans Twitch/);
  const inputs = [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
  const idInput = inputs.find((i) => /name="clientId"/.test(i)), secretInput = inputs.find((i) => /name="secret"/.test(i));
  assert.ok(!/required/.test(idInput) && !/required/.test(secretInput), "an empty field keeps the current value: not required");
  assert.match(secretInput, /data-1p-ignore/, "no password manager");
  assert.doesNotMatch(JSON.stringify(formLabels(t, "fr", { ...block, fields: [{ name: "a", label: "A" }] })), /valueHint/);
});

test("a secret setting of the manifest says to leave it empty once it is set", () => {
  const src = read("src/components/admin/ModuleSettings.tsx");
  assert.match(src, /case "secret":[\s\S]{0,400}t\("field\.kept"\)/);
});

/* ───────────── rendering and wiring ───────────── */

test("the labels of the card: the three words come from the core, EN and FR", () => {
  assert.deepEqual(connectionLabels(makeTranslator("fr")).state, { configured: "Configuré", degraded: "Dégradé", notConfigured: "Non configuré" });
  assert.deepEqual(connectionLabels(makeTranslator("en")).state, { configured: "Configured", degraded: "Degraded", notConfigured: "Not configured" });
  assert.deepEqual(E.STATE_VOCABULARY.fr, connectionLabels(makeTranslator("fr")).state);
  assert.deepEqual(E.STATE_VOCABULARY.en, connectionLabels(makeTranslator("en")).state);
});

test("the block is wired in the admin panel of an instance only, with the setup rendered only when not configured", () => {
  const src = read("src/components/site/Blocks.tsx");
  const at0 = src.indexOf('case "connection"');
  assert.ok(at0 > 0);
  const body = src.slice(at0, at0 + 1100);
  assert.match(body, /if \(!panelInstanceId \|\| entryScope \|\| !ConnectionCard\) break;/);
  assert.match(body, /view\.setup\.length > 0/);
  assert.match(body, /filter\(\(b\) => b\.type !== "connection"\)/, "no connection inside a connection");
  assert.match(read("src/components/site/adminKit.ts"), /ConnectionCard/);
  assert.doesNotMatch(src, /from "\.\.\/admin\/(ConnectionCard|NetHealthNote|HelpTip)"/, "the public pages do not import the admin components");
});

/* ───────────── regression: a module with places and no `settings` ───────────── */
test("places: a module with `places` and no `settings` (contacts-like) does not crash the place functions or the kit", async () => {
  const P = await import("@/core/modules/places");
  const man = { id: "contacts-like", places: [{ id: "main", place: "people.contacts", blocks: true }] };
  assert.doesNotThrow(() => P.placeAdvice(man));
  assert.doesNotThrow(() => P.placeIssues(man));
  assert.doesNotThrow(() => P.moduleSections(man));
  assert.doesNotThrow(() => P.moduleTopics(man));
  assert.doesNotThrow(() => P.fullyPlaced(man, P.moduleSections(man)));
});

/* ───────────── regression: a query-only address ("?edit=app") reached the page as href="#" and the button did nothing ───────────── */
test("the primary button of a card keeps a query-only address in the rendered HTML, and still neutralises unsafe ones", async () => {
  const { ConnectionCard } = await import("@/components/admin/ConnectionCard");
  const t = makeTranslator("fr");
  const render = (href) => {
    const view = connectionView({ type: "connection", state: "notConfigured", title: "Application", primary: { label: "Enregistrer l'application", href } });
    return html(React.createElement(ConnectionCard, { view, instanceId: "i1", labels: connectionLabels(t), locale: "fr" }));
  };
  assert.match(render("?edit=app"), /<a href="\?edit=app"[^>]*>Enregistrer l&#x27;application<\/a>/);
  assert.match(render("/admin/instances/i1?tab=use"), /href="\/admin\/instances\/i1\?tab=use"/);
  assert.equal(connectionView({ type: "connection", state: "notConfigured", title: "A", primary: { label: "x", href: "javascript:alert(1)" } }).primary, null);
});
