// Les assistants IA font partie de l'équipe : UN tableau pour les personnes et les assistants (R30), filtres, recherche, droits résumés, ajout et retrait,
// et surtout RIEN de plus que ce que chaque rôle voyait déjà (la présentation est unifiée, pas le modèle ni les droits).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const V = await import("@/core/services/mcp/teamView");
const L = await import("@/core/services/mcp/assistantsLinks");
const { createToken } = await import("@/core/services/mcp/tokens");
const { syncSystemAssignments } = await import("@/core/auth/roles");
const { RedirectError } = await import("next/navigation");
const { default: UsersPage } = await import("../../src/app/admin/(panel)/users/page.tsx");

after(() => db.close());
const read = (f) => fs.readFileSync(f, "utf8");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const PANEL = "src/app/admin/(panel)";

let T;
beforeEach(async () => {
  await db.reset();
  const mk = (name, role, extra = {}) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x", locale: "fr", ...extra } });
  T = { owner: await mk("olive", "owner"), coord: await mk("carl", "admin", { coordinator: true }), admin: await mk("adam", "admin"), editor: await mk("emma", "editor") };
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: "owner" } } : null; };
async function page(u, sp = {}) {
  as(u);
  try { return renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve(sp) })); } catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}

test("droits résumés sans jargon, du plus fort au plus faible ; l'état normal ne s'écrit pas", () => {
  assert.deepEqual(V.summarizeRights([]), { level: "none", canDelete: false });
  assert.equal(V.summarizeRights(["none"]).level, "none");
  assert.equal(V.summarizeRights(["read"]).level, "read");
  assert.equal(V.summarizeRights(["write"]).level, "write");
  assert.deepEqual(V.summarizeRights(["write", "delete"]), { level: "write", canDelete: true });
  assert.equal(V.summarizeRights(["read", "maintenance.watch"]).level, "read");
  assert.equal(V.summarizeRights(["maintenance.watch"]).level, "upkeep.watch");
  assert.equal(V.summarizeRights(["read", "maintenance.act"]).level, "upkeep.act");
  const used = new Date("2026-01-01");
  assert.deepEqual(V.assistantFlags({ enabled: true, pending: 0, lastActivity: used }), [], "actif et déjà utilisé : aucune étiquette (R14)");
  assert.deepEqual(V.assistantFlags({ enabled: false, pending: 2, lastActivity: null }), ["paused", "waiting", "neverUsed"]);
});

test("dernière activité : la plus récente entre l'usage de l'accès et le Journal central ; historique filtré sur l'origine assistant et son nom", () => {
  const a = new Date("2026-01-01"), b = new Date("2026-02-01");
  assert.equal(V.lastActivity(a, b), b);
  assert.equal(V.lastActivity(b, a), b);
  assert.equal(V.lastActivity(null, a), a);
  assert.equal(V.lastActivity(undefined, null), null);
  assert.equal(V.assistantHistoryHref("Claude & Co"), "/admin/audit?kind=assistant&q=Claude+%26+Co");
  assert.equal(V.memberFilter("person", "editor"), "person editor");
  assert.equal(V.memberFilter("assistant"), "assistant");
  assert.equal(L.newAccessHref(), "/admin/users#add-assistant");
  assert.equal(L.legacyAssistantsTarget("/admin/mcp", { profile: "maintenance" }), "/admin/users?assistant=maintenance#add-assistant");
});

