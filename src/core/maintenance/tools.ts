import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { callLevel3, runConfigure, runLevel2, type Level2Tool } from "./actions";
import { CATALOG_GET_INPUT, CATALOG_LIST_INPUT, catalogGet, catalogList } from "./catalog";
import { CATALOG_PLAN_INPUT, catalogPlan } from "./catalogPlan";
import { INSTANCE_ADD_ARG } from "./instances";
import { MAX_BUNDLE } from "./install";
import { myAccess } from "./myAccess";
import { CONFIGURE_INPUT, SETTINGS_INPUT, readSettings } from "./moduleSettings";
import { auditTrail, diagnose, health, modules, status, updates } from "./inspect";
import { contentCheckView } from "./content/service";
import { legacyReportForAssistant } from "@/core/modules/legacyReport";
import { redactDeep } from "./redact";
import { getRequest, type Level3Action } from "./requests";
import { getRun } from "./background";
import { FONT_SET_ARG } from "./fonts";
import { NAVIGATION_GET_INPUT, NAVIGATION_SET_INPUT, navigationGet } from "./siteNavigation";
import { HOME_LIST_INPUT, HOME_SET_INPUT, homeSectionsList } from "./siteHome";
import { SKIN_ARG, SKIN_LIST_INPUT, SKIN_OPTIONS_ARG, skinList, skinStatus } from "./skins";

/**
 * OUTILS MCP DU CŒUR pour la maintenance (préfixe `maintenance_`) : une IA diagnostique et entretient le site. Ce ne sont pas des outils d'un module :
 * le cœur les propose lui-même, dans le même format que les autres (annotations, `default`, accès jeton par jeton, mêmes règles de sécurité).
 *
 *   Niveau 1  lecture / diagnostic        lecture seule ; actif pour un jeton « maintenance », désactivé pour tout autre jeton
 *   Niveau 2  actions sans risque         désactivées par défaut, à accorder jeton par jeton
 *   Niveau 3  actions à risque            désactivées par défaut, `request: true` (une DEMANDE, pas une suppression) ; `destructive: true` seulement pour ce qui efface
 *                                         (désinstaller, retirer un skin) ; avec validation humaine par défaut (voir actions.ts)
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
  /** The tool keeps its own name (`navigation_get`) instead of the `maintenance_` prefix. */
  bare?: boolean;
  /** Lecture seule malgré un niveau 2 (les réglages d'une instance : leurs valeurs ne se lisent que si le propriétaire l'a accordé). Défaut : niveau 1 seulement. */
  readOnly?: boolean;
  /** Granted by default to every access (not only to a "maintenance" one). Only the read tool that tells an AI what it lacks. */
  default?: boolean;
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
    module: { type: "string", maxLength: 40, description: "Module identifier from maintenance_catalog_list (for example blog). Use module OR modules." },
    modules: { type: "array", items: { type: "string" }, description: `Several module identifiers (${MAX_BUNDLE} at most) asked in ONE request that the owner approves as a whole; plan them first with maintenance_catalog_plan. No instanceKey with a list.` },
    instanceKey: { type: "string", maxLength: 31, description: "Optional, only for a module that allows several instances: the key of its first instance (lowercase letters, digits and dashes, for example blog-news). Default: derived from the module identifier." },
  },
};
/** The arguments each request accepts. `skin_*` actions take a skin identifier, except the options (colours and fonts). */
const LEVEL3_INPUT: Record<Level3Action, unknown> = {
  core_update: NONE, modules_update_all: NONE, module_update: MODULE_ARG, module_uninstall: UNINSTALL_ARG, module_install: INSTALL_ARG,
  skin_install: SKIN_ARG, skin_activate: SKIN_ARG, skin_remove: SKIN_ARG, skin_set_options: SKIN_OPTIONS_ARG, font_set: FONT_SET_ARG, instance_add: INSTANCE_ADD_ARG,
  // Published by the content engine (content/mcp.ts) under the name of each instance; listed here so that the table is complete.
  entry_publish: NONE, entry_unpublish: NONE, site_settings_set: NONE,
  navigation_set: NAVIGATION_SET_INPUT, home_sections_set: HOME_SET_INPUT,
};
const level3 = (name: Level3Action): Def["run"] => (args, actor) => {
  if (name === "navigation_set" || name === "home_sections_set") {
    const listKey = name === "navigation_set" ? "entries" : "sections";
    const extra = Object.keys(args ?? {}).find((k) => k !== listKey);
    if (extra) throw new McpToolError(`unexpected argument "${extra}"`);
    return callLevel3(name, { [listKey]: (args as Record<string, unknown>)[listKey] }, actor);
  }
  const valid = validateArgs(LEVEL3_INPUT[name] as JsonSchemaLite, args);
  return callLevel3(name, name === "skin_set_options" ? { options: valid } : valid, actor);
};
/** What makes a level 3 tool a deletion (red chip, confirmation when granted). Everything else at level 3 is a request, not a deletion. */
const DESTRUCTIVE_LEVEL3: ReadonlySet<string> = new Set(["module_uninstall", "skin_remove"]);

