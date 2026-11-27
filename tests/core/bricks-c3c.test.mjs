// Phase C3c : new admin bricks (StatusPill, EmptyState, AttentionCard, ChecklistCard, RightsMatrix). Pure rules, render, accessibility, keyboard moves,
// the reserved rights are never grantable, and EN+FR parity of the texts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const { StatusPill } = await import("@/components/admin/StatusPill");
const { EmptyState } = await import("@/components/admin/EmptyState");
const { AttentionCard } = await import("@/components/admin/AttentionCard");
const { ChecklistCard, checklistState } = await import("@/components/admin/ChecklistCard");
const { RightsMatrix } = await import("@/components/admin/RightsMatrix");
const { rightsMatrixLabels, checklistLabels } = await import("@/components/admin/brickLabels");
const M = await import("@/core/adminkit/rightsMatrix");
const { CORE_RESERVED } = await import("@/core/auth/rights");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const groups = [
  { id: "content", title: "Content", rights: [{ id: "core:entries.edit", label: "Edit entries" }, { id: "core:entries.publish", label: "Publish entries", sensitive: true }] },
  { id: "team", title: "Team", rights: [{ id: "core:team", label: "Manage the team", reserved: true }, { id: "core:roles", label: "Manage roles" }, { id: "links:open", label: "Open links", help: "Opens the links page of the module." }] },
];
const roles = [{ id: "owner", name: "Owner", system: true, people: 1 }, { id: "editor", name: "Editorial", system: true, people: 3 }, { id: "helper", name: "Helper", people: 2 }];
const grants = { owner: ["core:entries.edit", "core:entries.publish", "core:team", "core:roles", "links:open"], editor: ["core:entries.edit", "core:entries.publish"], helper: ["core:entries.edit", "core:team", "core:roles"] };
const L = rightsMatrixLabels(makeTranslator("en"));

test("cellState: reserved rights are never grantable to a custom role, even when the data says so", () => {
  const held = new Set(grants.helper);
  const team = groups[1].rights[0], roles_ = groups[1].rights[1];
  assert.equal(M.cellState(roles[2], team, held, "helper"), "locked");
  assert.equal(M.cellState(roles[2], roles_, held, "helper"), "locked", "core:roles is reserved by CORE_RESERVED even without the flag");
  assert.equal(M.cellState(roles[0], team, new Set(grants.owner)), "yes", "a built-in preset can hold it");
  assert.equal(M.cellState(roles[1], team, new Set(grants.editor)), "locked");
  for (const id of CORE_RESERVED) assert.equal(M.cellState(roles[2], { id, label: id }, new Set([id]), "helper"), "locked", id);
});

test("cellState: only the edited custom role is editable; presets stay read-only", () => {
  const edit = groups[0].rights[0];
  assert.equal(M.cellState(roles[2], edit, new Set(), "helper"), "edit");
  assert.equal(M.cellState(roles[1], edit, new Set(grants.editor), "editor"), "yes", "a preset is never editable");
  assert.equal(M.cellState(roles[2], edit, new Set(["core:entries.edit"]), null), "yes");
  assert.equal(M.cellState(roles[2], groups[0].rights[1], new Set(), null), "no");
});

test("editableSelection drops reserved and unknown rights; grantSets drops reserved rights of custom roles", () => {
  assert.deepEqual(M.editableSelection(groups, ["core:entries.edit", "core:team", "core:roles", "nope:x", "core:entries.edit"]), ["core:entries.edit"]);
  const s = M.grantSets(roles, groups, grants);
  assert.deepEqual([...s.get("helper")], ["core:entries.edit"]);
  assert.ok(s.get("owner").has("core:team"));
});

test("groupCount leaves out what a custom role can never hold", () => {
  const sets = M.grantSets(roles, groups, grants);
  assert.deepEqual(M.groupCount(roles[2], groups[1], sets.get("helper")), { n: 0, total: 1 });
  assert.deepEqual(M.groupCount(roles[0], groups[1], sets.get("owner")), { n: 3, total: 3 });
});

