import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { forbiddenWords, toneProblems, labelProblems, HELP_INLINE_MAX } from "../../testsupport/ergonomics.mjs";

// Starting profiles (Read only / Assistant / Full setup) for an AI access: ONE definition shared by the setup step and the rights page,
// checked against the real tool catalogue, plus the logic of the rights page (counters, presets, changes), the one-time access code and the texts.
const db = await useTestDb();
const P = await import("@/core/services/mcp/profiles");
const A = await import("@/core/services/mcp/access");
const G = await import("@/core/services/mcp/grantChanges");
const V = await import("@/core/mcpAccess");
const T = await import("@/core/services/mcp/tokens");
const M = await import("../../src/components/admin/grantsModel.ts");
const { listMcpToolCatalogue } = await import("@/core/platform");
const { prisma } = await import("@/core/db");
test.after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const en = JSON.parse(read("src/locales/en.json"));
const fr = JSON.parse(read("src/locales/fr.json"));
const catalogue = await listMcpToolCatalogue();
const byName = new Map(catalogue.map((t) => [t.name, t]));

// ── The definition against the real catalogue ────────────────────────────────────────────────────────────────────────────

test("catalogue : chaque outil du cœur est dans un profil OU explicitement exclu (un nouvel outil doit être classé)", () => {
  const core = catalogue.filter((t) => !t.instanceId);
  assert.ok(core.length >= 30, "le catalogue du cœur est bien lu");
  const unassigned = core.filter((t) => P.placementOf(t) === "unassigned").map((t) => t.name);
  assert.deepEqual(unassigned, [], "classer ces outils dans src/core/services/mcp/profiles.ts (un profil, ou PROFILE_EXCLUDED avec la raison)");
});

test("catalogue : aucune entrée périmée, aucun outil dans deux profils, chaque exclusion dit pourquoi", () => {
  const listed = Object.values(P.PROFILE_TOOLS).flat();
  assert.equal(new Set(listed).size, listed.length, "un outil n'est dans qu'un profil");
  for (const name of [...listed, ...Object.keys(P.PROFILE_EXCLUDED)]) assert.ok(byName.has(name), `${name} n'existe plus dans le catalogue`);
  for (const name of Object.keys(P.PROFILE_EXCLUDED)) assert.ok(!listed.includes(name), `${name} est à la fois exclu et dans un profil`);
  for (const [name, why] of Object.entries(P.PROFILE_EXCLUDED)) assert.ok(why.length > 10, `${name} : la raison manque`);
});

test("profils : emboîtés, lecture seule = que de la lecture, jamais de suppression ni de secret, les demandes à risque seulement dans « Full setup »", () => {
  assert.deepEqual(P.ACCESS_PROFILES, ["read", "assistant", "full"]);
  assert.equal(P.DEFAULT_PROFILE, "read", "le plus sûr par défaut");
  const allowed = (p) => catalogue.filter((t) => P.profileAllows(p, t)).map((t) => t.name);
  const [r, a, f] = P.ACCESS_PROFILES.map(allowed);
  assert.ok(r.every((n) => a.includes(n)) && a.every((n) => f.includes(n)), "chaque profil contient le précédent");
  assert.ok(r.length < a.length && a.length < f.length);
  for (const n of r) assert.equal(byName.get(n).readOnly, true, `${n} : lecture seule dans « Read only »`);
  for (const n of f) assert.equal(byName.get(n).name.includes("delete") || /uninstall|core_update|remove|_advanced/.test(n), false, `${n} ne doit jamais être dans un profil`);
  for (const n of ["maintenance_module_install", "maintenance_skin_install"]) assert.ok(f.includes(n) && !a.includes(n), `${n} : seulement Full setup`);
  assert.ok(a.includes("maintenance_module_configure") && !r.includes("maintenance_module_configure"));
  assert.ok(!f.includes("maintenance_module_uninstall") && !f.includes("redirects_delete") && !f.includes("maintenance_module_configure_advanced"));
});

