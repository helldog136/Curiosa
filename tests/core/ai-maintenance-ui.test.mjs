import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { CREDIT_URL, BUG_REPORT_URL, bugReportUrl } = await import("@/core/credit");
const { adminBugReportUrl } = await import("@/core/bugReport");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { setSetting } = await import("@/core/settings");
const { AUDIT_ACTIONS, auditLabelKey } = await import("@/core/auditLabels");
const { MAINTENANCE_TOOLS } = await import("@/core/maintenance/tools");
test.after(() => db.close());

const read = (p) => fs.readFileSync(p, "utf8");
const fr = JSON.parse(read("src/locales/fr.json"));
const en = JSON.parse(read("src/locales/en.json"));
const PANEL = "src/app/admin/(panel)";
const UI_FILES = [`${PANEL}/assistants/page.tsx`, `${PANEL}/assistants/AccessTab.tsx`, `${PANEL}/assistants/RequestsTab.tsx`, `${PANEL}/assistants/HistoryTab.tsx`, `${PANEL}/assistants/AssistantTabs.tsx`, `${PANEL}/assistants/requestsActions.ts`, `${PANEL}/assistants/requestsShared.ts`, `${PANEL}/layout.tsx`, `${PANEL}/page.tsx`, `${PANEL}/assistants/actions.ts`, `${PANEL}/assistants/[id]/page.tsx`, `${PANEL}/updates/page.tsx`, "src/core/maintenance/notify.ts"];

// ── Lien « Signaler un bug » ────────────────────────────────────────────────────────────────────────────────────────────────

const labels = { title: "Bug : ", intro: "Décrivez.", did: "Ce que j'ai fait", expected: "Ce que j'attendais", happened: "Ce qui s'est passé", environment: "Infos", version: "Version", node: "Node", system: "Système", channel: "Canal" };

test("signalement : l'adresse vient de UNE constante, dérivée de celle du crédit ; elle porte version, Node, système et canal", () => {
  assert.equal(BUG_REPORT_URL, `${CREDIT_URL}/issues/new`);
  const credit = read("src/core/credit.ts");
  assert.match(credit, /export const BUG_REPORT_URL = `\$\{CREDIT_URL\}\/issues\/new`/);
  const url = new URL(bugReportUrl({ version: "0.1.14", node: "v22.1.0", system: "linux-x64", channel: "stable" }, labels));
  assert.equal(`${url.origin}${url.pathname}`, BUG_REPORT_URL);
  assert.equal(url.searchParams.get("title"), "Bug : ");
  const body = url.searchParams.get("body");
  for (const wanted of ["0.1.14", "v22.1.0", "linux-x64", "stable", "Ce que j'ai fait", "Ce que j'attendais", "Ce qui s'est passé"]) assert.ok(body.includes(wanted), wanted);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["body", "title"], "rien d'autre dans l'adresse");
});

test("signalement : l'adresse n'est écrite nulle part ailleurs que dans credit.ts", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const holders = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /issues\/new/.test(read(f)));
  assert.deepEqual(holders, ["src/core/credit.ts"]);
});

