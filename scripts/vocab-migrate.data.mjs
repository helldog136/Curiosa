// Data of scripts/vocab-migrate.mjs: what the rule pipeline cannot decide alone.
//
// FR_OVERRIDES / EN_OVERRIDES: key -> either the FINAL text (string), or a list of [from, to] fixes applied to what the pipeline produced
// (a pronoun, a participle that agrees with another noun, a sentence that had to be reworded). Each entry is reviewed by a person.
// « module » is masculine: the pipeline fixes the determiner before the noun and the participle right after it; everything else is listed here.

export const FR_OVERRIDES = {
  "audit.action.module.install.custom": "Module personnel installé",
  "audit.action.module.uninstall.auto": "Module installé automatiquement, retiré",
  "audit.action.module.keep.auto": "Module installé automatiquement, gardé",
  "audit.action.module.source.add": "Source de modules ajoutée",
  "audit.action.module.source.remove": "Source de modules retirée",
  "audit.action.instance.setup": "Module mis en place depuis le bouton d'un autre",
  "audit.action.instance.sources": "Sources d'un module modifiées",
  "audit.action.module.legacy.off": "Ancien module éteint : désinstallé, données gardées",
  "dashboard.modulesFailed": "Aucun module n'a pu être installé (catalogue injoignable) : installez-les plus tard depuis Modules › Ajouter.",
  "dashboard.modulesPartial": "Certains modules n'ont pas pu être installés (catalogue injoignable) : installez-les plus tard depuis Modules › Ajouter.",
  "dash.health.instances": "{n} modules ont été mis de côté.",
  "dash.health.instances.one": "{n} module a été mis de côté.",
  "backup.restoreHelp": "Vous voyez d'abord ce que la sauvegarde contient. Les modules sont réinstallés depuis le catalogue ; un module personnel n'est réinstallé que si vous le confirmez, un par un.",
  "catalogue.intro.simple": "Des modules prêts à l'emploi pour votre site : un carnet d'adresses, des suggestions de jeux, des annonces Discord… Choisissez, lisez la présentation, et installez en un clic.",
  "perm.instances.setup": "Mettre en place les modules dont il a besoin, seulement après un clic de votre part",
  "perm.secrets": "Garder à l'abri un mot de passe ou un code d'accès, lisible par ce seul module",
  "setup.modules.help": "Un module complète votre site (un blog, vos réseaux sociaux, des pages…). Nous suggérons ceux-ci pour démarrer.",
  "setup.modules.unreachable": "Le catalogue n'est pas joignable, donc aucun module n'est suggéré. Votre site se crée quand même ; installez des modules plus tard depuis Modules › Ajouter.",
  "aim.req.module_uninstall": "Désinstaller le module « {name} » en gardant ses données de côté (elles reviennent si le module est réinstallé).",
  "aim.tool.catalog_get": "Lire la fiche d'un module du catalogue : à quoi il sert, ce que voit votre public, les données qu'il récolte, ce qu'il demande.",
  "aim.tool.modules": "Liste des modules installés, ceux en erreur, ce qui leur manque, ceux qui ont une mise à jour.",
  "aim.tool.module_restart": "Remettre en marche un module mis à l'écart après une erreur.",
  "rss.sources.help": "Chaque module a aussi son propre flux, si les personnes qui vous lisent ne veulent suivre que celui-là.",
  "aim.mod.tools.note": [["une fois installée", "une fois installé"]],
  "placement.helpDefault": "Choix automatique, selon ce que fait ce module. Changez-le si vous préférez le retrouver ailleurs.",
  "extensions.introSimple": "Réglez chaque module en un clic et épinglez au menu ceux que vous utilisez souvent.",
  "remove.eraseHelp": [["envoyés par elle", "envoyés par lui"]],
  "audit.action.module.legacy.convert": "Module passé au catalogue (démarrage)",
  "navigation.suggested": "Suggéré par le module",
  "instances.suggestsNav": "Ce module suggère de le mettre dans le menu.",
  "ovp.ed.goneHelp": "Son module n'est plus installé. Il garde sa place, vide, jusqu'à ce que vous le retiriez.",
  "upkeep.row.absent": "Modules venus des premières versions",
  "upkeep.row.keptRows": "Modules gardés tels quels",
  "upkeep.row.seedsMissing.text": "Le module les confiera à un autre à sa prochaine mise à jour.",
  "legacy.copy.help": "Le module dit ne plus s'en servir. Ils restent dans vos sauvegardes.",
  "aim.tool.catalog_plan": "Obtenir un plan complet pour plusieurs modules du catalogue : ce qu'ils font, les données qu'ils recueillent, ce qu'ils demandent.",
  "aim.req.bundle": "Installer {n} modules d'un coup. Lisez chacun avant d'approuver.",
  "catalogue.personalWarning": "Ce module vient d'un catalogue que vous avez ajouté vous-même. C'est du code qui s'exécute sur votre serveur avec les mêmes droits que le site. Installez-le seulement si vous faites confiance à la personne qui l'a écrit.",
  "personal.refused.clash": "{id} : le catalogue officiel a déjà un module de ce nom. Il n'est pas proposé.",
  "personal.refused.elsewhere": "{id} : il pointe vers un autre dépôt. Seuls les modules de ce dépôt sont proposés.",
  "personal.remove.kept": "{n} modules installés depuis ce catalogue continuent de fonctionner avec leurs données. Ils ne reçoivent plus de mises à jour.",
};