test("moveFocus: arrows, Home/End and Ctrl+Home/End among existing cells", () => {
  const has = (r, c) => !(r === 1 && c === 1);
  const size = { rows: 3, cols: 3 };
  assert.deepEqual(M.moveFocus("ArrowRight", false, { row: 0, col: 0 }, size, has), { row: 0, col: 1 });
  assert.deepEqual(M.moveFocus("ArrowDown", false, { row: 0, col: 1 }, size, has), { row: 2, col: 1 }, "skips a missing cell");
  assert.equal(M.moveFocus("ArrowLeft", false, { row: 0, col: 0 }, size, has), null);
  assert.deepEqual(M.moveFocus("End", false, { row: 0, col: 0 }, size, has), { row: 0, col: 2 });
  assert.deepEqual(M.moveFocus("Home", false, { row: 2, col: 2 }, size, has), { row: 2, col: 0 });
  assert.deepEqual(M.moveFocus("End", true, { row: 0, col: 0 }, size, has), { row: 2, col: 0 });
  assert.deepEqual(M.moveFocus("Home", true, { row: 2, col: 0 }, size, has), { row: 0, col: 0 });
  assert.equal(M.moveFocus("a", false, { row: 0, col: 0 }, size, has), null);
});

test("RightsMatrix overview: table semantics, one tab stop, state by shape and word, counts, no personal data", () => {
  const out = html(h(RightsMatrix, { roles, groups, grants, labels: L, defaultOpen: ["content", "team"] }));
  assert.match(out, /<caption class="sr-only">Access matrix<\/caption>/);
  assert.equal((out.match(/scope="col"/g) ?? []).length, 4, "corner + 3 roles");
  assert.match(out, /scope="rowgroup"/);
  assert.match(out, /aria-expanded="true"/);
  assert.equal((out.match(/tabindex="0"/g) ?? []).length, 1, "a single tab stop");
  assert.match(out, /role="img" aria-label="Allowed"/);
  assert.match(out, /role="img" aria-label="Not allowed"/);
  assert.match(out, /aria-label="Cannot be delegated"/);
  assert.match(out, /data-matrix-glyph="locked"/);
  assert.match(out, /Built-in preset/);
  assert.match(out, /3 people/);
  assert.match(out, /1 person/);
  assert.match(out, /1 of 2/);
  assert.doesNotMatch(out, /<input/, "the overview has no box");
  assert.doesNotMatch(out, /@|example\.test/, "no address, no name");
  assert.match(out, /Sensitive/);
});

