import test from "node:test";
import assert from "node:assert/strict";
import { findSrpViolations, assertNoSrpViolations } from "../helpers/builtinChecks.mjs";

const m = (id, extra = {}) => ({ id, ...extra });
const secret = (key) => ({ key, type: "secret", label: key });

test("SRP : un ensemble propre ne signale rien (Contacts fournisseur, Partenariats consommateur)", () => {
  const set = [
    m("contacts", { offers: [{ service: "contact.store" }], mcp: [{ name: "contacts_list" }] }),
    m("partnerships", { requires: [{ service: "contact.store" }], mcp: [{ name: "partners_list" }] }),
    m("form", { requires: [{ service: "contact.store" }] }),
  ];
  assert.deepEqual(findSrpViolations(set), []);
  assertNoSrpViolations(set);
  assert.deepEqual(findSrpViolations([]), []);
  assert.deepEqual(findSrpViolations(undefined), []);
});

test("SRP : un même service offert par deux modules est signalé, sauf substitution voulue", () => {
  const set = [m("a", { offers: [{ service: "contact.store" }] }), m("b", { offers: [{ service: "contact.store" }, { service: "autre.service" }] })];
  const v = findSrpViolations(set);
  assert.deepEqual(v.map((x) => [x.rule, x.key, x.modules]), [["service", "contact.store", ["a", "b"]]]);
  assert.deepEqual(findSrpViolations(set, { substitutes: ["contact.store"] }), []);
  assert.throws(() => assertNoSrpViolations(set), /contact\.store/);
  assert.deepEqual(findSrpViolations([m("a", { offers: [{ service: "x.y" }, { service: "x.y" }] })]), [], "un module qui se répète n'est pas un doublon");
});

test("SRP : deux actions MCP de même nom dans deux modules", () => {
  const set = [m("a", { mcp: [{ name: "list_items" }] }), m("b", { mcp: [{ name: "list_items" }, { name: "other" }] })];
  assert.deepEqual(findSrpViolations(set).map((x) => [x.rule, x.key, x.modules]), [["mcp", "list_items", ["a", "b"]]]);
  assert.deepEqual(findSrpViolations(set, { mcp: ["list_items"] }), []);
});

test("SRP : le même secret dans deux modules sans lien de service est signalé ; fournisseur/consommateur exemptés", () => {
  const key = "api_key";
  const free = [m("a", { settings: [secret(key)] }), m("b", { sections: [{ id: "s", options: [secret(key)] }] })];
  assert.deepEqual(findSrpViolations(free).map((x) => [x.rule, x.key, x.modules]), [["secret", key, ["a", "b"]]]);
  const linked = [m("a", { offers: [{ service: "s.x" }], settings: [secret(key)] }), m("b", { requires: [{ service: "s.x" }], settings: [secret(key)] })];
  assert.deepEqual(findSrpViolations(linked), [], "liés par un service : pas cette règle");
  assert.deepEqual(findSrpViolations(free, { secrets: [key] }), []);
  const text = [m("a", { settings: [{ key, type: "text" }] }), m("b", { settings: [{ key, type: "text" }] })];
  assert.deepEqual(findSrpViolations(text), [], "seul le type secret compte");
  const three = [...free, m("c", { settings: [secret(key)] , requires: [{ service: "s.x" }] }), m("d", { offers: [{ service: "s.x" }], settings: [secret(key)] })];
  assert.deepEqual(findSrpViolations(three)[0].modules, ["a", "b", "c", "d"], "c et d sont liés entre eux, mais pas à a ni à b");
});

test("SRP : un service offert « each » par plusieurs modules est voulu (le cœur l'appelle chez chacun) ; mélangé avec une offre sans « each », il est signalé", () => {
  const each = (id) => m(id, { offers: [{ service: "privacy.subject", each: true }] });
  assert.deepEqual(findSrpViolations([each("a"), each("b"), each("c")]), []);
  const mixed = [each("a"), m("b", { offers: [{ service: "privacy.subject" }] }), m("c", { offers: [{ service: "privacy.subject" }] })];
  assert.deepEqual(findSrpViolations(mixed).map((x) => [x.key, x.modules]), [["privacy.subject", ["b", "c"]]]);
});
