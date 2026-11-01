// Sections ajoutées à l'éditeur d'entrée d'un autre module (entryPanels) : le contrat du manifeste, la décision pure « cette section s'applique-t-elle à cette entrée ? »,
// les garde-fous de l'action serveur (rôle éditeur, aucune redirection) et la vérification de conformité des modules qui en fournissent.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { appliesTo, panelsFor, panelValues, panelAnchor } from "@/core/modules/entryPanels";
import { checkModule } from "../../testsupport/index.mjs";
import { makeModule, dispose, editManifest } from "../fixtures/testsupport/fullModule.mjs";

const read = (p) => fs.readFileSync(p, "utf8");
const base = { apiVersion: 2, id: "bot", name: { en: "Bot", fr: "Bot" }, version: "1.0.0", instances: "multiple", permissions: ["admin"] };
const decl = { id: "chat-command", for: { topic: "sponsor.card" }, title: { en: "Chat command", fr: "Commande de chat" } };

// ── Manifeste ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : une section par sujet ou par module, jamais les deux ni aucun", () => {
  assert.equal(parseManifest({ ...base, entryPanels: [decl] }).ok, true);
  assert.equal(parseManifest({ ...base, entryPanels: [{ ...decl, for: { module: "sponsors" } }] }).ok, true);
  assert.equal(parseManifest({ ...base, entryPanels: [{ ...decl, help: { en: "h", fr: "a" } }] }).ok, true);
  for (const bad of [{}, { topic: "sponsor.card", module: "sponsors" }, { topic: "Pas Bon" }]) assert.equal(parseManifest({ ...base, entryPanels: [{ ...decl, for: bad }] }).ok, false, JSON.stringify(bad));
  assert.equal(parseManifest({ ...base, entryPanels: [{ ...decl, id: "Bad Id" }] }).ok, false);
  assert.equal(parseManifest({ ...base, entryPanels: [{ id: "x", for: { topic: "a.b" } }] }).ok, false, "le titre est obligatoire");
  assert.equal(parseManifest({ ...base, entryPanels: Array.from({ length: 6 }, (_, i) => ({ ...decl, id: `p${i}` })) }).ok, false, "5 au plus");
  assert.equal(parseManifest(base).ok, true, "absent = module d'avant");
});

// ── Décision pure ───────────────────────────────────────────────────────────────────────────────────────────────────
test("une section vise les entrées par sujet fourni ou par module, et rien d'autre", () => {
  const sponsors = { id: "sponsors", provides: ["sponsor.card"] };
  const blog = { id: "blog", provides: [] };
  assert.equal(appliesTo(decl, sponsors), true);
  assert.equal(appliesTo(decl, blog), false);
  assert.equal(appliesTo({ for: { module: "blog" } }, blog), true);
  assert.equal(appliesTo({ for: { module: "blog" } }, sponsors), false);
  assert.equal(appliesTo({ for: {} }, sponsors), false);
});

test("panelsFor : seulement les fournisseurs qui ont le code de la section, dans l'ordre, pour les entrées visées", () => {
  const render = () => [];
  const a = { instance: "a", decls: [decl, { ...decl, id: "second" }], panels: { "chat-command": { render }, second: { render } } };
  const noCode = { instance: "b", decls: [decl], panels: {} };
  const broken = { instance: "c", decls: [decl], panels: { "chat-command": { render: "pas une fonction" } } };
  const sponsors = { id: "sponsors", provides: ["sponsor.card"] };
  assert.deepEqual(panelsFor(sponsors, [a, noCode, broken]).map((m) => `${m.instance}:${m.decl.id}`), ["a:chat-command", "a:second"]);
  assert.deepEqual(panelsFor({ id: "blog", provides: [] }, [a]), [], "entrée non visée : aucune section");
  assert.deepEqual(panelsFor(sponsors, []), [], "aucun fournisseur installé : la fiche est inchangée");
});

