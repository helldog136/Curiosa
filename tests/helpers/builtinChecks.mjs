// Passerelle : les vérifications communes vivent dans testsupport/builtinChecks.mjs (la source unique, aussi utilisée par la suite de conformité).
// Même repli que fakeCtx.mjs quand ce fichier est recopié dans curiosa-extras.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sibling = new URL("../../testsupport/builtinChecks.mjs", import.meta.url);
const target = fs.existsSync(sibling) ? sibling : pathToFileURL(path.join(process.cwd(), "testsupport/builtinChecks.mjs"));
const kit = await import(target.href);
export const { placeholders, assertValidManifest, assertDefinitionMatchesManifest, assertLocalesParity, assertSettingsSane, settingsDefaults, findSrpViolations, assertNoSrpViolations, definitionProblems, permissionsFromDefinition, localeProblems, settingsProblems } = kit;
