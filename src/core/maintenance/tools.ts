import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { callLevel3, runLevel2, type Level2Tool } from "./actions";
import { auditTrail, diagnose, health, modules, status, updates } from "./inspect";
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
  name: string; level: 1 | 2 | 3; title: string; description: string; input: McpTool["input"];
  run: (args: Record<string, unknown>, actor: { name: string; tokenId?: string }) => Promise<unknown>;
};

const level2 = (name: Level2Tool): Def["run"] => (args, actor) => runLevel2(name, validateArgs(name === "module_restart" ? INSTANCE_ARG : name === "module_reinstall" ? MODULE_ARG : NONE, args), actor);
const INSTANCE_ARG = { type: "object", properties: { instance: { type: "string", maxLength: 64, description: "Instance key, as listed by maintenance_modules." } }, required: ["instance"] } as const;
const UNINSTALL_ARG = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 64, description: "Module identifier, as listed by maintenance_modules." },
    keepData: { type: "boolean", description: "true (default): the module's settings and data are kept aside, inert, and come back if the module is installed again. false: everything is erased for good (irreversible)." },
  },
  required: ["module"],
} as const;
const level3 = (name: Level3Action): Def["run"] => (args, actor) => callLevel3(name, validateArgs(name === "core_update" || name === "modules_update_all" ? NONE : name === "module_uninstall" ? UNINSTALL_ARG : MODULE_ARG, args), actor);

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

  { name: "check_updates", level: 2, title: "Check for updates again", description: "Clears the version caches and checks the core and the modules again (the admin's \"Check again\" button).", input: NONE, run: level2("check_updates") },
  { name: "backup_run", level: 2, title: "Back up the database", description: "Makes a copy of the database on the server (the 5 most recent are kept). Do it before any update. The copy cannot be read or downloaded through this API.", input: NONE, run: level2("backup_run") },
  { name: "module_reinstall", level: 2, title: "Reinstall a module", description: "The admin's maintenance button: the module's code is renewed from its source; its data, settings and instances are kept.", input: MODULE_ARG, run: level2("module_reinstall") },
  { name: "module_restart", level: 2, title: "Bring a module instance back", description: "Retries an instance that was set aside after a failed data conversion, so that it runs again.", input: INSTANCE_ARG, run: level2("module_restart") },

  { name: "module_update", level: 3, title: "Update a module", description: "Updates one module to its latest STABLE version (never a pre-release). By default this only creates a request that the owner approves; then poll request_status.", input: MODULE_ARG, run: level3("module_update") },
  { name: "modules_update_all", level: 3, title: "Update all modules", description: "Updates every module that has a STABLE update, one by one. By default this only creates a request that the owner approves; then poll request_status.", input: NONE, run: level3("modules_update_all") },
  { name: "core_update", level: 3, title: "Update the core", description: "Updates Curiosa to the highest STABLE release, only if it is newer (never a release candidate or snapshot, never a downgrade). By default this only creates a request that the owner approves; then poll request_status. Make a backup first.", input: NONE, run: level3("core_update") },
  { name: "module_uninstall", level: 3, title: "Uninstall a module", description: "Uninstalls a module: no more page, menu, tasks, tools or public route. By default its settings and data are KEPT aside (inert, never readable by anyone) and come back if the module is installed again; pass keepData=false to erase everything for good (irreversible). By default this only creates a request that the owner approves; then poll request_status.", input: UNINSTALL_ARG, run: level3("module_uninstall") },
];

/** Catalogue statique (nom, niveau, droits) : sert à l'admin, aux tests et à la documentation. */
export const MAINTENANCE_TOOLS = DEFS.map((d) => ({ name: `maintenance_${d.name}`, level: d.level, readOnly: d.level === 1, destructive: d.level === 3 }));
export const isMaintenanceTool = (name: string) => name.startsWith("maintenance_");

export const maintenanceToolProvider: McpToolProvider = {
  id: "maintenance",
  async list() {
    return DEFS.map((d): McpTool => ({
      name: `maintenance_${d.name}`,
      title: d.title,
      description: `[Maintenance, level ${d.level}] ${d.description}`,
      readOnly: d.level === 1,
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
