// Empreinte d'un dossier de skin, calculée par le VALIDATEUR du cœur (la même fonction que l'installation) : `node --import ./tests/helpers/register.mjs scripts/visual/skin-fingerprint.mjs <dossier> <id> <versionDuCœur>`.
// Écrit sur la sortie un JSON { ok, fingerprint, issues } ; sert au profil `skin-test` du harnais, qui doit écrire une ligne `skin.installed` complète (sans `fingerprint`, le skin est ignoré en silence).
import { validateSkinFolder } from "../../src/core/skins/validate.ts";

const [dir, id, coreVersion] = process.argv.slice(2);
const v = validateSkinFolder(dir, { coreVersion, expectId: id });
console.log(JSON.stringify({ ok: v.ok, fingerprint: v.fingerprint, issues: v.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message.fr}`) }));
