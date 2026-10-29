// Route de lecture de l'avancement, actions suivies, menu indulgent et erreurs sous les champs.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { prisma } = db;
const { GET } = await import("@/app/api/admin/operations/[id]/route");
const { runOperation, resetOperations } = await import("@/core/operations/tracker");
const { saveNavigation } = await import("@/app/admin/(panel)/navigation/actions");
const { normalizeLinkInput, isSafeExternalUrl } = await import("@/core/url");
const R = await import("@/core/auth/roles");
const { getSetting } = await import("@/core/settings");

after(() => db.close());
const read = (f) => fs.readFileSync(f, "utf8");
let U;
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
const get = (id) => GET(new Request(`https://site.example/api/admin/operations/${id}`), { params: Promise.resolve({ id }) });
const OP = "op-aaaaaaaaaaaaaaaaaaaa";

beforeEach(async () => {
  await db.reset(); resetOperations(); globalThis.curiosaTestSession = null;
  const mk = (name, role) => prisma.user.create({ data: { email: `${name}@example.org`, name, role, passwordHash: "x" } });
  U = { owner: await mk("olive", "owner"), admin: await mk("adam", "admin"), editor: await mk("emma", "editor") };
  await R.syncSystemAssignments();
});

test("route : sans session 401 ; la personne qui a lancé lit son suivi ; un propriétaire lit tout ; les autres reçoivent 404 (comme pour un inconnu)", async () => {
  await runOperation({ kind: "install", key: "install:m", owner: U.editor.email, opId: OP }, async () => 1);
  assert.equal((await get(OP)).status, 401);
  as(U.editor);
  const mine = await get(OP);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get("cache-control"), "no-store");
  const body = await mine.json();
  assert.equal(body.operation.state, "done");
  assert.ok(!JSON.stringify(body).includes("example.org"), "pas d'adresse e-mail dans la réponse");
  as(U.owner);
  assert.equal((await get(OP)).status, 200);
  as(U.admin);
  assert.equal((await get(OP)).status, 404);
  assert.equal((await get("op-bbbbbbbbbbbbbbbbbbbb")).status, 404);
  assert.equal((await get("..%2F..%2Fx")).status, 404);
});

test("route : la mise à jour du site (core-update) est lue sur le disque et réservée au propriétaire", async () => {
  as(U.admin);
  assert.equal((await get("core-update")).status, 404);
  as(U.owner);
  const res = await get("core-update");
  assert.equal(res.status, 200);
  const op = (await res.json()).operation;
  assert.equal(op.kind, "core-update");
  assert.ok(Array.isArray(op.steps));
});

test("route : en lecture seule (GET uniquement), jamais mise en cache", () => {
  const src = read("src/app/api/admin/operations/[id]/route.ts");
  assert.match(src, /export async function GET/);
  assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(src));
  assert.match(src, /no-store/);
  assert.match(src, /force-dynamic/);
});

test("adresses : www.monsite.be/contact, monsite.be/contact, /contact, espaces et e-mail sont compris ; ce qui reste incompréhensible reste refusé", () => {
  assert.equal(normalizeLinkInput("  www.monsite.be/contact "), "https://www.monsite.be/contact");
  assert.equal(normalizeLinkInput("monsite.be/contact"), "https://monsite.be/contact");
  assert.equal(normalizeLinkInput("monsite.be:8080/x?y=1"), "https://monsite.be:8080/x?y=1");
  assert.equal(normalizeLinkInput(" /contact "), "/contact");
  assert.equal(normalizeLinkInput("https://monsite.be/a"), "https://monsite.be/a");
  assert.equal(normalizeLinkInput("http://monsite.be"), "http://monsite.be");
  assert.equal(normalizeLinkInput("emma@monsite.be"), "mailto:emma@monsite.be");
  assert.equal(normalizeLinkInput("mailto:emma@monsite.be"), "mailto:emma@monsite.be");
  assert.equal(normalizeLinkInput("//monsite.be/x"), "https://monsite.be/x");
  assert.equal(normalizeLinkInput(""), "");
  assert.equal(normalizeLinkInput(null), "");
  for (const bad of ["contact", "ma page", "javascript:alert(1)", "ftp://monsite.be"]) assert.equal(isSafeExternalUrl(normalizeLinkInput(bad)) || normalizeLinkInput(bad).startsWith("/"), false, bad);
});

