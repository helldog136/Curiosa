// Conformité de chaque module de ce dépôt : la suite du cœur (testsupport/), lancée sur modules/* et examples/*.
// Remplace, pour ces vérifications, les tests qui les répétaient un à un (voir README.md de ce dossier).
//
// Le cœur est trouvé par CURIOSA_DIR (positionné par scripts/test.mjs) ; les tests tournent dans son dossier, qui sert de repli.
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const { registerConformanceTests } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);

const moduleDirs = ["modules", "examples"].flatMap((group) => {
  const base = path.join(root, group);
  return fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, "module.json"))).map((e) => path.join(base, e.name)) : [];
});

// Défauts CONNUS : une entrée = « module → exigence → raison ». À corriger puis à retirer (le test échoue quand l'exception n'a plus lieu d'être).
const KNOWN = {
  guestbook: {
    "settings.optional": "« banner » et « accessCode » se disent facultatifs sans \"optional\": true (et minCore 0.1.22)",
    "privacy.declared": "le livre d'or reçoit des messages de personnes mais ne déclare pas « privacy »",
  },
  "announcement-banner": {
    "settings.optional": "« link » se dit facultatif sans \"optional\": true (et minCore 0.1.22)",
    "wording.simple": "la description parle de « sujet » (topic) : exemple pour développeurs, à reformuler",
  },
  "game-suggestions": { "privacy.declared": "reçoit des suggestions de personnes mais ne déclare pas « privacy »" },
  contacts: { "mcp.safety": "contact_create et contact_note écrivent mais sont activées par défaut (\"default\": true)" },
  partnerships: { "mcp.safety": "partner_create, partner_update, partner_log et partner_link_contact écrivent mais sont activées par défaut" },
  "alerts-overlay": { "wording.simple": "la description dit « HTTP » et le réglage « Jeton d'envoi » est visible en mode simple (le passer en avancé ou le reformuler)" },
  "discord-announcer": { "wording.simple": "l'aide du lien Discord parle de « jeton d'envoi »" },
};

for (const dir of moduleDirs) registerConformanceTests(dir, { test, siblings: moduleDirs, known: KNOWN[path.basename(dir)] });
