import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { callLevel3, runConfigure, runLevel2, type Level2Tool } from "./actions";
import { CATALOG_GET_INPUT, CATALOG_LIST_INPUT, catalogGet, catalogList } from "./catalog";
import { CONFIGURE_INPUT, SETTINGS_INPUT, readSettings } from "./moduleSettings";
import { auditTrail, diagnose, health, modules, status, updates } from "./inspect";
import { contentCheckView } from "./content/service";
import { legacyReportForAssistant } from "@/core/modules/legacyReport";
import { redactDeep } from "./redact";
import { getRequest, type Level3Action } from "./requests";

/**
 * OUTILS MCP DU CŒUR pour la maintenance (préfixe `maintenance_`) : une IA diagnostique et entretient le site. Ce ne sont pas des outils d'un module :
 * le cœur les propose lui-même, dans le même format que les autres (annotations, `default`, accès jeton par jeton, mêmes règles de sécurité).
 *
 *   Niveau 1  lecture / diagnostic        lecture seule ; actif pour un jeton « maintenance », désactivé pour tout autre jeton
 *   Niveau 2  actions sans risque         désactivées par défaut, à accorder jeton par jeton
 *   Niveau 3  actions à risque            désactivées par défaut, `destructive: true` ; avec validation humaine par défaut (voir actions.ts)
 *
 * JAMAIS exposés ici : secrets, mots de passe, jetons, variables d'environnement, contenu des sauvegardes, réglages de sécurité, utilisateurs, fichiers
 * arbitraires, commandes arbitraires. Toute sortie passe par le masquage des secrets et par des bornes de taille.
 * Il n'y a pas d'outil « restaurer une sauvegarde » : cela remplace tout le site et demande le mot de passe de la sauvegarde, qui ne doit jamais passer par une IA.
 */
export const MAINTENANCE_SOURCE = "maintenance";
const NONE = { type: "object" } as const;
const MODULE_ARG = { type: "object", properties: { module: { type: "string", maxLength: 64, description: "Module identifier, as listed by maintenance_modules." } }, required: ["module"] } as const;

type Def = {
  name: string; level: 1 | 2 | 3;
  /** Lecture seule malgré un niveau 2 (les réglages d'une instance : leurs valeurs ne se lisent que si le propriétaire l'a accordé). Défaut : niveau 1 seulement. */
  readOnly?: boolean;
  title: string; description: string; input: McpTool["input"];
  run: (args: Record<string, unknown>, actor: { name: string; tokenId?: string }) => Promise<unknown>;
};

const CONTINUE_ARG = { type: "object", properties: { continue: { type: "boolean", description: "true: go on with the check that is already started (visits the next outside links). Default false: start a new check." } } } as const;
const level2 = (name: Level2Tool): Def["run"] => (args, actor) => runLevel2(name, validateArgs(name === "module_restart" ? INSTANCE_ARG : name === "module_reinstall" ? MODULE_ARG : name === "content_check_run" ? CONTINUE_ARG : NONE, args), actor);
const INSTANCE_ARG = { type: "object", properties: { instance: { type: "string", maxLength: 64, description: "Instance key, as listed by maintenance_modules." } }, required: ["instance"] } as const;
const UNINSTALL_ARG = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 64, description: "Module identifier, as listed by maintenance_modules." },
    keepData: { type: "boolean", description: "true (default): the module's settings and data are kept aside, inert, and come back if the module is installed again. false: everything is erased for good (irreversible)." },
  },
  required: ["module"],
} as const;
const INSTALL_ARG: JsonSchemaLite = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 40, description: "Module identifier from maintenance_catalog_list (for example blog)." },
    instanceKey: { type: "string", maxLength: 31, description: "Optional, only for a module that allows several instances: the key of its first instance (lowercase letters, digits and dashes, for example blog-news). Default: derived from the module identifier." },
  },
  required: ["module"],
};
const level3 = (name: Level3Action): Def["run"] => (args, actor) => callLevel3(name, validateArgs(name === "core_update" || name === "modules_update_all" ? NONE : name === "module_uninstall" ? UNINSTALL_ARG : name === "module_install" ? INSTALL_ARG : MODULE_ARG, args), actor);