const form = (items) => { const f = new FormData(); f.set("items", JSON.stringify(items)); return f; };
const link = (href, label = { fr: "Contact", en: "Contact" }) => ({ k: "link", href, label });

test("menu : une adresse sans https:// est comprise et enregistrée complète", async () => {
  as(U.admin);
  const r = await saveNavigation(null, form([link("www.monsite.be/contact"), link("monsite.be/a"), link(" /contact ")]));
  assert.ok(r.ok, JSON.stringify(r));
  const saved = (await getSetting("nav.menu")).items;
  assert.deepEqual(saved.map((i) => i.href), ["https://www.monsite.be/contact", "https://monsite.be/a", "/contact"]);
});

test("menu : une adresse incompréhensible donne une erreur SOUS le champ de CETTE ligne (chemin items.N.href), avec un exemple, sans bandeau", async () => {
  as(U.admin);
  const r = await saveNavigation(null, form([link("/ok"), link("pas une adresse"), link("zzz")]));
  assert.equal(r.error, undefined, "pas de bandeau : l'erreur concerne un champ");
  assert.deepEqual(Object.keys(r.errors), ["items.1.href"], "la première ligne en erreur");
  assert.match(r.errors["items.1.href"], /https:\/\/www\.\w+\.\w+\/contact/, "un exemple complet");
  assert.match(r.errors["items.1.href"], /\/contact/);
  const inGroup = await saveNavigation(null, form([{ k: "group", label: { fr: "G", en: "G" }, items: [link("/a"), link("???")] }]));
  assert.deepEqual(Object.keys(inGroup.errors), ["items.0.items.1.href"]);
  const noLabel = await saveNavigation(null, form([link("/a", {})]));
  assert.deepEqual(Object.keys(noLabel.errors), ["items.0.label"]);
});

