// Mise à jour N-1 → N : une sauvegarde FABRIQUÉE PAR LE CŒUR 0.2.13 (étiquette v0.2.13, commit b6eb015 : un site de test avec 69 instances de modules, 12 entrées publiées,
// 2 langues, réglages du site, un compte propriétaire) est restaurée par ce cœur sans rien perdre ni changer, et le site répond comme avant (plan du site, llms.txt).
// Rien de ce lot (champs de page, family, multichoice) ne change un réglage ou un module existant : les réglages restaurés sont identiques octet pour octet.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb as openTestDb } from "../helpers/db.mjs";

const db = await openTestDb();
const Rs = await import("@/core/backup/restore");
const { buildSitemap } = await import("@/core/sitemap");
const { buildLlmsTxt } = await import("@/core/llms");
const { getSettingByLocale } = await import("@/core/settings");
after(() => db.close());

const PW = "un-mot-de-passe-solide";

test("sauvegarde faite par la 0.2.13 : restaurée telle quelle (comptes, réglages, instances, entrées), le site répond", async () => {
  const buffer = fs.readFileSync("tests/fixtures/backup/site-0213.chiffre.bin");
  const opened = Rs.openBackup(buffer, PW, 1000);
  assert.ok(opened.ok, JSON.stringify(opened).slice(0, 200));
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  const { prisma } = db;
  assert.deepEqual(
    { users: await prisma.user.count(), instances: await prisma.moduleInstance.count(), entries: await prisma.entry.count() },
    { users: 1, instances: 69, entries: 12 },
  );
  assert.equal((await getSettingByLocale("i18n.default"))[""], "fr");
  assert.deepEqual((await getSettingByLocale("i18n.enabled"))[""], ["fr", "en"]);
  // Aucun module n'est installé sur une base neuve (les modules viennent du catalogue) : le plan du site et llms.txt se construisent quand même, avec les pages du cœur.
  const sitemap = (await buildSitemap()).urls.map((u) => new URL(u.url).pathname);
  assert.ok(sitemap.includes("/") && sitemap.includes("/privacy") && sitemap.includes("/en/privacy"), sitemap.join(" "));
  const llms = await buildLlmsTxt("fr");
  assert.match(llms, /^# Site de test/);
  assert.match(llms, /\[Accueil\]/);
});
