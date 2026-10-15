import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Section « Assistants IA » : adresses, anciennes pages qui redirigent, résumé des droits, textes sans jargon (pure logique + structure des fichiers).
const L = await import("@/core/services/mcp/assistantsLinks");
const V = await import("@/core/services/mcp/accessView");

const read = (p) => fs.readFileSync(p, "utf8");
const PANEL = "src/app/admin/(panel)";
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

test("adresses : onglet par défaut, onglet inconnu, adresses construites au même endroit", () => {
  assert.deepEqual(L.ASSISTANT_TABS, ["access", "requests", "history"]);
  assert.equal(L.parseTab(undefined), "access");
  assert.equal(L.parseTab("n'importe quoi"), "access");
  assert.equal(L.parseTab(["history", "access"]), "history", "un paramètre répété : le premier");
  assert.equal(L.parseTab("requests"), "requests");
  assert.equal(L.assistantsTabHref("access"), "/admin/assistants");
  assert.equal(L.assistantsTabHref("requests"), "/admin/assistants?tab=requests");
  assert.equal(L.assistantsTabHref("requests", { notice: "busy" }), "/admin/assistants?tab=requests&notice=busy");
  assert.equal(L.accessHref("abc"), "/admin/assistants/abc");
  assert.equal(L.accessHref("a/b"), "/admin/assistants/a%2Fb", "un identifiant ne sort jamais du chemin");
  assert.equal(L.newAccessHref(), "/admin/assistants#new-token");
  assert.equal(L.newAccessHref(true), "/admin/assistants?profile=maintenance#new-token", "ancre et type Maintenance conservés");
});

test("anciennes adresses : /admin/mcp, /admin/mcp/<id> et /admin/maintenance-ia mènent à la bonne vue, paramètres utiles conservés", () => {
  const to = L.legacyAssistantsTarget;
  assert.equal(to("/admin/mcp"), "/admin/assistants");
  assert.equal(to("/admin/mcp/"), "/admin/assistants", "barre finale");
  assert.equal(to("/admin/mcp", { profile: "maintenance" }), "/admin/assistants?profile=maintenance");
  assert.equal(to("/admin/mcp", { profile: "autre" }), "/admin/assistants", "seul le profil connu passe");
  assert.equal(to("/admin/mcp/ck123"), "/admin/assistants/ck123");
  assert.equal(to("/admin/maintenance-ia"), "/admin/assistants?tab=requests");
  for (const notice of L.REQUEST_NOTICES) assert.equal(to("/admin/maintenance-ia", { notice }), `/admin/assistants?tab=requests&notice=${notice}`);
  assert.equal(to("/admin/maintenance-ia", { notice: "<script>" }), "/admin/assistants?tab=requests", "un avertissement inconnu est ignoré");
  assert.equal(to("/admin/maintenance-ia", { notice: ["busy", "x"] }), "/admin/assistants?tab=requests&notice=busy");
  assert.equal(to("/admin/mcp/a/b"), null);
  assert.equal(to("/admin/users"), null);
});

test("les avertissements de la vue Demandes ont tous leur texte (fr et en)", () => {
  for (const n of L.REQUEST_NOTICES) assert.ok(fr[`aim.notice.${n}`] && en[`aim.notice.${n}`], n);
});