/** French keys that hold no retired word but agree with one (« Elle arrive avec » said of a fonctionnalité) or still use the older word « fonction »: key -> [[from, to]]. */
export const FR_FOLLOWUPS = {
  "aim.req.module_install.also": [["Elle arrive avec", "Il arrive avec"]],
  "aim.req.module_install.perms": [["Elle demande", "Il demande"]],
  "aim.risk.module_install": [["Vous pourrez la désinstaller", "Vous pourrez le désinstaller"]],
  "aim.risk.modules_update_all": [["Elles sont mises à jour une par une ; une qui échoue", "Ils sont mis à jour un par un ; un qui échoue"]],
  "perm.privacy": [["vos autres fonctions disent des données personnelles qu'elles récoltent", "vos autres modules disent des données personnelles qu'ils récoltent"]],
  "remove.keepHelp": [["envoyés par cette fonction", "envoyés par ce module"], ["La réinstaller", "Le réinstaller"]],
  "rolePreset.moderator.description": [["ouvre les fonctions", "ouvre les modules"]],
  "rolePreset.editor-in-chief.description": [["ouvre les fonctions et leur", "ouvre les modules et leur"]],
  "rolePreset.reviewer.description": [["Ouvre les fonctions et leur", "Ouvre les modules et leur"]],
};

export const EN_OVERRIDES = {
  // « new features » here means what a new Curiosa version brings, not an installed piece
  "updates.level.minor": "improvements",
  "updates.autoHelp": [["new modules", "improvements"]],
  "setup.modules.help": "A module extends your site (a blog, your social networks, pages…). We suggest these to get started.",
  "modules.permissions": "Technical functions used",
};

/** User-visible English strings of the code (MCP tool texts, maintenance messages, an accessible name). Exact substrings; the script skips a file that no longer holds `from`. */
const rep = (file, from, to) => ({ file, from, to });
export const CODE_REPLACEMENTS = [
  rep("src/core/maintenance/actions.ts", "(Admin > Extensions)", "(Admin > Modules)"),
  rep("src/core/maintenance/catalog.ts", "Admin > Extensions > Add an extension", "Admin > Modules > Add a module"),
  rep("src/core/maintenance/install.ts", "Admin > Extensions > Add an extension", "Admin > Modules > Add a module"),
  rep("src/core/maintenance/inspect.ts", "Admin > Extensions > Personal catalogues", "Admin > Modules > Personal catalogues"),
  rep("src/core/maintenance/inspect.ts", "Admin > Extensions.", "Admin > Modules."),
  rep("src/core/maintenance/install.ts", "Admin > Extensions.", "Admin > Modules."),
  rep("src/core/maintenance/tools.ts", "installed features changed", "installed modules changed"),
  rep("src/core/journalMcp.ts", "module (the extension's id", "module (the module's id"),
  rep("src/core/journalMcp.ts", "(an extension id, or _core", "(a module id, or _core"),
  rep("src/core/journalMcp.ts", "500 per extension at most", "500 per module at most"),
  rep("src/core/journalMcp.ts", "Only fields an extension declared", "Only fields a module declared"),
  rep("src/core/overlaySkinsMcp.ts", "no active extension offers", "no active module offers"),
  rep("src/core/overlaySkinsMcp.ts", "values this extension has seen", "values this module has seen"),
  rep("src/core/overlaySkinsMcp.ts", "active extensions offer", "active modules offer"),
  rep("src/core/dashboard/spec.ts", "(the page of this extension)", "(the page of this module)"),
  rep("src/components/admin/dashboard/Blocks.tsx", 'aria-label="Extensions"', 'aria-label="Modules"'),
];

export const DOC_RULES = [];
export const DOC_FILES_SKIP = [];
