import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isCurrent } from "../../src/components/admin/navCurrent.ts";

const MENU = [
  { id: "blog", href: "/admin/entries?c=blog", also: ["/admin/instances/i-blog"] },
  { id: "pages", href: "/admin/entries?c=pages", also: ["/admin/instances/i-pages"] },
  { id: "sponsors", href: "/admin/entries?c=sponsors", also: ["/admin/instances/i-sponsors"] },
  { id: "twitch", href: "/admin/instances/i-twitch", also: [] },
  { id: "hero", href: "/admin/instances/i-hero", also: [] },
  { id: "dash", href: "/admin", exact: true },
  { id: "modules", href: "/admin/modules", also: ["/admin/catalogue"] },
  { id: "settings", href: "/admin/settings" },
  { id: "users", href: "/admin/users" },
];
/** Identifiants des liens courants pour une adresse. */
const current = (path, search = "") => MENU.filter((m) => isCurrent(m.href, path, search, m)).map((m) => m.id);

test("une liste de contenu : un seul lien", () => {
  assert.deepEqual(current("/admin/entries", "?c=blog"), ["blog"]);
  assert.deepEqual(current("/admin/entries", "c=pages"), ["pages"]);
  assert.deepEqual(current("/admin/entries", new URLSearchParams("c=sponsors")), ["sponsors"]);
});
test("nouvelle entrée et entrée ouverte (avec ?c=)", () => {
  assert.deepEqual(current("/admin/entries/new", "?c=blog&locale=fr"), ["blog"]);
  assert.deepEqual(current("/admin/entries/abc123", "?c=pages&locale=en&created=1"), ["pages"]);
});
test("entrée sans ?c= : aucun contenu n'est surligné à tort", () => {
  assert.deepEqual(current("/admin/entries/abc123", ""), []);
  assert.deepEqual(current("/admin/entries", ""), []);
});
test("réglages d'une instance sans contenu : uniquement cette fonctionnalité", () => {
  assert.deepEqual(current("/admin/instances/i-twitch"), ["twitch"]);
  assert.deepEqual(current("/admin/instances/i-hero", "?tab=sources"), ["hero"]);
});
test("réglages d'une instance à contenu : son entrée de contenu, et elle seule", () => {
  assert.deepEqual(current("/admin/instances/i-blog"), ["blog"]);
  assert.deepEqual(current("/admin/instances/i-pages", "?tab=settings"), ["pages"]);
});
test("un identifiant qui en préfixe un autre ne déborde pas", () => {
  assert.equal(isCurrent("/admin/instances/i-a", "/admin/instances/i-ab", ""), false);
  assert.equal(isCurrent("/admin/instances/i-a", "/admin/instances/i-a/", ""), true);
});
test("tableau de bord exact", () => {
  assert.deepEqual(current("/admin"), ["dash"]);
  assert.deepEqual(current("/admin/"), ["dash"]);
  assert.deepEqual(current("/admin/settings"), ["settings"]);
  assert.ok(!current("/admin/users").includes("dash"));
});
test("Modules reste courant pour /admin/modules et /admin/catalogue (et ses fiches)", () => {
  assert.deepEqual(current("/admin/modules"), ["modules"]);
  assert.deepEqual(current("/admin/catalogue"), ["modules"]);
  assert.deepEqual(current("/admin/catalogue/details", "?id=blog"), ["modules"]);
});
test("page sans paramètre : lien sans requête courant, liens à requête non", () => {
  assert.deepEqual(current("/admin/users"), ["users"]);
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries", null), false);
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries", undefined), false);
});
test("ancres et barres finales ignorées", () => {
  assert.equal(isCurrent("/admin/entries?c=blog#top", "/admin/entries", "?c=blog#x"), true);
  assert.equal(isCurrent("/admin/settings#privacy", "/admin/settings", ""), true);
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries/", "?c=blog"), true);
});
test("paramètres supplémentaires tolérés, valeurs différentes refusées", () => {
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries", "?c=blog&sort=date&page=2"), true);
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries", "?c=blog2"), false);
  assert.equal(isCurrent("/admin/entries?c=blog", "/admin/entries", "?c=Blog"), false);
  assert.equal(isCurrent("/admin/entries?c=a%20b", "/admin/entries", "?c=a+b"), true);
});
test("autre chemin : jamais courant", () => {
  assert.equal(isCurrent("/admin/home", "/admin/homepage", ""), false);
  assert.equal(isCurrent("/admin/home", "/admin/home/sub", ""), true);
  assert.equal(isCurrent("/admin/home", "/admin/home/sub", "", { exact: true }), false);
});

test("la page d'une entrée ajoute ?c= à son adresse (le menu en dépend)", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/entries/[id]/page.tsx", "utf8");
  assert.match(page, /c !== collection\.key\) redirect\(/);
});