test("signalement : AUCUNE donnée du site dans l'adresse (ni nom, ni adresse, ni e-mail, ni réglage), même si le site en a plein", async () => {
  await setSetting("site.name", "Mon Super Site Secret");
  await setSetting("site.contactEmail", "emma@example.org");
  await setSetting("mail.pass", "hunter2");
  process.env.SITE_URL = "https://mon-site-prive.example.org";
  await db.prisma.user.create({ data: { email: "emma@example.org", name: "Emma Dupont", passwordHash: "x", role: "owner" } });
  for (const locale of ["fr", "en"]) {
    const href = await adminBugReportUrl(makeTranslator(locale));
    const all = decodeURIComponent(href.replace(/\+/g, " "));
    for (const leak of ["Super Site", "emma", "Emma", "Dupont", "hunter2", "mon-site-prive", "example.org", "vit_", "/home", db.dir]) assert.ok(!all.includes(leak), `${locale} : fuite « ${leak} »`);
    const url = new URL(href);
    assert.match(url.searchParams.get("body"), /0\.\d+\.\d+/);
    assert.ok(url.searchParams.get("body").includes(process.version));
    assert.ok(url.searchParams.get("body").includes(`${process.platform}-${process.arch}`));
  }
  assert.match(new URL(await adminBugReportUrl(makeTranslator("fr"))).searchParams.get("body"), /Ce que j'ai fait/);
  assert.match(new URL(await adminBugReportUrl(makeTranslator("en"))).searchParams.get("body"), /What I did/);
});

test("signalement : un environnement bizarre est nettoyé (pas d'adresse ni de saut de ligne glissés dans les valeurs)", () => {
  const body = new URL(bugReportUrl({ version: "1.0.0\n- Site : https://x.example/", node: "v1", system: "a b", channel: "rc" }, labels)).searchParams.get("body");
  assert.ok(!body.includes("https://") && !body.includes("x.example/") && body.split("\n").filter((l) => l.startsWith("- Version")).length === 1);
});

test("signalement : le lien est dans le menu d'admin (les deux modes), la page d'erreur, la page des mises à jour et celle de la maintenance par IA, avec target et rel", () => {
  const link = read("src/components/admin/BugReportLink.tsx");
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  const layout = read(`${PANEL}/layout.tsx`);
  assert.match(layout, /<BugReportLink href=\{bugUrl\}>/);
  assert.match(layout, /adminBugReportUrl\(t\)/);
  // Hors des blocs `advanced && …` : visible en mode simple ET avancé.
  const line = layout.split("\n").find((l) => l.includes("<BugReportLink"));
  assert.ok(!/advanced/.test(line));
  for (const f of [`${PANEL}/updates/page.tsx`, `${PANEL}/assistants/page.tsx`]) assert.match(read(f), /<BugReportLink href=\{bugUrl\}/, f);
  const error = read(`${PANEL}/error.tsx`);
  assert.match(error, /^"use client"/);
  assert.match(error, /href="\/admin\/bug-report" target="_blank" rel="noopener noreferrer"/);
  const route = read("src/app/admin/bug-report/route.ts");
  assert.match(route, /adminBugReportUrl/);
  assert.match(route, /currentUser\(\)/);
  assert.match(route, /\/admin\/login/);
  assert.ok(fr["bugReport.link"] === "Signaler un bug" && en["bugReport.link"] === "Report a bug");
});

// ── Maintenance par IA : branchement dans l'admin ──────────────────────────────────────────────────────────────────────────

test("admin : la page et ses actions sont réservées au propriétaire ; menu, tableau de bord et jeton « Maintenance » sont branchés", () => {
  assert.match(read(`${PANEL}/assistants/page.tsx`), /adminCtx\("owner"\)/);
  assert.match(read(`${PANEL}/assistants/[id]/page.tsx`), /adminCtx\("owner"\)/);
  const actions = read(`${PANEL}/assistants/requestsActions.ts`);
  assert.match(actions, /^"use server"/);
  assert.equal((actions.match(/adminCtx\("owner"\)/g) ?? []).length, 4, "approuver, refuser, validation par jeton, avertissements");
  assert.match(read(`${PANEL}/layout.tsx`), /<NavLink key="assistants" href=\{ASSISTANTS_HREF\}/);
  assert.match(read(`${PANEL}/page.tsx`), /data-testid="ai-maintenance-notice"|testid="ai-maintenance-notice"/);
  assert.match(read(`${PANEL}/assistants/actions.ts`), /MAINTENANCE_PROFILE/);
  const creator = read("src/components/admin/McpTokenCreator.tsx");
  assert.match(creator, /name="profile"/);
  assert.match(creator, /name="approval" defaultValue="human"/, "validation humaine par défaut");
  assert.match(creator, /name="notify" defaultValue="admin"/, "avertissement dans l'admin par défaut");
  assert.match(read(`${PANEL}/assistants/AccessTab.tsx`), /defaultProfile=\{profile === "maintenance"/);
});

test("admin : le guide pour l'IA est un lien vers le dépôt (construit sur la constante du crédit), pas un fichier servi par le site", () => {
  const page = read(`${PANEL}/assistants/page.tsx`);
  assert.match(page, /\$\{CREDIT_URL\}\/blob\/HEAD\/docs\/MAINTENANCE-IA\.md/);
  assert.match(page, /data-testid="ai-guide-link"/);
});

test("i18n : toutes les clés de traduction citées par les écrans de la maintenance existent en français et en anglais, avec les mêmes variables", () => {
  const keys = new Set();
  for (const f of UI_FILES) {
    const src = read(f);
    for (const m of src.matchAll(/\bt\(\s*"([\w.]+)"/g)) keys.add(m[1]);
  }
  // Familles construites : t(`aim.status.${…}`), t(`aim.risk.${action}`)…
  const actions = ["core_update", "module_update", "modules_update_all", "module_uninstall"];
  const tools = MAINTENANCE_TOOLS.map((m) => m.name.replace(/^maintenance_/, ""));
  for (const a of actions) { keys.add(`aim.req.${a}`); keys.add(`aim.risk.${a}`); }
  for (const t of tools) keys.add(`aim.tool.${t}`);
  for (const m of MAINTENANCE_TOOLS.filter((x) => x.level > 1)) keys.add(`aim.action.${m.name.replace(/^maintenance_/, "")}`);
  for (const s of ["pending", "running", "done", "failed", "denied", "expired"]) keys.add(`aim.status.${s}`);
  for (const n of ["busy", "expired", "not-pending", "unknown", "forbidden"]) keys.add(`aim.notice.${n}`);
  for (const l of [1, 2, 3]) { keys.add(`aim.level.${l}`); keys.add(`aim.level.${l}.help`); }
  for (const m of ["admin", "email"]) keys.add(`aim.notify.${m}`);
  for (const a of ["none", "read", "write", "delete", "maintenance.watch", "maintenance.act"]) keys.add(`assistants.can.${a}`);
  for (const n of ["1", "2", "3"]) { keys.add(`assistants.step.${n}`); keys.add(`assistants.step.${n}d`); }
  for (const tab of ["access", "requests", "history"]) keys.add(`assistants.tab.${tab}`);
  for (const k of ["mcp.profile.help", "assistants.new.kind.upkeepHelp", "mcp.scope", "mcp.scopeHelp", "mcp.created.token", "mcp.created.url", "mcp.created.once", "mcp.afterCreate", "assistants.confirmDestructive", "mcp.confirmDestructive"]) keys.add(k);
  for (const m of ["pending", "done", "failed"]) { keys.add(`aim.mail.${m}.subject`); keys.add(`aim.mail.${m}.body`); }
  for (const k of ["profile", "profile.standard", "profile.maintenance", "profile.help", "profile.l1", "profile.l2", "profile.l3", "profile.approval", "profile.approval.human", "profile.approval.direct", "profile.notify", "profile.notify.admin", "profile.notify.email"]) keys.add(`mcp.${k}`);
  const missing = [...keys].filter((k) => !(k in fr) || !(k in en));
  assert.deepEqual(missing, []);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys) assert.equal(vars(fr[k]), vars(en[k]), k);
  assert.ok(keys.size > 60);
});

test("journal d'audit : les actions de maintenance ont un libellé en clair (fr/en)", () => {
  for (const a of ["mcp.maintenance.request", "mcp.maintenance.approve", "mcp.maintenance.deny", "mcp.maintenance.mode", "mcp.maintenance.notify"]) {
    assert.ok(AUDIT_ACTIONS.includes(a));
    assert.ok(fr[auditLabelKey(a)] && en[auditLabelKey(a)], a);
  }
  assert.equal(auditLabelKey("mcp.maintenance.core_update"), "audit.action.mcp.maintenance.tool");
  assert.ok(fr["audit.action.mcp.maintenance.tool"] && en["audit.action.mcp.maintenance.tool"]);
  assert.equal(auditLabelKey("mcp.autre_outil"), "audit.action.mcp.tool", "les autres outils gardent leur libellé");
});

test("langage simple : les textes destinés à un non-technicien n'emploient pas de jargon sans explication", () => {
  const jargon = /\b(MCP|JSON|RPC|endpoint|token|API|CLI|SQL|npm|rc\.\d|snapshot|git)\b/;
  for (const [k, v] of Object.entries(fr)) {
    if (!/^(aim\.|mcp\.profile|dashboard\.ai|nav\.assistants|assistants\.|bugReport\.)/.test(k) || k === "assistants.subtitle") continue;  // le sous-titre « API & MCP » n'est montré qu'en mode avancé
    const m = jargon.exec(v.replaceAll("« API & MCP »", "« »").replace(/\{\w+\}/g, ""));  // nom du menu, variables
    // « MCP » n'apparaît qu'avec une explication courte entre parenthèses.
    if (m && m[1] === "MCP") assert.match(v, /MCP[^.]*\(/, `${k} : MCP sans explication`);
    else assert.ok(!m, `${k} : jargon « ${m?.[0]} » dans « ${v} »`);
  }
});

// ── Documentation ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("docs-coverage : chaque outil de maintenance est décrit dans le guide, qui pose les règles (jamais de candidate, validation humaine, 24 h) ; la sécurité en donne le modèle de menace", () => {
  const guide = read("docs/MAINTENANCE-IA.md");
  for (const t of MAINTENANCE_TOOLS) assert.ok(guide.includes(t.name) || guide.includes(`\`${t.name.replace("maintenance_", "_")}`), `${t.name} absent de docs/MAINTENANCE-IA.md`);
  for (const phrase of ["status", "health", "diagnose", "updates", "-rc", "24 heures", "pending_approval", "Approuver", "jeton", "expire"]) assert.ok(guide.includes(phrase), `« ${phrase} » absent du guide`);
  assert.ok(guide.indexOf("maintenance_status") < guide.indexOf("maintenance_health") && guide.indexOf("maintenance_health") < guide.indexOf("maintenance_diagnose"), "ordre conseillé");
  const security = read("docs/SECURITE.md");
  for (const phrase of ["IA compromise", "Jeton volé", "Demande forgée", "jamais", "candidate", "MAINTENANCE-IA.md"]) assert.ok(security.includes(phrase), `« ${phrase} » absent de docs/SECURITE.md`);
  assert.ok(read("docs/PLATFORM.md").includes("`maintenance`") && read("docs/MODULES.md").includes("MAINTENANCE-IA.md"));
  for (const [name, raw] of [["docs/MAINTENANCE-IA.md", guide], ["docs/SECURITE.md", security]]) {
    for (const m of raw.replace(/```[\s\S]*?```/g, "").matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) assert.ok(fs.existsSync(new URL(m[1], new URL(`file:///${process.cwd()}/${name}`)).pathname), `${name} : lien cassé ${m[1]}`);
  }
});

test("changelog : les deux nouveautés de la prochaine version sont écrites pour un non-technicien", () => {
  const md = read("CHANGELOG.md");
  const section = md.split("\n## ").find((s) => s.startsWith("0.1.15"));
  assert.ok(section.includes("*Changements depuis la 0.1.14.*"));
  const items = section.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(items.length, 2);
  assert.match(items[0], /IA/);
  assert.match(items[1], /Signaler un bug/);
});
