// Qui exécute une adminAction : la forme { right, run } laisse un rôle personnalisé agir avec le droit du module, la forme fonction reste réservée aux administrateurs.
import test from "node:test";
import assert from "node:assert/strict";

const { decideAdminAction } = await import("@/core/modules/adminActionAccess");

const user = (level, rights) => ({ id: "u", email: "u@example.test", name: "U", level, roles: [level], rights: new Set(rights), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });
const run = async () => ({ ok: "ok" });
const actions = { simple: run, edit: { right: "phone.edit", run }, other: { right: "autre:phone.edit", run }, broken: { right: "phone.edit" } };

test("{ right, run } : un rôle personnalisé avec le droit (et l'ouverture du module) exécute ; sans le droit, refus ; la fonction nue reste pour les administrateurs", () => {
  const custom = user("none", ["monsite:open", "monsite:phone.edit"]);
  assert.deepEqual(decideAdminAction(custom, "monsite", actions, "edit"), { handler: run });
  assert.deepEqual(decideAdminAction(user("none", ["monsite:open"]), "monsite", actions, "edit"), { denied: "monsite:phone.edit" });
  assert.deepEqual(decideAdminAction(user("none", ["monsite:phone.edit"]), "monsite", actions, "edit"), { denied: "monsite:phone.edit" }, "sans l'ouverture du module");
  assert.ok("denied" in decideAdminAction(custom, "monsite", actions, "simple"), "fonction nue : pas pour un rôle personnalisé");
  assert.ok("handler" in decideAdminAction(user("admin", ["monsite:open"]), "monsite", actions, "simple"));
});

test("{ right, run } : le droit d'un autre module, ou l'absence de run, est toujours refusé ; action inconnue = null", () => {
  const rich = user("owner", ["monsite:open", "monsite:phone.edit", "autre:phone.edit"]);
  assert.ok("denied" in decideAdminAction(rich, "monsite", actions, "other"));
  assert.ok("denied" in decideAdminAction(rich, "monsite", actions, "broken"));
  assert.equal(decideAdminAction(rich, "monsite", actions, "nope"), null);
  assert.equal(decideAdminAction(rich, "monsite", actions, "constructor"), null);
});