test("architecture : plus d'erreur de champ affichée en bas — les actions d'adresse renvoient `errors`, le formulaire les met sous le champ, la page défile et donne le focus", () => {
  for (const f of ["navigation", "redirects", "entries", "settings"]) {
    const src = read(`src/app/admin/(panel)/${f}/actions.ts`);
    assert.ok(!/error: t\("error\.badUrl"\)/.test(src), `${f} : une adresse refusée se signale sous son champ (errors), pas par un bandeau`);
  }
  const form = read("src/components/admin/ActionForm.tsx");
  assert.match(form, /useFieldErrorsDom\(ref, state\?\.errors, state\)/);
  assert.match(form, /<FieldErrorsProvider value=\{fieldErrorsValue\}>/);
  assert.match(form, /const fieldErrorsValue = useMemo\(/, "valeur du contexte STABLE : sinon l'éditeur se redessine à chaque rendu du formulaire et la première lettre tapée après « Ajouter un lien » se perdait (constaté sur le site compilé)");
  const errors = read("src/components/admin/FieldErrors.tsx");
  assert.match(errors, /aria-invalid/);
  assert.match(errors, /aria-describedby/);
  assert.match(errors, /scrollIntoView/);
  assert.match(errors, /focus\(\{ preventScroll: true \}\)/);
  assert.match(errors, /addEventListener\("input", clear\)/, "l'erreur disparaît dès que le champ est corrigé");
  const nav = read("src/components/admin/NavEditor.tsx");
  assert.match(nav, /errorOf\(fieldErrors, hrefPath\)/, "l'éditeur de menu affiche l'erreur sous le champ de la ligne");
  assert.match(read("src/components/admin/AdminBlocks.tsx"), /useFieldErrorsDom\(formRef/, "les formulaires des modules aussi");
  assert.match(read("src/core/modules/types.ts"), /errors\?: Record<string, string>/);
  assert.match(read("src/app/admin/(panel)/instances/module-actions.ts"), /sanitizeFieldErrors\(result\.errors\)/);
});

test("architecture : chaque action longue passe par le suivi d'opération (un seul lancement à la fois) avec les mêmes droits qu'avant", () => {
  const P = "src/app/admin/(panel)/";
  const cases = [
    [P + "extensions/add/actions.ts", /trackOperation\(user, \{ kind: "install"/, "owner"],
    [P + "updates/actions.ts", /trackOperation\(user, \{ kind: ids\?\.length === 1 \? "module-update" : "modules-update"/, "owner"],
    [P + "modules/actions.ts", /trackOperation\(user, \{ kind: "module-update"/, "owner"],
    [P + "modules/maintenanceActions.ts", /trackOperation\(user, \{ kind: "module-reinstall"/, "owner"],
    [P + "instances/suggestActions.ts", /trackOperation\(user, \{ kind: "install"/, "owner"],
  ];
  for (const [file, re, role] of cases) {
    const src = read(file);
    assert.match(src, re, file);
    assert.match(src, new RegExp(`adminCtx\\("${role}"\\)`), `${file} : même garde qu'avant`);
    assert.ok(src.indexOf("adminCtx(") < src.indexOf("trackOperation("), `${file} : le contrôle de droits passe AVANT le suivi`);
  }
  assert.match(read("src/app/api/admin/backup/route.ts"), /guardBackup[\s\S]*trackOperation\(/);
  assert.match(read("src/core/backup/handlers.ts"), /await guard\(request\)[\s\S]*trackOperation\(/);
  assert.match(read("src/app/api/admin/backup/route.ts"), /secretKeyPart\(password\)/, "un double clic avec un autre mot de passe ne rejoint jamais la sauvegarde d'autrui");
});

test("architecture : les types d'opération annoncent leurs étapes et le code les signale (opStep) aux bons endroits", () => {
  const inst = read("src/core/modules/installer.ts");
  for (const s of ["download", "verify", "deps", "activate", "data"]) assert.match(inst, new RegExp(`opStep\\("${s}"\\)`), `installateur : ${s}`);
  for (const s of ["collect", "readable", "files", "seal"]) assert.match(read("src/core/backup/export.ts"), new RegExp(`opStep\\("${s}"\\)`), `sauvegarde : ${s}`);
  for (const s of ["modules", "safety", "replace", "files", "finish"]) assert.match(read("src/core/backup/restore.ts"), new RegExp(`opStep\\("${s}"\\)`), `restauration : ${s}`);
  assert.match(read("src/core/modules/updateStatus.ts"), /opUnit\(\+\+position, ordered\.length/, "« module N sur M »");
  assert.match(read("scripts/update-lib.mjs"), /save\(\{ step: "migrate" \}\)/);
  // Chaque étape a son texte en mots simples, en français ET en anglais.
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  const T = (read("src/core/operations/tracker.ts").match(/export const OP_STEPS[\s\S]*?\n};/) ?? [""])[0];
  const steps = [...new Set([...T.matchAll(/"([a-z]+)"/g)].map((m) => m[1]))].filter((s) => !["core", "update", "install", "module", "modules", "backup", "restore", "reinstall"].includes(s));
  for (const s of steps) for (const d of [fr, en]) assert.ok(d[`progress.step.${s}`], `texte de l'étape ${s}`);
  for (const s of ["backup", "download", "verify", "swap", "migrate", "restarting", "waiting"]) for (const d of [fr, en]) assert.ok(d[`progress.step.core.${s}`], `mise à jour du site : ${s}`);
});