test("anciennes pages : trois petites pages de redirection, sans route attrape-tout (le build ne doit pas y trouver de conflit)", () => {
  const pages = { mcp: `${PANEL}/mcp/page.tsx`, one: `${PANEL}/mcp/[id]/page.tsx`, maintenance: `${PANEL}/maintenance-ia/page.tsx` };
  for (const f of Object.values(pages)) { assert.match(read(f), /legacyAssistantsTarget/, f); assert.match(read(f), /redirect\(/, f); }
  for (const dir of [`${PANEL}/mcp`, `${PANEL}/maintenance-ia`]) {
    const files = walk(dir);
    assert.ok(files.every((f) => !/\[\[?\.\.\./.test(f)), `${dir} : aucun [...x] / [[...x]]`);
    assert.deepEqual(files.map((f) => f.slice(dir.length)).sort(), dir.endsWith("/mcp") ? ["/[id]/page.tsx", "/page.tsx"] : ["/page.tsx"], `${dir} ne contient que sa page de redirection`);
  }
});

test("liens internes : plus aucune adresse d'avant dans le code (hors correspondance et pages de redirection)", () => {
  const allowed = new Set(["src/core/services/mcp/assistantsLinks.ts", `${PANEL}/mcp/page.tsx`, `${PANEL}/mcp/[id]/page.tsx`, `${PANEL}/maintenance-ia/page.tsx`]);
  const offenders = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !allowed.has(f) && /\/admin\/(mcp|maintenance-ia)\b/.test(read(f)));
  assert.deepEqual(offenders, []);
  // L'API des clients déjà connectés ne bouge pas.
  assert.ok(fs.existsSync("src/app/api/mcp/route.ts") && fs.existsSync("src/app/api/mcp/[token]/route.ts"));
});

test("accès : actifs d'un côté, expirés ou révoqués de l'autre ; révoqué l'emporte sur expiré", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const rows = [
    { n: "actif", revokedAt: null },
    { n: "révoqué", revokedAt: new Date("2026-05-01") },
    { n: "expiré", revokedAt: null, expiresAt: new Date("2026-05-31") },
    { n: "futur", revokedAt: null, expiresAt: new Date("2026-07-01") },
    { n: "les deux", revokedAt: new Date("2026-05-01"), expiresAt: new Date("2026-05-02") },
  ];
  const { active, inactive } = V.splitAccesses(rows, now);
  assert.deepEqual(active.map((r) => r.n), ["actif", "futur"]);
  assert.deepEqual(inactive.map((r) => r.n), ["révoqué", "expiré", "les deux"]);
  assert.equal(V.accessState(rows[4], now), "revoked");
  assert.equal(V.accessState(rows[2], now), "expired");
  assert.equal(V.accessState({ revokedAt: null, expiresAt: now }, now), "expired", "à l'instant exact : expiré");
  assert.deepEqual(V.splitAccesses([], now), { active: [], inactive: [] });
});

test("accès : ce qu'il peut faire, en phrases courtes, d'après les actions réellement autorisées", () => {
  const site = (readOnly, destructive = false) => ({ readOnly, destructive, source: "blog" });
  const upkeep = (readOnly) => ({ readOnly, source: "maintenance" });
  assert.deepEqual(V.abilities([]), ["none"]);
  assert.deepEqual(V.abilities([site(true), site(true)]), ["read"]);
  assert.deepEqual(V.abilities([site(true), site(false)]), ["write"]);
  assert.deepEqual(V.abilities([site(false), site(false, true)]), ["write", "delete"]);
  assert.deepEqual(V.abilities([upkeep(true)]), ["maintenance.watch"], "profil Maintenance par défaut : surveiller seulement");
  assert.deepEqual(V.abilities([upkeep(true), upkeep(false)]), ["maintenance.act"]);
  assert.deepEqual(V.abilities([site(true), upkeep(true)]), ["read", "maintenance.watch"]);
  for (const a of ["none", "read", "write", "delete", "maintenance.watch", "maintenance.act"]) assert.ok(fr[`assistants.can.${a}`] && en[`assistants.can.${a}`], a);
});

test("textes : chaque clé « assistants.* » écrite dans le code existe en français et en anglais, avec les mêmes variables", () => {
  const files = [...walk(`${PANEL}/assistants`), "src/components/admin/McpTokenCreator.tsx", `${PANEL}/layout.tsx`, `${PANEL}/page.tsx`].filter((f) => /\.tsx?$/.test(f));
  const keys = new Set(["nav.assistants"]);
  for (const f of files) for (const m of read(f).matchAll(/"((?:assistants|nav\.assistants)[\w.]*)"/g)) if (fr[m[1]] !== undefined || m[1] !== "assistants") keys.add(m[1]);
  for (const a of ["none", "read", "write", "delete", "maintenance.watch", "maintenance.act"]) keys.add(`assistants.can.${a}`);
  for (const n of ["1", "2", "3"]) { keys.add(`assistants.step.${n}`); keys.add(`assistants.step.${n}d`); }
  for (const tab of L.ASSISTANT_TABS) keys.add(`assistants.tab.${tab}`);
  assert.ok(keys.size > 60, `seulement ${keys.size} clés trouvées`);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) {
    if (k === "assistants") continue;
    assert.ok(fr[k]?.trim() && en[k]?.trim(), `clé manquante : ${k}`);
    assert.equal(vars(fr[k]), vars(en[k]), k);
  }
  // Aucune clé de la section n'est restée sans emploi.
  const code = files.map(read).join("\n") + read("src/core/maintenance/notify.ts");
  const unused = Object.keys(fr).filter((k) => k.startsWith("assistants.") && !code.includes(`"${k}"`) && !/^assistants\.(can|step|tab)\./.test(k));
  assert.deepEqual(unused, []);
});

