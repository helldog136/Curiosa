import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { describeProgress, failureKey, hasRemaining } = await import("@/core/updates/progress");
const { AUDIT_ACTIONS, auditLabelKey } = await import("@/core/auditLabels");

const read = (p) => fs.readFileSync(p, "utf8");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const PANEL = "src/app/admin/(panel)";

test("mises à jour : la progression suit l'étape de la chaîne et l'étape technique", () => {
  const one = describeProgress({ status: "running", step: "download" });
  assert.deepEqual([one.index, one.total, one.chain.length], [1, 1, 0], "une seule version : pas de liste d'étapes");
  assert.equal(one.stepKey, "updates.step.download");
  const chain = { index: 2, total: 3, steps: ["v1.1.0", "v1.2.0", "v1.3.0"] };
  const mid = describeProgress({ status: "running", step: "swap", chain });
  assert.deepEqual(mid.chain.map((c) => c.status), ["done", "current", "waiting"]);
  assert.equal(mid.percent, Math.round(((1 + 0.8) / 3) * 100));
  const start = describeProgress({ status: "running", step: "starting", chain: { ...chain, index: 1 } });
  const end = describeProgress({ status: "running", step: "between", chain: { ...chain, index: 3 } });
  assert.ok(start.percent < mid.percent && mid.percent < end.percent && end.percent <= 100, "la barre ne recule jamais d'une version à l'autre");
});

test("mises à jour : étape inconnue ou chaîne incohérente ne cassent pas la page", () => {
  const odd = describeProgress({ status: "running", step: "inconnue", chain: { index: 9, total: 2, steps: ["v1.0.1"] } });
  assert.equal(odd.stepKey, null);
  assert.equal(odd.index, 2, "l'index est borné au total");
  assert.ok(odd.percent >= 0 && odd.percent <= 100);
  assert.deepEqual(describeProgress({ status: "running" }).chain, []);
});

test("mises à jour : chaque étape et chaque raison d'échec a son texte en français et en anglais", () => {
  for (const step of ["starting", "backup", "download", "verify", "swap", "between", "done", "rollback", "plan"]) {
    assert.ok(fr[`updates.step.${step}`] && en[`updates.step.${step}`], step);
    assert.equal(describeProgress({ status: "running", step }).stepKey, `updates.step.${step}`);
  }
  for (const e of ["checksum-mismatch", "bad-archive", "plan-failed", "step-failed:swap", "n'importe quoi", null]) {
    const { key } = failureKey(e);
    assert.ok(fr[key] && en[key], `${e} → ${key}`);
  }
  assert.equal(failureKey("step-failed:verify").step, "verify");
  assert.equal(failureKey("checksum-mismatch").step, null);
});

test("mises à jour : « il en reste » seulement après un succès partiel", () => {
  assert.equal(hasRemaining({ status: "success", remaining: ["v1.2.0"] }), true);
  assert.equal(hasRemaining({ status: "success", remaining: [] }), false);
  assert.equal(hasRemaining({ status: "failed", remaining: ["v1.2.0"] }), false);
});

test("journal d'audit : chaque action connue se lit en langage courant, les autres retombent sur le code", () => {
  for (const a of AUDIT_ACTIONS) {
    const key = auditLabelKey(a);
    assert.equal(key, `audit.action.${a}`);
    assert.ok(fr[key]?.trim() && en[key]?.trim(), `${key} manque dans une langue`);
  }
  assert.equal(auditLabelKey("module.blog.send"), "audit.action.module.custom", "action d'une instance de module");
  assert.equal(auditLabelKey("mcp.some_tool"), "audit.action.mcp.tool");
  assert.equal(auditLabelKey("quelque.chose.d.inconnu"), null);
});