test("RightsMatrix folded areas hide their rows but keep them in the page; the area header is a labelled button", () => {
  const out = html(h(RightsMatrix, { roles, groups, grants, labels: L }));
  assert.equal((out.match(/<button type="button" aria-expanded="false" aria-controls="mx-/g) ?? []).length, 2);
  assert.match(out, /<tr id="mx-content-core:entries\.edit" hidden=""/);
  assert.equal((out.match(/tabindex="0"/g) ?? []).length, 0, "no visible cell, the area buttons are the stops");
});

test("RightsMatrix editing a role: boxes only for the edited custom role, never for a reserved right, names go with the form", () => {
  const out = html(h(RightsMatrix, { roles, groups, grants, labels: L, editRoleId: "helper", defaultOpen: ["content", "team"], name: "right" }));
  const boxes = [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
  assert.equal(boxes.length, 3, "two content rights + the delegable module right; the two reserved rights have no box");
  for (const b of boxes) { assert.match(b, /type="checkbox"/); assert.match(b, /name="right"/); }
  assert.ok(boxes.some((b) => b.includes('value="core:entries.edit"') && b.includes('checked=""')), "current grant is ticked");
  assert.equal(boxes.filter((b) => b.includes('checked=""')).length, 1);
  assert.ok(!boxes.some((b) => /core:team|core:roles/.test(b)));
  assert.match(out, /aria-label="Edit entries, Helper"/);
  assert.match(out, /data-matrix-chosen[^>]*>1 accesses chosen/);
  // a forged grant of a reserved right for the edited role is neither ticked nor sent
  assert.doesNotMatch(out, /value="core:team"/);
});

test("RightsMatrix: boxes of a folded area are still in the form (hidden, still sent)", () => {
  const out = html(h(RightsMatrix, { roles, groups, grants, labels: L, editRoleId: "helper" }));
  assert.equal((out.match(/<input[^>]*type="checkbox"/g) ?? []).length, 3);
});

test("StatusPill: a shape AND the word; the shape is hidden from screen readers", () => {
  for (const tone of ["ok", "warn", "danger", "info", "accent", "neutral"]) {
    const out = html(h(StatusPill, { tone }, "Word"));
    assert.match(out, new RegExp(`data-pill-glyph="${tone}"`));
    assert.match(out, /aria-hidden="true"/);
    assert.match(out, /Word<\/span>$/);
  }
  assert.match(html(h(StatusPill, { tone: "ok", title: "Since Monday" }, "Configured")), /title="Since Monday"/);
});

test("EmptyState: one sentence, one action, an optional example, a real heading", () => {
  const out = html(h(EmptyState, { title: "No command yet", action: h("button", null, "Add a command"), example: h("button", null, "Add an example") }));
  assert.match(out, /<h3[^>]*>No command yet<\/h3>/);
  assert.match(out, /data-empty-action[^>]*><button>Add a command/);
  assert.match(out, /data-empty-example/);
  assert.match(html(h(EmptyState, { title: "x", action: h("a", null, "y"), level: 2 })), /<h2/);
  assert.doesNotMatch(html(h(EmptyState, { title: "x", action: h("a", null, "y") })), /data-empty-example/);
});

test("AttentionCard: carries its action, draws nothing without one, never colour alone", () => {
  const out = html(h(AttentionCard, { title: "Backup is late", reason: "Last backup: 9 days ago.", action: h("a", { href: "/admin/maintenance" }, "Back up now"), tone: "danger", alert: true }));
  assert.match(out, /role="alert"/);
  assert.match(out, /data-attention-glyph="danger"[^>]*aria-hidden|aria-hidden="true"[^>]*data-attention-glyph="danger"/);
  assert.match(out, /<h3[^>]*>Backup is late/);
  assert.match(out, /Back up now/);
  assert.equal(html(h(AttentionCard, { title: "All is well", action: null })), "", "no action, no card");
  assert.doesNotMatch(html(h(AttentionCard, { title: "t", action: h("a", null, "go") })), /role="alert"/);
});

test("ChecklistCard: progress, next step, hidden state words, disappears once done (R33)", () => {
  const labels = checklistLabels(makeTranslator("en"));
  const steps = [{ id: "a", label: "Create the account", done: true }, { id: "b", label: "Paste the address", done: false, action: h("button", null, "Paste") }, { id: "c", label: "Test", done: false, action: h("button", null, "Run the test") }];
  assert.deepEqual(checklistState(steps), { done: 1, total: 3, next: 1, complete: false });
  const out = html(h(ChecklistCard, { title: "Set up", steps, labels }));
  assert.match(out, /1 of 3 done/);
  assert.match(out, /<ol/);
  assert.equal((out.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(out, /, Done<\/span>/);
  assert.match(out, /, To do<\/span>/);
  assert.match(out, />Paste</);
  assert.doesNotMatch(out, /Run the test/, "only the next step carries its action");
  const done = steps.map((s) => ({ ...s, done: true }));
  assert.equal(html(h(ChecklistCard, { title: "Set up", steps: done, labels })), "");
  assert.match(html(h(ChecklistCard, { title: "Set up", steps: done, labels, keepWhenDone: true })), /3 of 3 done/);
  assert.equal(html(h(ChecklistCard, { title: "x", steps: [], labels })), "");
});

test("texts: every brick key exists in EN and FR with the same {variables}, no jargon, no exclamation", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => k.startsWith("bricks."));
  assert.equal(keys.length, 15);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) {
    assert.ok(typeof fr[k] === "string" && fr[k].length > 0, `fr ${k}`);
    assert.equal(vars(en[k]), vars(fr[k]), k);
    assert.doesNotMatch(en[k] + fr[k], /!|\b(token|jeton|slug|JSON|API)\b/i, k);
  }
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("bricks.")).sort(), keys.slice().sort());
  for (const lang of ["en", "fr"]) {
    const l = rightsMatrixLabels(makeTranslator(lang));
    for (const [k, v] of Object.entries(l)) assert.ok(v && !v.startsWith("bricks."), `${lang} ${k}`);
  }
});

test("the bricks stay presentational: no data access, no gate, no route", () => {
  for (const f of ["RightsMatrix", "StatusPill", "EmptyState", "AttentionCard", "ChecklistCard"]) {
    const s = fs.readFileSync(`src/components/admin/${f}.tsx`, "utf8");
    assert.doesNotMatch(s, /@\/core\/db|prisma|next\/headers|adminCtx|fetch\(/, f);
  }
  const p = fs.readFileSync("src/core/adminkit/rightsMatrix.ts", "utf8");
  assert.doesNotMatch(p, /prisma|next\//);
});
