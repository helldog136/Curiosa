import test from "node:test";
import assert from "node:assert/strict";

/**
 * FORMAL REVIEW, personal AI ceiling (spec: docs/formal/personal-ai-ceiling.md). Exhaustive enumeration, no dependency, no database.
 *
 * Property: a personal AI can call a tool only if its OWNER could do what the tool does, RIGHT NOW (and the ordinary rules of the access still hold).
 * Method: every combination of owner state x tool requirement x access (scope, grants, full powers) over a small domain is checked against an ORACLE written from
 * the doc comment of ownerCeiling.ts (not from its code). Then the same checker is run against deliberately broken versions of `canUse` (mutants): every mutant MUST
 * be caught, otherwise the invariants are vacuous.
 *
 * Files covered: src/core/services/mcp/ownerCeiling.ts, src/core/services/mcp/access.ts (canUse, withinCeiling, isGranted).
 * Last synced with: core 0.46.0 (commit 57236d6).
 */
const C = await import("@/core/services/mcp/ownerCeiling");
const A = await import("@/core/services/mcp/access");

/* ───────────── The domain ───────────── */

const TIERS = ["none", "editor", "admin", "coordinator", "owner"];
const RANK = { none: 0, editor: 1, admin: 2, coordinator: 3, owner: 4 };
const RIGHTS = ["core:entries.edit", "core:updates", "blog:open"];
const subsets = (list) => list.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

/** Every owner state: 5 tiers x 8 sets of rights x active or inert (a tier with a set of rights is only reachable for `active` states, but inert ones must be inert whatever they hold). */
const OWNERS = [];
for (const tier of TIERS) for (const set of subsets(RIGHTS)) for (const active of [true, false]) OWNERS.push({ ownerId: "u", active, ...(active ? {} : { inert: "paused" }), tier, rights: new Set(set), fingerprint: "f" });

/** Every shape of requirement, including the broken ones (fail closed). */
const REQUIREMENTS = [
  undefined, {}, { none: true }, { right: "" }, { none: true, right: "core:updates" }, { none: true, tier: "owner" }, { tier: "bogus" }, { right: "unknown:right" },
  ...RIGHTS.map((right) => ({ right })),
  ...["editor", "admin", "owner"].map((tier) => ({ tier })),
  ...RIGHTS.flatMap((right) => ["editor", "admin", "owner"].map((tier) => ({ right, tier }))),
];

/** What the doc comment says (independent of the code). `none` alone is open; an empty requirement never passes; several keys must all hold (`none` next to another key opens nothing, fixed in 0.46.1). */
function oracleMet(req, owner) {
  if (!owner.active || req === undefined) return false;
  const keys = ["right", "tier"].filter((k) => req[k] !== undefined);
  if (keys.length === 0) return req.none === true;
  if (req.right !== undefined && !(typeof req.right === "string" && req.right.length > 0 && (owner.tier === "owner" || owner.rights.has(req.right)))) return false;
  if (req.tier !== undefined && !(RANK[req.tier] !== undefined && req.tier !== "none" && RANK[owner.tier] >= RANK[req.tier])) return false;
  return true;
}

const TOOLS = [];
for (const requires of REQUIREMENTS) for (const readOnly of [true, false]) for (const dflt of [true, false]) TOOLS.push({ name: "t", requires, readOnly, default: dflt });

const GRANTS = [{}, { t: true }, { t: false }];
const TOKENS = [];
for (const scope of ["read", "write"]) for (const grants of GRANTS) for (const fullPowers of [false, true]) TOKENS.push({ scope, grants, fullPowers });

/* ───────────── The checker ───────────── */

/**
 * `impl.canUse(tool, token)` is the function under test. Returns the list of violated invariants (empty = the implementation holds on the whole domain).
 *  I1 sound      : allowed => the owner meets the requirement now, the access is not read-only for a writing tool, and the tool is granted.
 *  I2 complete   : the three conditions above together => allowed (no useless closing).
 *  I3 fail closed: no requirement / invalid requirement / inert owner => never allowed.
 *  I4 no powers  : the full powers flag changes nothing for a personal AI.
 *  I5 monotonic  : lowering the owner (fewer rights, lower tier, inert) never allows more.
 */