const toolName = (d: Pick<Def, "name" | "bare">) => (d.bare ? d.name : `maintenance_${d.name}`);

const DEFS: Def[] = [
  {
    name: "my_access", level: 1, default: true, title: "What this access can do",
    description: "What THIS access can and cannot do: the tools granted, the tools NOT granted (each with the right the owner has to tick, in plain words), the ceiling of the access (read only or read and write), the approval setting (requests wait for the owner, or actions happen at once) and the reminder that tools granted or modules installed after you connected only show up after you reconnect. Call it first, and whenever a tool you expect is missing from your list. Read-only; no secret, nothing about other accesses.",
    input: NONE, run: (_args, actor) => myAccess(actor),
  },
  { name: "status", level: 1, title: "Site status", description: "Core version and update channel, Node version, uptime, number of modules, state of the update in progress. Start here.", input: NONE, run: () => status() },
  { name: "health", level: 1, title: "Site health", description: "Disk space, database state, date of the last backup (and whether it is recent), recent errors (limited and with secrets masked).", input: NONE, run: () => health() },
  { name: "modules", level: 1, title: "Installed modules", description: "Installed modules: version, source, instances in error, missing dependencies, update available, missing English or French texts (translations). Also the languages of the site: official or community, complete or partial.", input: NONE, run: () => modules() },
  { name: "updates", level: 1, title: "Available updates", description: "Updates of the core (STABLE releases only) and of modules: target version, patch/minor/major level, short release notes, and whether a module needs a newer core.", input: NONE, run: () => updates() },
  { name: "diagnose", level: 1, title: "Guided diagnosis", description: "One report that gathers health, modules, backup and updates: what is wrong, the probable cause, the proposed action and the tool that does it. Call it after status and health.", input: NONE, run: () => diagnose() },
  { name: "audit", level: 1, title: "Recent maintenance actions", description: "The latest maintenance actions done by AIs and by humans (limited, no secrets).", input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many entries (default 20)." } } }, run: (args) => auditTrail(Number(validateArgs({ type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } }, args).limit ?? 20)) },
  {
    name: "request_status", level: 1, title: "Status of a request or a long action", description: "State of a request you made for a risky action (pending_approval, running, done, failed, denied, expired) and its result. Also how you follow a long action that answered \"started\" (updating all modules, reinstalling a module, checking for updates): status running with its progress (modules done out of the total), then done or failed with the result module by module. Poll every 10 to 20 seconds; the work does not depend on your connection.",
    input: { type: "object", properties: { requestId: { type: "string", maxLength: 40, description: "The requestId returned by the risky tool or by the long action." } }, required: ["requestId"] },
    async run(args, actor) {
      const { requestId } = validateArgs(this.input, args) as { requestId: string };
      const r = await getRequest(requestId);
      // Une IA ne relit que SES demandes.
      if (r && r.tokenId === actor.tokenId) return { requestId: r.id, action: r.action, status: r.status === "pending" ? "pending_approval" : r.status, plan: r.plan, createdAt: new Date(r.createdAt).toISOString(), expiresAt: new Date(r.expiresAt).toISOString(), ...(r.progress ? { progress: r.progress } : {}), ...(r.result ? { result: r.result } : {}) };
      const run = r ? null : await getRun(requestId);
      if (!run || run.tokenId !== actor.tokenId) throw new McpToolError("Unknown request.");
      return { requestId: run.id, action: run.action, status: run.status, ...(run.plan ? { plan: run.plan } : {}), createdAt: new Date(run.createdAt).toISOString(), ...(run.finishedAt ? { finishedAt: new Date(run.finishedAt).toISOString() } : {}), ...(run.progress ? { progress: run.progress } : {}), ...(run.result ? { result: run.result } : {}) };
    },
  },
  { name: "legacy", level: 1, title: "Data upgrade report", description: "What is left to upgrade after an update from an earlier version of the site: old module rows, switched-off items, instances whose data is behind or set aside, takeovers not done, hidden settings still filled in, unknown settings. The `upkeep` field says what is really left to do (`toDo`) and what is only kept as a precaution (`keptAsPrecaution`, nothing to do, for example safety copies of old data that stay in backups); `collectionsToEmpty` lists those copies and is never a task. Read-only; counts and names only, never a setting value.", input: NONE, run: () => legacyReportForAssistant() },
  {
    name: "catalog_list", level: 1, title: "Modules available to install",
    description: "Lists the modules of the official catalogue that this site does NOT have yet (or all of them with include=all, the installed ones marked). Use it to guide the owner: search with a few short words (French or English, try several), then read the sheet of the best candidates with maintenance_catalog_get. Each item says what the module is for, whether it is verified, whether it can be installed on this site (and if not, why in plain words), the services it needs or offers. Paged (50 at most, use nextOffset). Read-only; reads the same catalogue as the admin (cached 15 minutes). If the catalogue cannot be reached the answer says so (available: false): try again later.",
    input: CATALOG_LIST_INPUT, run: (args) => catalogList(args),
  },
  {
    name: "catalog_plan", level: 1, title: "Plan for several catalogue modules",
    description: `The whole plan for up to ${MAX_BUNDLE} modules in ONE answer: for each module its sheet (what it is for, what visitors see, personal data collected, permissions asked, modules it needs, what to configure afterwards), then the plan as a whole (install order, modules that come along, every permission and who asks for it, which modules collect personal data, readyToRequest = the real verdict of the checks the installation request does). Read-only. Then ask for everything in one request with maintenance_module_install {modules: [...]}; the owner approves it as a whole. If a tool is missing from your list, call maintenance_my_access.`,
    input: CATALOG_PLAN_INPUT, run: (args) => catalogPlan(args),
  },
  {
    name: "catalog_get", level: 1, title: "Sheet of a catalogue module",
    description: "The full sheet of one module, in plain words, to help the owner choose: what it is for, what visitors see, what personal data it collects (the author's declaration), what permissions it asks for, the modules it needs (required) and the ones that make it work better (optional) with what each brings, whether it fits this site's Curiosa version, whether it is already installed, which settings to plan (never a value, never a secret) and which modules go well with it. Read-only. To install it, use maintenance_module_install (the owner approves it; it needs that tool to be granted to you). If maintenance_module_install is missing from your list, call maintenance_my_access: it says whether the owner has to grant it, and that you may have to reconnect.",
    input: CATALOG_GET_INPUT, run: (args) => catalogGet(args),
  },
  { name: "skin_status", level: 1, title: "Appearance of the site", description: "The skin in use, whether the owner adjusted colors, glow, background or header, the font of titles and of text (with tips, and the fonts that can be chosen), whether visitors get a Light / Dark button, and colors that were adjusted so they can be read. Start here for any question about how the site looks. Nothing here can be changed without the owner's approval.", input: NONE, run: () => skinStatus() },
  { name: "skin_list", level: 1, title: "Skins installed and available", description: "The skins installed on this site, and the skins of the official catalogue that it does not have yet (name, description, author, light / dark modes). A skin only changes the look, never the content. Use it to guide the owner. To act you need maintenance_skin_install or maintenance_skin_activate (both are requests the owner approves) and they are only in your list when the owner granted them: if they are missing, call maintenance_my_access.", input: SKIN_LIST_INPUT, run: (args) => skinList(args) },
  { name: "content_check", level: 1, title: "Content check result", description: "The result of the last check of the site's content (images without text, titles, descriptions for search engines, missing translations, menu entries and links that lead nowhere, outside links). READ-ONLY: it shows the last result and contacts no site. Each remark has an importance (important / advised / info), a short sentence, why it matters and, where there is one, the admin screen that fixes it. Never a score.", input: NONE, run: () => contentCheckView() },

  { name: "check_updates", level: 2, title: "Check for updates again", description: "Clears the version caches and checks the core and the modules again (the admin's \"Check again\" button)."+' Long action: it answers at once when it is quick; otherwise it answers {status:"started", requestId} and goes on in the background (your connection does not matter): follow it with maintenance_request_status until done or failed.', input: NONE, run: level2("check_updates") },
  { name: "backup_run", level: 2, title: "Back up the database", description: "Makes a copy of the database on the server (the 5 most recent are kept). Do it before any update. The copy cannot be read or downloaded through this API.", input: NONE, run: level2("backup_run") },
  { name: "module_reinstall", level: 2, title: "Reinstall a module", description: "The admin's maintenance button: the module's code is renewed from its source; its data, settings and instances are kept."+' Long action: it answers at once when it is quick; otherwise it answers {status:"started", requestId} and goes on in the background (your connection does not matter): follow it with maintenance_request_status until done or failed.', input: MODULE_ARG, run: level2("module_reinstall") },
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
    description: "Asks to install a module of the official catalogue (id from maintenance_catalog_list). It NEVER installs by itself: it creates a request that the owner approves in Admin > AI assistants, whatever the token's approval setting is; then poll maintenance_request_status. Checked before asking: the module exists and is verified, fits this Curiosa version, is not installed yet, and every module it requires can be put in place (they are listed in the request, the owner sees them, nothing comes in secretly). After approval the first instance is created with default settings; then use maintenance_module_settings and maintenance_module_configure. Optional instanceKey for a module that allows several instances. To install several modules, pass modules: [...] (up to ${MAX_BUNDLE}): it creates ONE request that the owner approves as a whole, and the owner sees every module and every permission; plan it first with maintenance_catalog_plan.",
    input: INSTALL_ARG, run: level3("module_install"),
  },
  {
    name: "instance_add", level: 3, title: "Add another instance of a module",
    description: "Asks for one more instance (a second blog, a second list of links) of an INSTALLED module that allows several instances. Give a nickname that tells it apart from the others. Like an installation, it NEVER happens without the owner's approval, whatever the token's approval setting, because a new instance may get a public page; then poll maintenance_request_status. A module that allows only one instance is refused. Removing an instance stays with the owner.",
    input: INSTANCE_ADD_ARG, run: level3("instance_add"),
  },
  {
    name: "skin_install", level: 3, title: "Install a catalogue skin",
    description: "Asks to install a skin of the OFFICIAL catalogue (id from maintenance_skin_list). It NEVER installs by itself: it creates a request that the owner approves in Admin > AI assistants, whatever the token's approval setting. It only installs; to use the skin, ask for maintenance_skin_activate. You cannot install a skin from a personal repository or any address: only the owner can, by hand. The skin is checked first (rules, license, readability); a refusal is explained. Then poll maintenance_request_status.",
    input: SKIN_ARG, run: level3("skin_install"),
  },
  {
    name: "skin_activate", level: 3, title: "Use an installed skin",
    description: "Asks to switch the site to an installed skin (or to basic, the built-in one). By default this only creates a request that the owner approves; then poll maintenance_request_status. Switching sets the owner's own color, font, glow and background adjustments aside (the owner can undo in Admin > Appearance). Content is never changed: a skin is only a look.",
    input: SKIN_ARG, run: level3("skin_activate"),
  },
  {
    name: "skin_remove", level: 3, title: "Remove an installed skin",
    description: "Asks to remove an installed skin's files. By default this only creates a request that the owner approves; then poll maintenance_request_status. Content never changes. If it was the active skin, the basic skin applies and the owner's adjustments are kept.",
    input: SKIN_ARG, run: level3("skin_remove"),
  },
  {
    name: "font_set", level: 3, title: "Change the fonts of the site",
    description: "Asks to change the font of titles and/or of body text (Admin > Appearance > Fonts). Values: \"skin\" (the skin's own font, nothing retouched) or a value listed in maintenance_skin_status > fonts.available (a library font such as lib:lora, a system font such as sys:serif, or a font the owner uploaded). By default this only creates a request that the owner approves; then poll maintenance_request_status. The chosen font is always applied; tips (no bold version, a poster font used for long text) are advice, never a block. You cannot upload a font file: only the owner can, because they take responsibility for its license. The owner can undo with \"Back to the skin\".",
    input: FONT_SET_ARG, run: level3("font_set"),
  },
  {
    name: "skin_set_options", level: 3, title: "Change the colours and fonts of the site",
    description: "Sets colours (background, surface, textColor, accent, accent2 as #rrggbb; an empty string puts the skin's own colour back) and/or the fonts of titles and text (same values as maintenance_font_set), within the active skin: only what differs from the skin is kept, and nothing else is touched (no skin change, no content). A skin with a light and a dark mode needs mode. A colour that is hard to read is applied anyway; the site corrects it when displaying, and the answer carries readability tips. Follows the token's approval setting like the other changes: a request the owner approves, or done at once when the owner chose that. The owner can undo in Admin > Appearance. Nothing here can upload a font file.",
    input: SKIN_OPTIONS_ARG, run: level3("skin_set_options"),
  },
  { name: "module_update", level: 3, title: "Update a module", description: "Updates one module to its latest STABLE version (never a pre-release). By default this only creates a request that the owner approves; then poll request_status."+' Long action: it answers at once when it is quick; otherwise it answers {status:"started", requestId} and goes on in the background (your connection does not matter): follow it with maintenance_request_status until done or failed.', input: MODULE_ARG, run: level3("module_update") },
  { name: "modules_update_all", level: 3, title: "Update all modules", description: "Updates every module that has a STABLE update, one by one. By default this only creates a request that the owner approves; then poll request_status."+' Long action: it answers at once when it is quick; otherwise it answers {status:"started", requestId} and goes on in the background (your connection does not matter): follow it with maintenance_request_status until done or failed. The progress lists each module as it ends (updated or failed), and the final result lists every module.', input: NONE, run: level3("modules_update_all") },
  { name: "core_update", level: 3, title: "Update the core", description: "Updates Curiosa to the highest STABLE release, only if it is newer (never a release candidate or snapshot, never a downgrade). By default this only creates a request that the owner approves; then poll request_status. Make a backup first. On a site that runs in a container image nothing can be executed: it creates no request and returns the plan instead (the image tags in order and the exact commands the owner runs on the host).", input: NONE, run: level3("core_update") },
  { name: "module_uninstall", level: 3, title: "Uninstall a module", description: "Uninstalls a module: no more page, menu, tasks, tools or public route. By default its settings and data are KEPT aside (inert, never readable by anyone) and come back if the module is installed again; pass keepData=false to erase everything for good (irreversible). By default this only creates a request that the owner approves; then poll request_status.", input: UNINSTALL_ARG, run: level3("module_uninstall") },

  {
    name: "navigation_get", bare: true, level: 1, title: "Menu of the site",
    description: "The menu of the site as visitors get it, in display order: for each entry its label in every language, its target (a site page, a module page, a published content entry, a short link or an https address), whether it is shown, and its submenu. Also the languages and limits, and what can be added. The entries come in the exact shape navigation_set accepts. Read-only; no secret.",
    input: NAVIGATION_GET_INPUT, run: () => navigationGet(),
  },
  {
    name: "navigation_set", bare: true, level: 3, title: "Change the menu of the site",
    description: "Replaces the WHOLE menu (read it first with navigation_get, change the list, send all of it back: add = a new item, remove = leave it out, reorder = change the order). Targets must exist: a site page {page}, a module page {instance}, a published entry {instance, entry}, a known address {path: \"/contact\"}, or another site {externalUrl: \"https://...\"} (https only). Labels are written in every language of the site. 40 entries at most, 8 per submenu, two levels. Checked like the admin's menu form; nothing is saved if one entry is wrong and every problem is listed with an example. Follows the token's approval setting: a request the owner approves in Admin > AI assistants (poll maintenance_request_status), or done at once when the owner chose that, with the previous menu kept so the owner can restore it in Admin > Navigation. Never HTML or scripts.",
    input: NAVIGATION_SET_INPUT, run: level3("navigation_set"),
  },
  {
    name: "home_sections_list", bare: true, level: 1, title: "Home page sections",
    description: "The sections of the home page in order: kind (module section or text block), the module and instance it comes from, its title, its options, size, and whether it is shown. Also what can be added: the sections offered by the installed modules (banner, latest entries of a list...) with their options, the kinds of text block, and the languages and limits. The sections come in the shape home_sections_set accepts. Read-only; no secret.",
    input: HOME_LIST_INPUT, run: () => homeSectionsList(),
  },
  {
    name: "home_sections_set", bare: true, level: 3, title: "Change the home page",
    description: "Replaces the WHOLE home page (read it first with home_sections_list). A section that stays is sent as {id} alone; remove = leave it out; reorder = change the order; add = {instance, section, options?, size?, isolated?} for a section a module offers, or {block: {kind, title, text, buttonLabel, buttonUrl, images...}} for a text block with every language of the site. Plain text only: never HTML, scripts or styles; images are pictures of the site or https; links are pages of the site or https. 30 sections at most. Nothing is saved if one section is wrong and every problem is listed. Follows the token's approval setting like the menu, with the previous home page kept so the owner can restore it in Admin > Home.",
    input: HOME_SET_INPUT, run: level3("home_sections_set"),
  },
];

