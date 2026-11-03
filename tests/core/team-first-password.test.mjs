// Mot de passe provisoire d'un NOUVEAU compte (page Équipe) : montré une seule fois, avec « Copier », jamais retenu ailleurs que dans la réponse de l'action.
// Avant : le mot de passe était écrit dans la phrase de réussite (`ok`), un bandeau que la page garde affiché ; le drapeau « doit choisir le sien » était posé dans une seconde écriture.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const M = await import("@/core/auth/members");
const P = await import("@/core/auth/passwordPolicy");
const { SecretReveal, SecretValue } = await import("@/components/admin/OneTimeSecret");

beforeEach(async () => { await db.reset(); });
after(async () => { await db.close(); });

const read = (f) => fs.readFileSync(f, "utf8");
const owner = () => db.prisma.user.create({ data: { email: "o@x.org", name: "Olive", role: "owner", passwordHash: bcrypt.hashSync("owner-password-1", 4) } });

test("compte créé avec mot de passe généré : « doit choisir le sien » posé dans la MÊME écriture, rien de lisible en base ni au journal", async () => {
  const o = await owner();
  const password = P.generateTemporaryPassword();
  const r = await M.createMember(o.id, { name: "Emma", email: "e@x.org", password, role: "editor", mustChangePassword: true });
  assert.equal(r.ok, true);
  const created = await db.prisma.user.findUnique({ where: { id: r.id } });
  assert.equal(created.mustChangePassword, true, "dès la création, sans seconde écriture");
  assert.ok(await bcrypt.compare(password, created.passwordHash));
  const everything = JSON.stringify({ users: await db.prisma.user.findMany(), audit: await db.prisma.auditLog.findMany(), settings: await db.prisma.setting.findMany() });
  assert.ok(!everything.includes(password), "ni en clair en base ni dans le journal");
  const log = await db.prisma.auditLog.findMany({ where: { action: "user.create" } });
  assert.deepEqual(log.map((l) => [l.actor, l.target]), [["o@x.org", "e@x.org"]]);
});

test("mot de passe choisi par la personne qui crée le compte : le drapeau reste éteint (comportement d'avant)", async () => {
  const o = await owner();
  const r = await M.createMember(o.id, { name: "Emma", email: "e@x.org", password: "mot-de-passe-choisi", role: "editor" });
  assert.equal(r.ok, true);
  assert.equal((await db.prisma.user.findUnique({ where: { id: r.id } })).mustChangePassword, false);
  // seul `true` pose le drapeau : une chaîne venue d'un formulaire ne compte pas
  const s = await M.createMember(o.id, { name: "Sam", email: "s@x.org", password: "mot-de-passe-choisi", role: "editor", mustChangePassword: "true" });
  assert.equal((await db.prisma.user.findUnique({ where: { id: s.id } })).mustChangePassword, false);
});

test("l'action « nouvelle personne » : le mot de passe part dans `secret`, jamais dans le texte `ok` ; aucune seconde écriture", () => {
  const src = read("src/app/admin/(panel)/users/actions.ts");
  const body = src.slice(src.indexOf("export async function createUser"), src.indexOf("export async function setUserRolesAction"));
  assert.match(body, /mustChangePassword: generated/);
  assert.doesNotMatch(body, /prisma\.user\.update/, "le drapeau est posé à la création, pas après");
  assert.doesNotMatch(body, /t\("users\.added\.generated",\s*\{[^}]*password/, "le mot de passe n'est pas dans la phrase de réussite");
  assert.match(body, /secret:\s*\{\s*value: password/);
  assert.doesNotMatch(body, /redirect\(|cookies\(|headers\(|audit\(|console\./, "ni adresse, ni cookie, ni journal, ni console");
});

test("textes : la phrase de réussite n'a plus de {password}; « Vous ne le reverrez plus » et la première connexion sont dits ; FR et EN à parité", () => {
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const d of [fr, en]) {
    assert.doesNotMatch(d["users.added.generated"], /\{password\}/);
    for (const k of ["users.secret.title", "users.secret.once", "users.secret.mustChange", "users.secret.handOver", "users.secret.done"]) assert.ok(d[k], k);
    for (const k of ["users.secret.title", "users.secret.mustChange"]) assert.match(d[k], /\{name\}/, k);
  }
  assert.match(fr["users.secret.once"], /Vous ne le reverrez plus : notez-le ou copiez-le/);
  assert.match(fr["users.temp.shownOnce"], /Vous ne le reverrez plus/);
  assert.match(fr["users.secret.mustChange"], /première connexion/);
  assert.match(en["users.secret.once"], /will not see it again/);
});

const secret = { value: "Xk7m-Qp2w-Rt9b-Hn4c", title: "Mot de passe provisoire de Emma", notes: ["Vous ne le reverrez plus : notez-le ou copiez-le maintenant.", "Emma devra en choisir un autre à sa première connexion.", "Transmettez-le par un canal sûr."], copy: "Copier", copied: "Copié", done: "J'ai noté le mot de passe" };

test("le bandeau montre le mot de passe UNE fois, dans un texte sélectionnable (pas un champ), avec « Copier » et « J'ai noté… » ; cibles de 44 px", () => {
  const html = renderToStaticMarkup(React.createElement(SecretReveal, { secret }));
  assert.equal(html.split(secret.value).length - 1, 1, "une seule occurrence du mot de passe dans la page");
  assert.match(html, /<code[^>]*translate="no"[^>]*>Xk7m-Qp2w-Rt9b-Hn4c<\/code>/);
  assert.doesNotMatch(html, /<input/, "pas un champ : un gestionnaire de mots de passe n'a rien à y enregistrer");
  for (const text of [secret.copy, secret.done, ...secret.notes, secret.title]) assert.ok(html.includes(text.replace("'", "&#x27;")), text);
  assert.match(html, /data-testid="one-time-secret-copy"[^>]*>Copier</);
  assert.match(html, /aria-labelledby="[^"]+-t"/, "titre relié à la zone");
  assert.equal((html.match(/min-h-11/g) ?? []).length, 2, "Copier et J'ai noté : 44 px");
  const alone = renderToStaticMarkup(React.createElement(SecretValue, { value: "abc", copy: "Copier", copied: "Copié", testid: "x" }));
  assert.match(alone, /data-testid="x-value"/);
});

test("le secret n'est ni dans l'adresse, ni dans un cookie, ni dans le stockage du navigateur, ni écrit au journal ; il est effacé de la page à la demande", () => {
  const ui = read("src/components/admin/OneTimeSecret.tsx");
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|document\.cookie|router\.|searchParams|location\.|history\.|console\./);
  assert.match(ui, /setHidden\(true\)/);
  const form = read("src/components/admin/ActionForm.tsx");
  assert.match(form, /state\?\.secret && <SecretReveal key=\{state\.secret\.value\}/);
  assert.doesNotMatch(read("src/components/admin/TemporaryPasswordButton.tsx"), /navigator\.clipboard/, "une seule copie du code « Copier »");
});