test("outils d'un module : lectures accordées d'office = lecture ; brouillons = Assistant ; le reste (écritures, destructif, lecture sensible) = exclu", () => {
  const tool = (name, over) => ({ name, readOnly: true, default: true, destructive: false, instanceId: "i1", ...over });
  assert.equal(P.placementOf(tool("blog__list_entries")), "read");
  assert.equal(P.placementOf(tool("blog__create_draft", { readOnly: false })), "assistant");
  assert.equal(P.placementOf(tool("blog__update_draft", { readOnly: false })), "assistant");
  assert.equal(P.placementOf(tool("polls__poll_close", { readOnly: false, default: false })), "excluded");
  assert.equal(P.placementOf(tool("contacts__contact_delete", { readOnly: false, destructive: true })), "excluded");
  assert.equal(P.placementOf(tool("contacts__contact_get_private", { default: false })), "excluded");
  assert.equal(P.placementOf({ name: "brand_new_core_tool", readOnly: true, default: true, destructive: false }), "unassigned");
});

// ── Preset on a real access ──────────────────────────────────────────────────────────────────────────────────────────────

test("préréglage : « Assistant » sur un accès en écriture donne exactement le profil ; sur un accès en lecture, l'écriture reste coupée ET est signalée", () => {
  const write = P.applyProfile("assistant", catalogue, {}, "write");
  assert.deepEqual(write.blocked, []);
  const on = (grants, scope) => catalogue.filter((t) => A.canUse(t, { scope, grants })).map((t) => t.name).sort();
  assert.deepEqual(on(write.grants, "write"), catalogue.filter((t) => P.profileAllows("assistant", t)).map((t) => t.name).sort());
  const ro = P.applyProfile("assistant", catalogue, {}, "read");
  assert.ok(ro.blocked.includes("maintenance_module_configure"), "dit pourquoi : plafond en lecture");
  assert.ok(!on(ro.grants, "read").includes("maintenance_module_configure"));
  assert.ok(on(ro.grants, "read").includes("maintenance_status"));
});

test("modifications groupées : mêmes règles qu'une modification seule (outil inconnu refusé, écriture refusée au plafond « lecture »), rien n'échoue en silence", () => {
  const r = G.applyGrantChanges({}, "read", catalogue, { maintenance_status: true, maintenance_backup_run: true, nope: true });
  assert.deepEqual(r.applied, ["maintenance_status"]);
  assert.deepEqual(r.rejected, [{ name: "maintenance_backup_run", reason: "ceiling" }, { name: "nope", reason: "unknown" }]);
  const w = G.applyGrantChanges(r.grants, "write", catalogue, { maintenance_status: false, maintenance_backup_run: true });
  assert.equal(A.isGranted(byName.get("maintenance_backup_run"), w.grants), true);
  assert.equal(A.isGranted(byName.get("maintenance_status"), w.grants), false);
  assert.deepEqual(w.rejected, []);
});

// ── The access is created once, the code is shown once ──────────────────────────────────────────────────────────────────────

test("création : « Read only » = plafond lecture ; le code n'existe que dans le résultat (seul son condensé est en base) et ne figure dans aucune ligne de journal", async () => {
  const { token, id } = await V.createProfileAccess({ name: "Aide à l'écriture", profile: "read", actorEmail: "camille@example.org", catalogue });
  assert.match(token, /^vit_[A-Za-z0-9_-]{20,}$/);
  const row = await prisma.apiToken.findUnique({ where: { id } });
  assert.equal(row.scope, "read");
  assert.ok(row.hash && row.hash !== token);
  assert.equal(JSON.stringify(row).includes(token), false, "le code n'est stocké nulle part dans la ligne");
  assert.equal((await T.authenticate(`Bearer ${token}`))?.id, id, "mais il ouvre bien l'accès");
  const auth = await T.authenticate(`Bearer ${token}`);
  assert.ok(catalogue.filter((t) => A.canUse(t, auth)).every((t) => t.readOnly));
  assert.ok(A.canUse(byName.get("maintenance_health"), auth));
  const logs = await prisma.auditLog.findMany();
  assert.ok(logs.some((l) => l.action === "mcp.token.create" && l.target.includes("profile read")));
  assert.equal(JSON.stringify(logs).includes(token), false, "jamais dans le journal");
  assert.equal(JSON.stringify(logs).includes(token.slice(4, 24)), false);
});

test("création : « Full setup » = plafond écriture, demandes d'installation accordées, désinstallation non", async () => {
  const { token } = await V.createProfileAccess({ name: "Complet", profile: "full", actorEmail: "camille@example.org", catalogue });
  const auth = await T.authenticate(`Bearer ${token}`);
  assert.equal(auth.scope, "write");
  assert.ok(A.canUse(byName.get("maintenance_module_install"), auth));
  assert.ok(A.canUse(byName.get("maintenance_skin_install"), auth));
  assert.ok(!A.canUse(byName.get("maintenance_module_uninstall"), auth));
  assert.ok(!A.canUse(byName.get("redirects_delete"), auth));
});