const DEFS: Def[] = [
  { name: "status", level: 1, title: "Site status", description: "Core version and update channel, Node version, uptime, number of modules, state of the update in progress. Start here.", input: NONE, run: () => status() },
  { name: "health", level: 1, title: "Site health", description: "Disk space, database state, date of the last backup (and whether it is recent), recent errors (limited and with secrets masked).", input: NONE, run: () => health() },
  { name: "modules", level: 1, title: "Installed modules", description: "Installed modules: version, source, instances in error, missing dependencies, update available.", input: NONE, run: () => modules() },
  { name: "updates", level: 1, title: "Available updates", description: "Updates of the core (STABLE releases only) and of modules: target version, patch/minor/major level, short release notes, and whether a module needs a newer core.", input: NONE, run: () => updates() },
  { name: "diagnose", level: 1, title: "Guided diagnosis", description: "One report that gathers health, modules, backup and updates: what is wrong, the probable cause, the proposed action and the tool that does it. Call it after status and health.", input: NONE, run: () => diagnose() },
  { name: "audit", level: 1, title: "Recent maintenance actions", description: "The latest maintenance actions done by AIs and by humans (limited, no secrets).", input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many entries (default 20)." } } }, run: (args) => auditTrail(Number(validateArgs({ type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } }, args).limit ?? 20)) },
  {
    name: "request_status", level: 1, title: "Status of a request", description: "State of a request you made for a risky action (pending_approval, running, done, failed, denied, expired) and its result.",
    input: { type: "object", properties: { requestId: { type: "string", maxLength: 40, description: "The requestId returned by the risky tool." } }, required: ["requestId"] },
    async run(args, actor) {
      const { requestId } = validateArgs(this.input, args) as { requestId: string };
      const r = await getRequest(requestId);
      // Une IA ne relit que SES demandes.
      if (!r || r.tokenId !== actor.tokenId) throw new McpToolError("Unknown request.");
      return { requestId: r.id, action: r.action, status: r.status === "pending" ? "pending_approval" : r.status, plan: r.plan, createdAt: new Date(r.createdAt).toISOString(), expiresAt: new Date(r.expiresAt).toISOString(), ...(r.result ? { result: r.result } : {}) };
    },
  },
  { name: "legacy", level: 1, title: "Data upgrade report", description: "What is left to upgrade after an update from an earlier version of the site: old module rows, switched-off items, instances whose data is behind or set aside, takeovers not done, hidden settings still filled in, unknown settings. Read-only; counts and names only, never a setting value.", input: NONE, run: () => legacyReportForAssistant() },
  {
    name: "catalog_list", level: 1, title: "Modules available to install",
    description: "Lists the modules of the official catalogue that this site does NOT have yet (or all of them with include=all, the installed ones marked). Use it to guide the owner: search with a few short words (French or English, try several), then read the sheet of the best candidates with maintenance_catalog_get. Each item says what the module is for, whether it is verified, whether it can be installed on this site (and if not, why in plain words), the services it needs or offers. Paged (50 at most, use nextOffset). Read-only; reads the same catalogue as the admin (cached 15 minutes). If the catalogue cannot be reached the answer says so (available: false): try again later.",
    input: CATALOG_LIST_INPUT, run: (args) => catalogList(args),
  },
  {
    name: "catalog_get", level: 1, title: "Sheet of a catalogue module",
    description: "The full sheet of one module, in plain words, to help the owner choose: what it is for, what visitors see, what personal data it collects (the author's declaration), what permissions it asks for, the modules it needs (required) and the ones that make it work better (optional) with what each brings, whether it fits this site's Curiosa version, whether it is already installed, which settings to plan (never a value, never a secret) and which modules go well with it. Read-only. To install it, use maintenance_module_install (the owner approves).",
    input: CATALOG_GET_INPUT, run: (args) => catalogGet(args),
  },
  { name: "content_check", level: 1, title: "Content check result", description: "The result of the last check of the site's content (images without text, titles, descriptions for search engines, missing translations, menu entries and links that lead nowhere, outside links). READ-ONLY: it shows the last result and contacts no site. Each remark has an importance (important / advised / info), a short sentence, why it matters and, where there is one, the admin screen that fixes it. Never a score.", input: NONE, run: () => contentCheckView() },

  { name: "check_updates", level: 2, title: "Check for updates again", description: "Clears the version caches and checks the core and the modules again (the admin's \"Check again\" button).", input: NONE, run: level2("check_updates") },
  { name: "backup_run", level: 2, title: "Back up the database", description: "Makes a copy of the database on the server (the 5 most recent are kept). Do it before any update. The copy cannot be read or downloaded through this API.", input: NONE, run: level2("backup_run") },
  { name: "module_reinstall", level: 2, title: "Reinstall a module", description: "The admin's maintenance button: the module's code is renewed from its source; its data, settings and instances are kept.", input: MODULE_ARG, run: level2("module_reinstall") },
  { name: "module_restart", level: 2, title: "Bring a module instance back", description: "Retries an instance that was set aside after a failed data conversion, so that it runs again.", input: INSTANCE_ARG, run: level2("module_restart") },
  { name: "content_check_run", level: 2, title: "Check the content now", description: "Runs a check of the site's content (same as the admin's \"Check now\" button): reads the pages, the menu and the settings, then visits some outside links, politely (at most 200 links per check, 25 per website, never two visits in a row to the same website, internal addresses refused). Changes nothing on the site. A check of many links is done in steps: call again with continue: true until it says finished, then read the result with maintenance_content_check. Only run it when asked or when the content check is out of date.", input: CONTINUE_ARG, run: level2("content_check_run") },

  {
    name: "module_settings", level: 2, readOnly: true, title: "Settings of a module instance",
    description: "The settings of one instance (key from maintenance_modules): label, help, type, current value, what values are allowed with an example, whether it needs a value and which tool can change it. A SECRET setting never shows its value, only isSet true/false and where the owner types it in the admin. Addresses are shown without their private part. Read-only, but values can be personal, so the owner grants it separately.",
    input: SETTINGS_INPUT, run: (args) => readSettings(args),
  },
  {
    name: "module_configure", level: 2, title: "Change settings of a module",
    description: "Changes up to 20 settings of one instance in one call (instance key + changes {settingKey: value}). Same checks as the admin form (types, allowed choices, optional groups); everything is checked first and if one value is wrong NOTHING is saved and all problems are listed in simple words with an example. An empty value puts a setting back to its default. It never sets or reads a SECRET setting (tell the owner to type it in the admin, the path is in the answer), never touches roles, rights, names, menu or public path, and cannot change ADVANCED settings (that needs maintenance_module_configure_advanced). Every change is audited (old and new value, never a secret).",
    input: CONFIGURE_INPUT as unknown as McpTool["input"], run: (args, actor) => runConfigure(false, args, actor),
  },
  {
    name: "module_configure_advanced", level: 2, title: "Change settings of a module, advanced included",
    description: "Exactly maintenance_module_configure, and it also allows the ADVANCED (technical) settings of the module. The owner grants this tool separately, only to an AI they trust with technical settings. Secret settings stay forbidden.",
    input: CONFIGURE_INPUT as unknown as McpTool["input"], run: (args, actor) => runConfigure(true, args, actor),
  },

  {
    name: "module_install", level: 3, title: "Install a catalogue module",
    description: "Asks to install a module of the official catalogue (id from maintenance_catalog_list). It NEVER installs by itself: it creates a request that the owner approves in Admin > AI assistants, whatever the token's approval setting is; then poll maintenance_request_status. Checked before asking: the module exists and is verified, fits this Curiosa version, is not installed yet, and every module it requires can be put in place (they are listed in the request, the owner sees them, nothing comes in secretly). After approval the first instance is created with default settings; then use maintenance_module_settings and maintenance_module_configure. Optional instanceKey for a module that allows several instances.",
    input: INSTALL_ARG, run: level3("module_install"),
  },
  { name: "module_update", level: 3, title: "Update a module", description: "Updates one module to its latest STABLE version (never a pre-release). By default this only creates a request that the owner approves; then poll request_status.", input: MODULE_ARG, run: level3("module_update") },
  { name: "modules_update_all", level: 3, title: "Update all modules", description: "Updates every module that has a STABLE update, one by one. By default this only creates a request that the owner approves; then poll request_status.", input: NONE, run: level3("modules_update_all") },
  { name: "core_update", level: 3, title: "Update the core", description: "Updates Curiosa to the highest STABLE release, only if it is newer (never a release candidate or snapshot, never a downgrade). By default this only creates a request that the owner approves; then poll request_status. Make a backup first.", input: NONE, run: level3("core_update") },
  { name: "module_uninstall", level: 3, title: "Uninstall a module", description: "Uninstalls a module: no more page, menu, tasks, tools or public route. By default its settings and data are KEPT aside (inert, never readable by anyone) and come back if the module is installed again; pass keepData=false to erase everything for good (irreversible). By default this only creates a request that the owner approves; then poll request_status.", input: UNINSTALL_ARG, run: level3("module_uninstall") },
];

/** Catalogue statique (nom, niveau, droits) : sert à l'admin, aux tests et à la documentation. */
export const MAINTENANCE_TOOLS = DEFS.map((d) => ({ name: `maintenance_${d.name}`, level: d.level, readOnly: d.readOnly ?? d.level === 1, destructive: d.level === 3 }));
export const isMaintenanceTool = (name: string) => name.startsWith("maintenance_");

export const maintenanceToolProvider: McpToolProvider = {
  id: "maintenance",
  async list() {
    return DEFS.map((d): McpTool => ({
      name: `maintenance_${d.name}`,
      title: d.title,
      description: `[Maintenance, level ${d.level}] ${d.description}`,
      readOnly: d.readOnly ?? d.level === 1,
      // Aucune de ces actions n'est active par défaut pour un jeton ordinaire ; le profil « Maintenance » accorde le niveau 1 (lecture) et rien d'autre.
      default: false,
      profileDefault: d.level === 1,
      destructive: d.level === 3,
      input: d.input,
      source: MAINTENANCE_SOURCE,
      // Niveau 2 et 3 : l'action se consigne elle-même dans l'audit (`mcp.maintenance.<outil>`), avec son résultat.
      audited: true,
      call: async (args, actor) => redactDeep(await d.run.call(d, args, actor)),
    }));
  },
};