function check(impl) {
  const bad = new Set();
  const seenAllowed = { n: 0 };
  for (const owner of OWNERS) for (const tool of TOOLS) for (const base of TOKENS) {
    const token = { scope: base.scope, grants: base.grants, fullPowers: base.fullPowers, personal: owner };
    const got = impl.canUse(tool, token);
    const rule = (base.scope === "write" || tool.readOnly) && (base.grants.t ?? tool.default);
    const want = oracleMet(tool.requires, owner) && rule;
    if (got) seenAllowed.n++;
    if (got && !want) bad.add(got && !oracleMet(tool.requires, owner) ? "I1 sound (owner cannot do it)" : "I1 sound (ordinary rules)");
    if (!got && want) bad.add("I2 complete");
    if (got && (tool.requires === undefined || !owner.active)) bad.add("I3 fail closed");
    if (impl.canUse(tool, { ...token, fullPowers: !base.fullPowers }) !== got) bad.add("I4 no powers");
  }
  // I5 on the pure ceiling, over every pair of owners
  for (const lower of OWNERS) for (const higher of OWNERS) {
    const below = !lower.active || (higher.active && RANK[lower.tier] <= RANK[higher.tier] && [...lower.rights].every((r) => higher.rights.has(r)));
    if (!below) continue;
    for (const requires of REQUIREMENTS) {
      const tool = { name: "t", requires, readOnly: true, default: true };
      const tk = (personal) => ({ scope: "read", grants: {}, personal });
      if (impl.canUse(tool, tk(lower)) && !impl.canUse(tool, tk(higher))) bad.add("I5 monotonic");
    }
  }
  return { bad: [...bad].sort(), allowed: seenAllowed.n };
}

/* ───────────── The real code ───────────── */

test("the real canUse holds every invariant over the whole domain (tiers x rights x requirements x access)", () => {
  const total = OWNERS.length * TOOLS.length * TOKENS.length;
  const r = check({ canUse: A.canUse });
  assert.deepEqual(r.bad, [], "a personal AI went beyond its owner, or was closed for no reason");
  // anti-vacuity: both outcomes are reached many times, so the invariants are not true by emptiness
  assert.ok(total > 50_000, `the domain is real (${total})`);
  assert.ok(r.allowed > 2_000 && r.allowed < total / 2, `some, but not all, combinations are allowed (${r.allowed} of ${total})`);
});

test("anti-vacuity: every broken canUse is caught by the checker", () => {
  const within = A.withinCeiling, granted = A.isGranted;
  const mutants = {
    "no owner ceiling at all": { canUse: (t, k) => within(t, k.scope) && granted(t, k.grants), expect: "I1 sound" },
    "a tool nobody classified is open": { canUse: (t, k) => (t.requires === undefined || C.ownerCeilingAllows(t, k.personal)) && within(t, k.scope) && granted(t, k.grants), expect: "I3" },
    "an empty requirement is read as 'none'": { canUse: (t, k) => C.ownerCeilingAllows(t.requires && !t.requires.right && !t.requires.tier && !t.requires.none ? { ...t, requires: { none: true } } : t, k.personal) && within(t, k.scope) && granted(t, k.grants), expect: "I3|I1" },
    "full powers reach a personal AI": { canUse: (t, k) => (k.fullPowers === true && within(t, k.scope)) || (C.ownerCeilingAllows(t, k.personal) && within(t, k.scope) && granted(t, k.grants)), expect: "I1|I4" },
    "the owner's inertness is ignored": { canUse: (t, k) => C.ownerCeilingAllows(t, { ...k.personal, active: true }) && within(t, k.scope) && granted(t, k.grants), expect: "I3|I1" },
    "the coordinator is ranked as an editor": { canUse: (t, k) => C.ownerCeilingAllows(t, { ...k.personal, tier: k.personal.tier === "coordinator" ? "editor" : k.personal.tier }) && within(t, k.scope) && granted(t, k.grants), expect: "I2" },
    "grants are ignored": { canUse: (t, k) => C.ownerCeilingAllows(t, k.personal) && within(t, k.scope), expect: "I1|I2" },
    "the read-only ceiling is ignored": { canUse: (t, k) => C.ownerCeilingAllows(t, k.personal) && granted(t, k.grants), expect: "I1" },
    "a grant is enough, the owner's right is not looked at (grant above the owner)": { canUse: (t, k) => k.grants.t === true ? within(t, k.scope) : C.ownerCeilingAllows(t, k.personal) && within(t, k.scope) && granted(t, k.grants), expect: "I1" },
    "everything is closed": { canUse: () => false, expect: "I2" },
  };
  for (const [name, m] of Object.entries(mutants)) {
    const r = check(m);
    assert.ok(r.bad.length > 0, `MUTANT NOT CAUGHT: ${name}`);
    assert.ok(r.bad.some((b) => new RegExp(`^(${m.expect})`).test(b)), `${name}: caught, but by ${r.bad.join(", ")} instead of ${m.expect}`);
  }
});