test("valeurs d'un formulaire : du texte seulement, borné, sans les champs internes de React ; ancre sûre", () => {
  const f = new FormData();
  f.set("$ACTION_ID_abc", "x"); f.set("name", "y".repeat(25000)); f.set("file", new Blob(["x"]), "a.txt"); f.set("ok", "on");
  const v = panelValues(f);
  assert.deepEqual(Object.keys(v).sort(), ["name", "ok"]);
  assert.equal(v.name.length, 20000);
  assert.equal(panelAnchor("bot 2", "chat.command"), "panel-bot-2-chat-command");
});

// ── Garde-fous du cœur (lecture du code, comme les autres tests d'architecture) ─────────────────────────────────────
test("l'action serveur d'une section : rôle éditeur comme l'éditeur d'entrée, relit l'entrée, jamais de redirection", () => {
  const src = read("src/app/admin/(panel)/entries/panel-actions.ts");
  assert.match(src, /^"use server";/);
  assert.match(src, /adminCtx\("editor"\)/, "mêmes rôles que l'éditeur d'entrée");
  assert.doesNotMatch(src, /adminCtx\("admin"\)/);
  assert.match(src, /resolvePanelAction\(instanceId, panelId, entryId\)/, "la section est retrouvée et validée côté serveur");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /\bredirect\s*\(/, "aucune redirection : la page ne bouge pas");
  assert.match(src, /revalidatePath\(`\/admin\/entries\/\$\{entryId\}`\)/);
  assert.match(read("src/app/admin/(panel)/entries/[id]/page.tsx"), /adminCtx\("editor"\)/, "la page reste ouverte aux éditeurs");
  const load = read("src/core/modules/entryPanelsLoad.ts");
  assert.match(load, /prisma\.entry\.findUnique/, "l'entrée vient de la base, pas du navigateur");
  assert.match(load, /blocks\.length > 0/, "une section qui rend [] est masquée");
  assert.match(load, /info\.target, view\)/, "le mode avancé et le rôle sont transmis à la section");
  assert.match(read("src/app/admin/(panel)/entries/[id]/page.tsx"), /view=\{\{ advanced, role: panelRole\(user\) \}\} viewer=\{user\}/, "palier (jamais « none ») et personne connectée (pour ctx.can)");
});

test("le point d'extension est neutre : aucun module cité, la décision pure n'importe que des types", () => {
  const files = ["src/core/modules/entryPanels.ts", "src/core/modules/entryPanelsLoad.ts", "src/components/admin/EntryPanels.tsx", "src/app/admin/(panel)/entries/panel-actions.ts"];
  for (const f of files) {
    const text = read(f);
    for (const id of ["sponsors", "twitch", "partnerships", "sponsor.card", "blog", "social"]) assert.ok(!new RegExp(`["'\`]${id}\\b`).test(text), `${f} cite « ${id} »`);
  }
  const pure = read("src/core/modules/entryPanels.ts");
  for (const m of pure.matchAll(/^import (?!type)[^\n]*$/gm)) assert.fail(`entryPanels.ts doit rester pur : ${m[0]}`);
});

