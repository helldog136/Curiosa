// Le catalogue des exigences. Une exigence = un identifiant stable, un niveau, une explication, une vérification.
import manifest from "./manifest.mjs";
import code from "./code.mjs";
import text from "./text.mjs";
import runtime from "./runtime.mjs";

/** Rubriques, dans l'ordre où le rapport les présente. */
export const GROUPS = {
  manifest: "Le fichier module.json",
  compat: "Compatibilité avec le cœur",
  code: "Le code du module",
  permissions: "Les droits demandés",
  i18n: "Les langues",
  settings: "Les réglages",
  security: "Sécurité et forme des pages",
  routes: "Les routes (formulaires et envois)",
  forms: "Les formulaires d'administration",
  mcp: "Les actions pour les assistants IA (MCP)",
  tasks: "Les tâches planifiées",
  network: "Les appels réseau",
  data: "Les données",
  privacy: "La vie privée",
  srp: "Un module, une seule chose",
  wording: "Les mots et la documentation",
};

export const LEVELS = { mandatory: "obligatoire", advice: "conseil" };

const all = [...manifest, ...code, ...text, ...runtime];
const order = Object.keys(GROUPS);
/** Toutes les exigences, rangées par rubrique (l'ordre à l'intérieur d'une rubrique est celui des fichiers). */
export const REQUIREMENTS = order.flatMap((g) => all.filter((r) => r.group === g));

const ids = new Set();
for (const r of REQUIREMENTS) {
  if (ids.has(r.id)) throw new Error(`testsupport : identifiant d'exigence en double « ${r.id} »`);
  ids.add(r.id);
}
if (REQUIREMENTS.length !== all.length) throw new Error("testsupport : une exigence a une rubrique inconnue");

/** Ancre de l'exigence dans docs/TESTSUPPORT.md. */
export const docLink = (id) => `docs/TESTSUPPORT.md#${id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