/* ───────────── Details the enumeration does not reach ───────────── */

test("the requirement of a tool: only an unclassified core tool is looked up by name, never an inherited property, never an instance or module tool", () => {
  assert.equal(C.requirementOf({ name: "site_info" }).none, true);
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "nonexistent_tool"]) assert.equal(C.requirementOf({ name }), undefined, name);
  assert.equal(C.requirementOf({ name: "site_info", instanceId: "i" }), undefined);
  assert.equal(C.requirementOf({ name: "site_info", moduleId: "m" }), undefined);
  assert.equal(C.requirementOf({ name: "a__site_info" }), undefined);
  // an explicit requirement wins over the table, so a module cannot be made looser by naming its tool like a core one
  assert.deepEqual(C.requirementOf({ name: "maintenance_core_update", requires: { tier: "owner" } }), { tier: "owner" });
});

test("INERT_STATE is inert for every reason and never meets any requirement, `none` included", () => {
  for (const why of ["policy_off", "not_allowed", "paused", "owner_missing", "owner_locked", "unavailable"]) {
    const s = C.INERT_STATE("u", why);
    assert.equal(s.active, false);
    for (const requires of REQUIREMENTS) assert.equal(C.ownerCeilingAllows({ name: "x", requires }, s), false, `${why} ${JSON.stringify(requires)}`);
  }
});

test("ownerHolds and ownerHasTier never say yes for an inert owner, an empty or non-string right, or an unknown tier", () => {
  const owner = { ownerId: "u", active: true, tier: "owner", rights: new Set(), fingerprint: "f" };
  assert.equal(C.ownerHolds(owner, ""), false);
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(C.ownerHolds(owner, bad), false);
  assert.equal(C.ownerHolds({ ...owner, active: false }, "core:updates"), false);
  assert.equal(C.ownerHasTier({ ...owner, tier: "bogus" }, "editor"), false);
  assert.equal(C.ownerHasTier({ ...owner, active: false }, "editor"), false);
});

test("a module declaration that is invalid is a requirement nobody meets, not 'no requirement'", () => {
  const toRight = (m, r) => (typeof r === "string" && /^[a-z.]+$/.test(r) ? `${m}:${r}` : null);
  assert.equal(C.declaredRequirement("blog", undefined, toRight), undefined, "not declared: hidden (undefined)");
  assert.deepEqual(C.declaredRequirement("blog", "edit.x", toRight), { right: "blog:edit.x" });
  for (const bad of ["Bad Id", 5, null, "other:x"]) {
    const req = C.declaredRequirement("blog", bad, toRight);
    assert.ok(req !== undefined);
    for (const owner of OWNERS) assert.equal(C.requirementMet(req, owner), false, `${bad} ${owner.tier}`);
  }
});

test("the full-powers exclusion list is only a default: a personal AI never gets it, whatever the tool name", () => {
  const owner = { ownerId: "u", active: true, tier: "owner", rights: new Set(), fingerprint: "f" };
  const secretTool = { name: "token_create", readOnly: false, default: false, requires: { tier: "owner" } };
  assert.equal(A.canUse(secretTool, { scope: "write", grants: {}, fullPowers: true, personal: owner }), false, "full powers do not apply to a personal AI");
  assert.equal(A.canUse(secretTool, { scope: "write", grants: { token_create: true }, personal: owner }), true, "an explicit tick of the owner's own tool is the only way (the owner can do it)");
});