test("l'éditeur d'entrée place les sections HORS du formulaire de l'entrée (un formulaire ne s'imbrique pas) et avant la zone de suppression", () => {
  const page = read("src/app/admin/(panel)/entries/[id]/page.tsx");
  const form = page.indexOf("<EntryForm"), panels = page.indexOf("<EntryPanels"), danger = page.indexOf("entries.dangerTitle");
  assert.ok(form > 0 && panels > form && danger > panels);
  assert.match(page.slice(form, panels), /\/>\s*\{\/\*/, "EntryForm est refermé avant les sections");
  const ui = read("src/components/admin/EntryPanels.tsx");
  assert.match(ui, /<details open /);
  assert.match(ui, /entries\.panel\.failed/);
  // Pas de gridEditor dans une section (il enregistre en tant qu'administrateur).
  assert.match(read("src/components/site/Blocks.tsx"), /adminInstanceId && !entryScope\) out\.push\(<GridEditor/);
});

test("instances.list expose l'identifiant et le lien d'administration d'une instance", () => {
  const api = read("src/core/modules/api.ts");
  assert.match(api, /id: i\.id, key: i\.key/);
  assert.match(api, /adminPath: `\/admin\/instances\/\$\{i\.id\}`/);
});

// ── Conformité : un module qui fournit une section ──────────────────────────────────────────────────────────────────
const made = [];
const mk = (edit) => { const d = makeModule(edit); made.push(d); return d; };
after(() => { for (const d of made) dispose(d); });
const status = (report, id) => report.results.find((r) => r.id === id);
const PANEL = `
  entryPanels: {
    "chat-command": {
      async render(ctx, entry) { return [{ type: "adminForm", action: "save", submitLabel: ctx.t("send"), fields: [{ name: "text", label: ctx.t("text"), value: String(entry.title) }] }]; },
      actions: { async save(ctx, entry, values) { await ctx.api.store.add("messages", { name: String(entry.id), text: String(values.text ?? "").slice(0, 200) }); return { ok: ctx.t("thanks") }; } },
    },
  },`;
const withPanel = (f, { code = PANEL, declare = true, admin = true } = {}) => {
  editManifest(f, (m) => {
    if (admin) m.permissions.push("admin");
    else m.permissions = m.permissions.filter((x) => x !== "admin");
    if (declare) m.entryPanels = [{ id: "chat-command", for: { topic: "sponsor.card" }, title: { en: "Chat command", fr: "Commande de chat" } }];
  });
  f["index.mjs"] = f["index.mjs"].replace("export default {", `export default {${code}`);
};

test("conformité : un module avec une section d'éditeur correcte réussit tout (déclaration, code, boutons, permission admin)", async () => {
  const report = await checkModule(mk((f) => withPanel(f)), { siblings: [] });
  const bad = report.results.filter((r) => r.status === "fail").map((r) => `${r.id}: ${r.problems?.join(" | ")}`);
  assert.deepEqual(bad, []);
  assert.equal(report.summary.ok, true);
});

test("conformité : section annoncée mais absente du code, ou l'inverse, bouton vers une action inconnue, permission admin oubliée, section qui ne se charge pas", async () => {
  const noCode = await checkModule(mk((f) => withPanel(f, { code: "" })), { siblings: [] });
  assert.equal(status(noCode, "def.matches").status, "fail");
  assert.match(status(noCode, "def.matches").problems.join("\n"), /annoncée dans module\.json \(entryPanels\)/);
  const undeclared = await checkModule(mk((f) => withPanel(f, { declare: false })), { siblings: [] });
  assert.match(status(undeclared, "def.matches").problems.join("\n"), /module\.json ne l'annonce pas/);
  const ghostButton = await checkModule(mk((f) => withPanel(f, { code: PANEL.replace('action: "save"', 'action: "ghost"') })), { siblings: [] });
  assert.match(status(ghostButton, "def.matches").problems.join("\n"), /action « ghost » qui n'existe pas/);
  const noPerm = await checkModule(mk((f) => withPanel(f, { admin: false })), { siblings: [] });
  assert.equal(status(noPerm, "perm.declared").status, "fail");
  const notFn = await checkModule(mk((f) => withPanel(f, { code: PANEL.replace("async render(ctx, entry)", "render: 42, async unused(ctx, entry)") })), { siblings: [] });
  assert.equal(status(notFn, "def.loads").status, "fail");
});

test("conformité : une section qui n'échappe pas le titre de la fiche (données piégées) est détectée par le rendu", async () => {
  const unsafe = `
  entryPanels: {
    "chat-command": {
      async render(ctx, entry) { return [{ type: "html", html: "<p>" + entry.title + "</p>" }]; },
    },
  },`;
  const report = await checkModule(mk((f) => withPanel(f, { code: unsafe })), { siblings: [] });
  const failed = report.results.filter((r) => r.status === "fail").map((r) => r.id);
  assert.ok(failed.includes("html.escaped"), `html.escaped doit signaler le titre non échappé : ${failed}`);
});