test("journal d'audit : toute action écrite par le code est dans la liste (sinon elle s'afficherait en code brut)", () => {
  const files = ["users/actions.ts", "modules/actions.ts", "updates/actions.ts", "mcp/actions.ts", "entries/actions.ts", "redirects/actions.ts", "settings/actions.ts", "navigation/actions.ts", "home/actions.ts", "account/actions.ts"];
  const known = new Set(AUDIT_ACTIONS);
  for (const f of files) {
    const path = `${PANEL}/${f}`;
    if (!fs.existsSync(path)) continue;
    for (const m of read(path).matchAll(/audit\([^,]+,\s*"([a-zA-Z0-9_.]+)"/g)) assert.ok(known.has(m[1]), `${f} : « ${m[1]} » n'a pas de libellé (src/core/auditLabels.ts)`);
  }
});

test("pages d'admin : chaque clé de traduction écrite en dur dans ces pages existe en français et en anglais", () => {
  const files = ["page.tsx", "users/page.tsx", "backup/page.tsx", "updates/page.tsx", "account/page.tsx", "audit/page.tsx", "mcp/page.tsx", "mcp/[id]/page.tsx", "mode/page.tsx", "modules/page.tsx", "modules/[id]/page.tsx"];
  for (const f of files) {
    for (const m of read(`${PANEL}/${f}`).matchAll(/\bt\("([a-zA-Z0-9_.-]+)"/g)) {
      assert.ok(m[1] in fr, `${f} : « ${m[1]} » manque en français`);
      assert.ok(m[1] in en, `${f} : « ${m[1]} » manque en anglais`);
    }
  }
});

test("mon compte : connexion (mot de passe), puis sécurité renforcée (double vérification, clés d'accès), puis appareils connectés", () => {
  const page = read(`${PANEL}/account/page.tsx`);
  const at = (s) => page.indexOf(s);
  const order = [at('testid="profile-card"'), at('testid="password-card"'), at("<TwoFactorPanel"), at("<PasskeysPanel"), at('testid="sessions-card"')];
  assert.ok(order.every((i) => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `ordre inattendu : ${order}`);
  assert.ok(page.includes("<DangerZone") && /DangerZone[^]*signOutEverywhere/.test(page), "« déconnecter tous mes appareils » est dans la zone danger");
});

test("utilisateurs : suppression et coupure de sessions sont à part (zone danger repliée) et confirmées avec le nom de la personne", () => {
  const page = read(`${PANEL}/users/page.tsx`);
  assert.match(page, /<DangerZone[^]*deleteUser[^]*<\/DangerZone>/);
  assert.match(page, /users\.deleteConfirm", \{ name: u\.name \}/);
  assert.ok(!/confirm\.delete/.test(page), "pas de message générique « cet élément »");
  assert.ok(page.indexOf("setRequireTwoFactor") > page.indexOf("createUser"), "la sécurité de l'équipe vient après l'ajout d'une personne");
});

test("mises à jour : un parcours (ma version, la nouvelle, ce que ça change, un seul gros bouton) et une étape « en cours » qui suit la chaîne", () => {
  const page = read(`${PANEL}/updates/page.tsx`);
  const at = (s) => page.indexOf(s);
  const order = [at('t("updates.yourVersion")'), at('t("updates.newVersion")'), at('t("updates.whatChanges")'), at('t("updates.whatHappens")'), at("<UpdateButton running={false}")];
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `ordre inattendu : ${order}`);
  assert.match(page, /describeProgress\(state\)/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /action=\{checkNow\}[^>]*\bsecondary\b/, "« Vérifier maintenant » est une action discrète");
  assert.equal([...page.matchAll(/<UpdateButton running=\{false\}/g)].length, 1, "un seul bouton d'installation (l'autre n'apparaît que pendant la mise à jour)");
  assert.ok(/advanced && state\.error/.test(page), "le code d'erreur technique n'est montré qu'en mode avancé");
});

test("sauvegarde : le détail technique (openssl) est réservé au mode avancé, la restauration est présentée comme dangereuse", () => {
  const page = read(`${PANEL}/backup/page.tsx`);
  assert.match(page, /advanced && \(\s*<details[^]*openssl/);
  assert.match(page, /<Panel title=\{t\("backup\.restoreTitle"\)\}[^>]*tone="danger"/);
});

test("API & MCP : ordre en étapes, désactivation et révocation confirmées, états vides qui expliquent", () => {
  const page = read(`${PANEL}/mcp/page.tsx`);
  assert.ok(page.indexOf("mcp.step1") < page.indexOf("mcp.step2") && page.indexOf("mcp.step2") < page.indexOf("mcp.newToken"));
  assert.match(page, /ConfirmButton message=\{t\("mcp\.disableConfirm"\)\}/);
  assert.match(page, /ConfirmButton message=\{t\("mcp\.revokeConfirm", \{ name: k\.name \}\)\}/);
  assert.match(page, /<EmptyState/);
});

test("modules installés : état vide qui mène au catalogue, désinstallation dans la zone danger", () => {
  const page = read(`${PANEL}/modules/page.tsx`);
  assert.match(page, /mods\.length === 0 && \(\s*<EmptyState[^]*\/admin\/catalogue/);
  const one = read(`${PANEL}/modules/[id]/page.tsx`);
  assert.match(one, /<DangerZone[^]*uninstallModuleAction[^]*<\/DangerZone>/);
});

test("mode simple / avancé : une page explique la différence et ne change que le choix de la personne connectée", () => {
  const page = read(`${PANEL}/mode/page.tsx`);
  assert.match(page, /setAdminMode\.bind\(null, isAdvanced\)/);
  assert.ok(fs.existsSync(`${PANEL}/mode/actions.ts`));
  assert.match(read(`${PANEL}/layout.tsx`), /href="\/admin\/mode"/, "le libellé du mode dans le menu mène à cette page");
});

test("tableau de bord : « à traiter » passe avant le reste ; les chiffres du mode avancé ont un titre", () => {
  const page = read(`${PANEL}/page.tsx`);
  assert.ok(page.indexOf('data-testid="todo"') < page.indexOf('t("dashboard.start")'));
  assert.ok(page.indexOf('t("dashboard.inNumbers")') > 0);
});