/** Catalogue statique (nom, niveau, droits) : sert à l'admin, aux tests et à la documentation. */
export const MAINTENANCE_TOOLS = DEFS.map((d) => ({ name: toolName(d), level: d.level, readOnly: d.readOnly ?? d.level === 1, destructive: DESTRUCTIVE_LEVEL3.has(d.name), request: d.level === 3 }));

export const maintenanceToolProvider: McpToolProvider = {
  id: "maintenance",
  async list() {
    return DEFS.map((d): McpTool => ({
      name: toolName(d),
      title: d.title,
      description: `[Maintenance, level ${d.level}] ${d.description}`,
      readOnly: d.readOnly ?? d.level === 1,
      // Aucune de ces actions n'est active par défaut pour un jeton ordinaire ; le profil « Maintenance » accorde le niveau 1 (lecture) et rien d'autre.
      default: d.default ?? false,
      // The menu and home page readers are not part of the old "Maintenance" profile (it only watches the health of the site).
      profileDefault: d.level === 1 && !d.bare,
      destructive: DESTRUCTIVE_LEVEL3.has(d.name),
      // Level 3 = a request the owner approves (or an action done at once when the owner chose so): not a deletion.
      request: d.level === 3,
      input: d.input,
      source: MAINTENANCE_SOURCE,
      // Niveau 2 et 3 : l'action se consigne elle-même dans l'audit (`mcp.maintenance.<outil>`), avec son résultat.
      audited: true,
      call: async (args, actor) => redactDeep(await d.run.call(d, args, actor)),
    }));
  },
};