test("un seul tableau : personnes et assistants, colonne Type écrite, filtres Personnes / Assistants IA / rôles, droits et boutons de la ligne", async () => {
  await createToken("Claude", "read", T.owner.email);
  await createToken("Rédacteur IA", "write", T.owner.email);
  const html = await page(T.owner);
  assert.equal((html.match(/data-testid="assistant-row"/g) ?? []).length, 2);
  assert.equal((html.match(/data-testid="user-row"/g) ?? []).length, 4);
  const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
  assert.ok(table.includes('data-testid="assistant-row"') && table.includes('data-testid="user-row"'), "personnes et assistants dans le MÊME tableau (R30)");
  assert.match(html, /data-live-who="assistant"/);
  assert.match(html, /data-live-who="person owner"/);
  assert.match(html, />Assistant IA<\/span>/, "pastille écrite");
  assert.match(html, />Personne<\/span>/);
  assert.match(html, /Lecture seule/);
  assert.match(html, /Lecture et écriture/);
  assert.match(html, /Droits et outils →/);
  assert.match(html, /href="\/admin\/assistants\/[a-z0-9]+"/, "bouton vers la fiche existante");
  assert.match(html, /Jamais utilisé/);
  for (const label of ["Toutes", "Personnes", "Assistants IA"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /Ajouter un assistant IA/);
  assert.match(html, /Ajouter une personne/);
  assert.match(html, /Retirer l&#x27;accès|Retirer l'accès/, "retrait dans le menu ⋯");
  assert.equal((html.match(/data-testid="row-menu"/g) ?? []).length >= 2, true);
});

test("jamais de secret dans la page : ni empreinte, ni préfixe, ni adresse de connexion", async () => {
  const secret = await createToken("Claude", "read", T.owner.email, { byUrl: true });
  const row = await prisma.apiToken.findFirst();
  const html = await page(T.owner);
  assert.ok(!html.includes(secret) && !html.includes(row.hash) && !html.includes(row.prefix), "aucun secret dans le HTML");
  assert.ok(!html.includes("/api/mcp/"), "aucune adresse de connexion");
});

test("sans assistant : l'état vide dit quoi faire ; le tableau reste celui des personnes", async () => {
  const html = await page(T.owner);
  assert.match(html, /Aucun assistant IA pour l&#x27;instant|Aucun assistant IA pour l'instant/);
  assert.doesNotMatch(html, /data-testid="member-type"/, "pas de colonne Type tant qu'il n'y a que des personnes");
  assert.match(html, /data-live-role="owner"/, "les filtres par rôle d'avant");
});

test("mêmes droits d'accès qu'avant : seuls les titulaires de core:mcp.tokens voient les assistants (propriétaire, coordination technique), jamais l'administration", async () => {
  await createToken("Secret IA", "write", T.owner.email);
  for (const [who, sees] of [["owner", true], ["coord", true], ["admin", false]]) {
    const html = await page(T[who]);
    assert.ok(!html.startsWith("redirect:"), `${who} : ${html.slice(0, 80)}`);
    assert.equal(html.includes("Secret IA"), sees, who);
    assert.equal(html.includes("assistant-row"), sees, who);
    assert.equal(html.includes("invite-assistant"), sees, who);
  }
  const editor = await page(T.editor);
  assert.match(editor, /^redirect:/, "une personne en rédaction n'ouvre toujours pas l'Équipe");
});

test("accès retirés : repliés sous le tableau, jamais comptés comme membres ; le retrait demande confirmation et dit ce qui sera perdu", async () => {
  await createToken("Ancien", "read", T.owner.email);
  const row = await prisma.apiToken.findFirst();
  await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await createToken("Actif", "read", T.owner.email);
  const html = await page(T.owner);
  assert.equal((html.match(/data-testid="assistant-row"/g) ?? []).length, 1);
  assert.match(html, /data-testid="assistants-inactive"/);
  assert.doesNotMatch(html.slice(html.indexOf("assistants-inactive") - 40, html.indexOf("assistants-inactive")), /open/);
  const members = read(`${PANEL}/users/assistantMembers.tsx`);
  assert.match(members, /<ConfirmButton menu message=\{t\("assistants\.revokeConfirm"/);
  assert.match(fr["assistants.revokeConfirm"], /ne pourra plus rien faire[^]*définitif/);
});

test("le modèle n'est pas mélangé : une action d'assistant ne passe que par les actions d'assistant (droit core:mcp.tokens revérifié), aucune écriture sur les personnes", () => {
  const members = read(`${PANEL}/users/assistantMembers.tsx`);
  assert.ok(!/prisma\.user|passwordHash|totp|passkey/.test(members), "aucune donnée de personne dans la partie assistants");
  assert.ok(!/\.(update|create|delete|upsert)\(/.test(members), "la partie assistants de la page ne fait que lire");
  const actions = read(`${PANEL}/assistants/actions.ts`);
  for (const fn of ["createTokenAction", "revokeTokenAction", "setGrantAction", "resetGrantsAction", "setUrlAccessAction", "setMcpEnabled"]) {
    const body = actions.slice(actions.indexOf(`function ${fn}`));
    assert.match(body.slice(0, 260), /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/, fn);
  }
  assert.match(read(`${PANEL}/assistants/[id]/page.tsx`), /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
});

test("vocabulaire et parité : « assistant IA » partout, jamais bot ni client OAuth ; FR et EN ont les mêmes clés team.*", () => {
  const keys = (d) => Object.keys(d).filter((k) => k.startsWith("team.")).sort();
  assert.deepEqual(keys(fr), keys(en));
  assert.ok(keys(fr).length > 25);
  for (const k of keys(fr)) {
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    assert.equal(vars(fr[k]), vars(en[k]), k);
    assert.doesNotMatch(`${fr[k]} ${en[k]}`, /\b(bot|OAuth|jeton|token|webhook|API)\b/i, k);
  }
});