test("l'étape ne journalise ni n'envoie le code : pas de console.*, pas de fetch, le code ne va que dans le résultat de l'action", () => {
  const files = ["src/app/admin/(auth)/setup/assistant/actions.ts", "src/core/mcpAccess.ts", "src/app/admin/(auth)/setup/assistant/AssistantStep.tsx", "src/app/admin/(auth)/setup/assistant/page.tsx"];
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /console\.|fetch\(|localStorage|sessionStorage|document\.cookie|setTimeout/, f);
  }
  const action = read(files[0]);
  assert.doesNotMatch(action, /audit\(/, "l'action n'écrit rien elle-même dans le journal avec le code");
  assert.match(read("src/core/mcpAccess.ts"), /audit\(input\.actorEmail, "mcp\.token\.create", input\.note \? `\$\{input\.name\} \(\$\{input\.note\}\)` : input\.name\)/);
});

test("une seule logique de création : le formulaire de l'Équipe et l'étape passent par createAccess (pas de copie)", () => {
  assert.match(read("src/app/admin/(panel)/assistants/actions.ts"), /createAccess\(/);
  assert.match(read("src/core/mcpAccess.ts"), /export async function createProfileAccess[\s\S]*createAccess\(/);
  assert.equal(read("src/app/admin/(panel)/assistants/actions.ts").includes("createToken("), false);
});

// ── The step in the wizard ─────────────────────────────────────────────────────────────────────────────────────────────────

test("assistant d'installation : l'étape suit la création du compte, se saute sans rien créer, deux champs visibles, profil par défaut = lecture seule", () => {
  const setup = read("src/app/admin/(auth)/setup/actions.ts");
  assert.match(setup, /SETUP_NEXT = "\/admin\/setup\/assistant"/);
  assert.doesNotMatch(setup, /redirectTo: [^;]*"\/admin\?welcome=1/, "plus de saut direct vers le tableau de bord");
  const page = read("src/app/admin/(auth)/setup/assistant/page.tsx");
  assert.match(page, /\/admin\?welcome=1/, "« Passer » mène au tableau de bord");
  assert.match(page, /right: "core:mcp\.tokens"/);
  const step = read("src/app/admin/(auth)/setup/assistant/AssistantStep.tsx");
  assert.match(step, /useState<Profile\["id"\]>\("read"\)/, "le plus sûr d'abord");
  assert.match(step, /data-testid="setup-assistant-skip"/);
  assert.equal((step.match(/<input\b/g) ?? []).length, 2, "deux champs : le nom et le profil");
  assert.match(step, /McpConnectGuide/, "les consignes existantes sont réutilisées");
  assert.match(step, /CopyBlock/);
  for (const k of ["setup.ai.reconnect", "setup.ai.next", "setup.ai.once"]) assert.ok(en[k], k);
  assert.match(en["setup.ai.reconnect"], /reconnect/i);
  assert.match(en["setup.ai.next"], /Getting started/);
  assert.equal(read("src/app/admin/(auth)/setup/assistant/actions.ts").includes("isAccessProfile(raw) ? raw : DEFAULT_PROFILE"), true, "une valeur inconnue retombe sur lecture seule");
});

test("assistant d'installation : chaque profil dit en 3 à 5 lignes ce qu'il permet", () => {
  const L = require_texts();
  for (const p of P.ACCESS_PROFILES) { assert.ok(L[p].length >= 3 && L[p].length <= 5, p); for (const k of L[p]) assert.ok(en[k] && fr[k], k); }
});
function require_texts() {
  const src = read("src/core/services/mcp/profileTexts.ts");
  return Object.fromEntries(P.ACCESS_PROFILES.map((p) => [p, [...src.matchAll(new RegExp(`"(ai\\.profile\\.${p}\\.l\\d)"`, "g"))].map((m) => m[1])]));
}

// ── Rights page: counters, presets, changes ──────────────────────────────────────────────────────────────────────────────

const tool = (name, over = {}) => ({ name, label: name, kind: "read", kindLabel: "", initial: false, blocked: false, locked: false, rank: "read", ...over });
const sections = () => [
  { id: "a", group: "", title: "A", tools: [tool("r1", { initial: true }), tool("r2"), tool("r3", { rank: "assistant", kind: "write" }), tool("r4", { rank: null }), tool("w1", { rank: "assistant", blocked: true })] },
  { id: "b", group: "", title: "B", risky: true, tools: [tool("x1", { rank: "full", kind: "destructive" }), tool("x2", { rank: null, kind: "destructive" })] },
];

test("page des droits : « tout cocher / tout décocher » et compteurs (9 sur 11), sans toucher aux cases verrouillées ou coupées par le plafond", () => {
  const s = sections();
  let d = M.initialDraft(s);
  assert.equal(M.countOn(s[0], d), 1);
  d = M.setSection(s[0], d, true);
  assert.equal(M.countOn(s[0], d), 4, "4 sur 5 : la 5e demande l'écriture et reste coupée");
  assert.equal(d.w1, false);
  d = M.setSection(s[0], d, false);
  assert.equal(M.countOn(s[0], d), 0);
  s[1].tools[0].locked = true;
  assert.equal(M.countOn(s[1], M.setSection(s[1], M.initialDraft(s), true)), 1, "la case verrouillée ne bouge pas");
});

test("page des droits : les trois profils préréglent la page, l'écriture au-delà du plafond est comptée, le profil courant est reconnu", () => {
  const s = sections();
  const r = M.presetDraft("read", s, M.initialDraft(s));
  assert.deepEqual([r.draft.r1, r.draft.r2, r.draft.r3, r.draft.r4, r.draft.x1], [true, true, false, false, false]);
  assert.equal(M.matchingProfileOf(s, r.draft), "read");
  const a = M.presetDraft("assistant", s, r.draft);
  assert.equal(a.draft.r3, true);
  assert.equal(a.blocked, 1, "w1 demande l'écriture : signalé, jamais en silence");
  assert.equal(a.draft.w1, false);
  assert.equal(M.matchingProfileOf(s, a.draft), "assistant");
  const f = M.presetDraft("full", s, a.draft);
  assert.equal(f.draft.x1, true);
  assert.equal(f.draft.x2, false, "ce qu'aucun profil n'autorise reste coupé");
  assert.equal(M.matchingProfileOf(s, f.draft), "full");
  assert.equal(M.matchingProfileOf(s, { ...f.draft, r4: true }), null, "une case réglée à la main : plus aucun profil");
});

test("page des droits : le résumé ne liste que ce qui diffère de l'état enregistré", () => {
  const s = sections();
  const saved = M.initialDraft(s);
  assert.deepEqual(M.changesOf(s, saved, saved), {});
  const d = M.presetDraft("full", s, saved).draft;
  assert.deepEqual(M.changesOf(s, d, saved), { r2: true, r3: true, x1: true });
  assert.deepEqual(M.changesOf(s, saved, d), { r2: false, r3: false, x1: false }, "revenir en arrière = retirer");
});

test("page des droits : composant — aria-live sur les compteurs, confirmation de la section à risque, résumé avant enregistrement, annuler, cibles de 44 px, rappel de reconnexion", () => {
  const c = read("src/components/admin/GrantsEditor.tsx");
  assert.match(c, /aria-live="polite" aria-atomic="true" data-testid=\{`grants-count-/);
  assert.match(c, /if \(s\.risky\) \{ setRiskySection\(s\); risky\.current\?\.showModal\(\); return; \}/, "tout cocher à risque : confirmation d'abord");
  assert.match(c, /data-action="risky-confirm"/);
  assert.match(c, /showModal\(\)/);
  assert.match(c, /data-action="cancel-changes"/);
  assert.match(c, /summary\.current\?\.showModal\(\)/);
  assert.match(c, /await save\(sent\)/);
  assert.match(c, /labels\.savedReconnect/);
  assert.match(c, /min-h-11/);
  assert.doesNotMatch(c, /setTimeout|setInterval/, "aucun minuteur");
  assert.match(c, /role="switch"/);
  assert.match(c, /grants-problem/, "un refus est dit, jamais en silence");
  assert.match(en["grants.saved.reconnect"], /^Reconnect the assistant to see new tools\./);
  assert.match(en["grants.risky.approval.human"], /Installing a feature always stays a request that you approve/);
  assert.match(en["grants.risky.approval.direct"], /Installing a feature always stays a request/);
});

test("page des droits : le plafond « lecture » est expliqué, la page n'applique rien sans enregistrer, la logique de plafond du serveur est celle d'avant", () => {
  const page = read("src/app/admin/(panel)/assistants/[id]/page.tsx");
  assert.match(page, /grants\.ceiling\.why/);
  assert.match(page, /blocked: ceilingBlocks/);
  assert.match(page, /applyGrantsAction\.bind\(null, id\)/);
  assert.match(read("src/app/admin/(panel)/assistants/actions.ts"), /withinCeiling\(tool, token\.scope\)/, "setGrantAction inchangée");
  assert.match(read("src/app/admin/(panel)/assistants/actions.ts"), /applyGrantChanges\(token\.grants, token\.scope/);
});

test("approbation des actions à risque : deux choix côte à côte, l'état courant toujours sélectionné et annoncé, l'installation demande TOUJOURS l'accord", () => {
  const c = read("src/components/admin/ApprovalChoice.tsx");
  assert.match(c, /role="radiogroup"/);
  assert.match(c, /role="radio" aria-checked=\{on\}/);
  assert.match(c, /tabIndex=\{on \? 0 : -1\}/);
  assert.match(c, /ArrowRight/);
  assert.match(c, /min-h-11/);
  assert.match(c, /labels\.installNote/);
  const page = read("src/app/admin/(panel)/assistants/[id]/page.tsx");
  assert.match(page, /<ApprovalChoice current=\{approval\}/);
  assert.doesNotMatch(page, /aim\.approval\.direct"\)\}<\/ConfirmButton>|aim\.approval\.human"\)\}<\/PendingButton>/, "plus de bouton-verbe");
  assert.match(read("src/app/admin/(panel)/assistants/requestsActions.ts"), /setApprovalMode\(row\.id, next\)/, "même réglage, même valeur stockée");
  assert.match(en["aim.approval.installNote"], /Installing a feature always asks for your approval, whatever you choose\./);
  assert.match(en["aim.approval.ask"], /recommended/);
});

// ── Texts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const NEW = Object.keys(en).filter((k) => /^(setup\.ai\.|ai\.profile\.|grants\.|aim\.approval\.(group|ask|act|askHelp|actHelp|installNote|saved)$|audit\.action\.mcp\.grants\.apply$)/.test(k));
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("textes : FR et EN à parité exacte (mêmes clés, mêmes {variables}), aucun texte identique par oubli de traduction", () => {
  assert.ok(NEW.length > 80);
  for (const k of NEW) {
    assert.ok(typeof fr[k] === "string" && fr[k].length, `fr manque : ${k}`);
    assert.equal(vars(fr[k]), vars(en[k]), k);
  }
  for (const k of NEW.filter((k) => en[k].length > 30)) assert.notEqual(fr[k], en[k], `${k} : texte français identique à l'anglais`);
});

test("sentinelle de langue : aucun mot français dans les textes anglais de l'étape et de la page des droits", () => {
  const FRENCH = /\b(?:vous|votre|vos|une?|des|les|cette|pour|avec|dans|sans|est|sont|peut|ou|et|accès|créer|passer|étape|réglages)\b|[àâçéèêëîïôûùœ]/i;
  const ok = new Set(["grants.profile.help"]);
  for (const k of NEW) {
    if (ok.has(k)) continue;
    const text = en[k].replace(/“[^”]*”/g, "");
    assert.doesNotMatch(text, FRENCH, `${k} : « ${en[k]} » ressemble à du français`);
  }
});

test("textes : mots de la personne (R9), libellés courts sans deux-points (R10), aides courtes (R11), ton (R13), en FR et en EN", () => {
  const SHORT = NEW.filter((k) => /\.(name|profile|optional|create|skip|address|code|selectAll|clearAll|close|ask|act|group|read|assistant|full|review|cancel|save|back|confirm|risky|dashboard|manage|title)$|^grants\.(bar|summary)\./.test(k) && en[k].length < 70);
  for (const [lang, d] of [["en", en], ["fr", fr]]) {
    for (const k of NEW) {
      // The name of the dashboard list is quoted as it is shown there (« Mise en route »): a title, not a word of ours.
      const bad = forbiddenWords(d[k].replace(/«[^»]*Mise en route[^»]*»/g, " "), "core").filter((w) => !["code"].includes(w));
      assert.deepEqual(bad, [], `${lang} ${k} : mot interdit`);
      assert.deepEqual(toneProblems(d[k], lang), [], `${lang} ${k} : ton`);
    }
    for (const k of SHORT) assert.deepEqual(labelProblems(d[k]), [], `${lang} ${k} : libellé`);
    for (const k of ["setup.ai.nameExample", "setup.ai.error.name"]) assert.ok(d[k].length <= 70);
    assert.ok(d["setup.ai.nameExample"].length <= HELP_INLINE_MAX);
  }
});
