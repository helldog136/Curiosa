// Renommage de la palette « sarcelle et braise » (0.2.14) : aucune donnée ne porte son identifiant (le site enregistre les cinq
// couleurs, jamais le nom de la palette). Ce test le prouve avec une sauvegarde FABRIQUÉE PAR LE CODE 0.2.13 (fixture) : restaurée par
// le code actuel, elle donne le même site, la même palette reconnue, et rejouer la restauration ne change rien.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const Rs = await import("@/core/backup/restore");
const { getSiteConfig } = await import("@/core/settings");
const { matchPalette, THEME_PRESETS } = await import("@/core/palettes");
after(() => db.close());

const FIX = new URL("../fixtures/backup/palette-0213.chiffre.bin", import.meta.url);
const COLORS = { background: "#0b1716", surface: "#122321", text: "#e9f3f1", accent: "#e8782f", accent2: "#5fd3cc" };

async function restoreFixture() {
  const opened = Rs.openBackup(fs.readFileSync(FIX), "mot-de-passe-de-reference", 1000);
  assert.equal(opened.ok, true, "la sauvegarde de la 0.2.13 s'ouvre");
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "test", dataDir: fs.mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/pm-`) });
  assert.equal(report.ok, true);
}
const settingsRows = async () => (await db.prisma.setting.findMany({ where: { key: { startsWith: "theme." } }, orderBy: { key: "asc" } })).map((r) => [r.key, r.locale, r.value]);

test("ancienne sauvegarde (0.2.13) : restaurée, les couleurs sont celles d'avant et la palette reconnue est la palette renommée", async () => {
  await restoreFixture();
  const config = await getSiteConfig();
  assert.deepEqual([config.background, config.accent, config.accent2, config.surface, config.textColor], [COLORS.background, COLORS.accent, COLORS.accent2, COLORS.surface, COLORS.text]);
  assert.equal(matchPalette(config.background, config.accent, config.accent2, config.surface, config.textColor), "ember");
  const keys = (await settingsRows()).map((r) => r[0]);
  assert.deepEqual(keys, ["theme.accent", "theme.accent2", "theme.background", "theme.surface", "theme.text"], "seules des couleurs sont enregistrées, aucun nom de palette");
});

test("rejouer la restauration (ou la mise à jour) ne change rien : réglages identiques octet pour octet", async () => {
  await restoreFixture();
  const first = await settingsRows();
  await restoreFixture();
  assert.deepEqual(await settingsRows(), first);
  assert.ok(THEME_PRESETS.some((p) => p.id === "ember"));
});