test("mode simple : aucun mot technique (MCP, jeton, token, API, endpoint, scope) dans ce que voit une personne non technique", () => {
  const jargon = /\b(MCP|jetons?|tokens?|API|endpoint|scopes?|JSON|RPC|JSON-RPC)\b/i;
  // Textes réservés au mode avancé (détail technique) : ils peuvent en parler.
  const advancedOnly = new Set(["assistants.subtitle", "mcp.confirmDestructive", "mcp.guide.claude.need", "mcp.urlOptionHelp", "mcp.url.help", "mcp.url.enableConfirm", "mcp.profile", "mcp.profile.help"]);
  const simple = Object.keys(fr).filter((k) => /^(assistants\.|aim\.|nav\.assistants$|nav\.badge\.ai$|dashboard\.ai\.|mcp\.profile\.|mcp\.url\.(title|stateOn|stateOff|enable|disable)$|mcp\.(neverUsed|lastUsed|destructive|action\.|resetDefaults|disableAll|platform|urlChip|guide\.claude\.(title|text)|guide\.(copy|copied)))/.test(k) && !advancedOnly.has(k));
  assert.ok(simple.length > 100);
  const bad = [];
  for (const k of simple) {
    // Les variables ({token} = le nom donné par la personne) ne s'affichent pas telles quelles.
    for (const [lang, dict] of [["fr", fr], ["en", en]]) { const m = jargon.exec(dict[k].replace(/\{\w+\}/g, "")); if (m) bad.push(`${lang} ${k} : « ${m[0]} »`); }
  }
  assert.deepEqual(bad, []);
  assert.equal(fr["nav.assistants"], "Assistants IA");
  assert.equal(en["nav.assistants"], "AI assistants");
  assert.equal(fr["assistants.subtitle"], "API & MCP", "en mode avancé, les personnes techniques retrouvent le nom d'avant");
});

test("page : sous-titre « API & MCP » et réglages techniques seulement en mode avancé ; onglets Accès, Demandes à valider, Historique ; secret jamais relu", () => {
  const page = read(`${PANEL}/assistants/page.tsx`);
  assert.match(page, /advanced && <span[^>]*>\{t\("assistants\.subtitle"\)\}/);
  assert.match(page, /adminCtx\("owner"\)/);
  const access = read(`${PANEL}/assistants/AccessTab.tsx`);
  assert.match(access, /\{advanced && \(\s*<Panel title=\{t\("assistants\.tech\.title"\)\}/, "adresse du serveur, guides par outil et liste des actions : avancé seulement");
  assert.ok(access.indexOf("/api/mcp</code>") > access.indexOf("{advanced && ("), "l'adresse du serveur n'est montrée qu'en avancé");
  // Les accès arrêtés sont dans une zone repliée (jamais `open`), après les actifs.
  assert.match(access, /<details className="[^"]*" data-testid="assistants-inactive">/);
  assert.ok(access.indexOf('data-testid="assistants-active"') < access.indexOf('data-testid="assistants-inactive"'));
  assert.ok(!/open/.test(access.slice(access.indexOf('data-testid="assistants-inactive"') - 80, access.indexOf('data-testid="assistants-inactive"'))));
  // Le secret n'existe que dans l'état du formulaire de création.
  assert.ok(!/(?<![.\w])created\.(token|byUrl)|\bk\.hash/.test(access), "la liste ne manipule aucun secret");
  assert.ok(!/hash/.test(access), "ni empreinte");
  assert.match(read(`${PANEL}/assistants/AssistantTabs.tsx`), /aria-current=\{here \? "page" : undefined\}/);
});

test("accès : la page d'un accès réunit droits et validation, le détail par outil est réservé au mode avancé", () => {
  const page = read(`${PANEL}/assistants/[id]/page.tsx`);
  assert.match(page, /const shown = \[\.\.\.groups\.entries\(\)\]\.filter\(\(\[source\]\) => advanced \|\| source === "maintenance"\)/);
  assert.match(page, /data-testid="maintenance-approval"/);
  assert.match(page, /ConfirmButton message=\{t\("aim\.approval\.directConfirm", \{ token: row\.name \}\)\}/, "la confirmation de l'exécution directe est conservée");
  assert.match(page, /confirmMessage=\{tool\.destructive \?/, "la confirmation d'une action irréversible est conservée");
  assert.match(page, /adminCtx\("owner"\)/);
});
