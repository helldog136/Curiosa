/**
 * RACINE DE COMPOSITION : l'endroit unique où les services génériques du cœur sont reliés aux
 * fonctionnalités (modules, moteur de contenu).
 *
 *   src/core/services/   les HELPERS que le cœur offre (QR, MCP, stockage, sujets, envois) —
 *                        génériques, ils ne connaissent ni les modules ni le contenu
 *   (aucun module dans ce dépôt : les fonctionnalités vivent dans `curiosa-extras` et s'installent comme des modules)
 *
 * Ce fichier dit, par exemple, d'où le service MCP tire ses outils. Pour brancher une nouvelle source
 * d'outils, on l'ajoute ici — jamais dans le service.
 */
import { contentToolProvider } from "@/core/content/mcp";
import { MAINTENANCE_TOOLS, maintenanceToolProvider } from "@/core/maintenance/tools";
import { rawgToolProvider } from "@/core/rawgMcp";
import { redirectsToolProvider } from "@/core/redirectMcp";
import { journalToolProvider } from "@/core/journalMcp";
import { setupToolProvider } from "@/core/siteMcp";
import { overlaySkinsToolProvider } from "@/core/overlaySkinsMcp";
import { getInstanceLabeler } from "@/core/modules/labels";
import { mcpInstanceKey, moduleActionProvider } from "@/core/modules/mcpProvider";
import { getActiveInstances } from "@/core/modules/registry";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { getSetting, getSiteConfig } from "@/core/settings";

/** Outils propres à la plateforme (pas à un module) : de quoi s'orienter sur le site. */
const siteToolProvider: McpToolProvider = {
  id: "site",
  async list() {
    const config = await getSiteConfig();
    const labeler = await getInstanceLabeler("en", config.defaultLocale);
    return [
      {
        name: "site_info",
        title: "Site info",
        description: "Name, languages and the list of module instances of this site.",
        readOnly: true,
        default: true,
        destructive: false,
        input: { type: "object" },
        source: "core",
        call: async () => ({
          name: config.name,
          defaultLocale: config.defaultLocale,
          locales: config.locales,
          instances: (await getActiveInstances()).map(({ instance, mod }) => ({
            key: instance.key,
            module: mod.manifest.id,
            name: labeler.label(instance),
            path: instance.basePath,
            hasEntries: !!mod.manifest.content,
          })),
        }),
      },
    ];
  },
};

/** Les fournisseurs d'outils MCP de ce site, dans l'ordre. */
export const mcpProviders: McpToolProvider[] = [siteToolProvider, maintenanceToolProvider, redirectsToolProvider, journalToolProvider, setupToolProvider, rawgToolProvider, overlaySkinsToolProvider, moduleActionProvider, contentToolProvider];

/** The providers whose tools come from the installed modules (computing them loads every module). */
const MODULE_PROVIDERS = new Set<McpToolProvider>([moduleActionProvider, contentToolProvider]);
/** Names of the tools that belong to the core and do not depend on the modules: `maintenance_*` (a fixed list) and the other fixed core tools. */
const CORE_TOOL_NAMES = new Set<string>(MAINTENANCE_TOOLS.map((t) => t.name));

/**
 * Catalogue complet pour l'admin : tous les outils, y compris ceux d'une instance qui s'est retirée du MCP
 * (signalés), pour que l'administrateur voie et règle chaque action de chaque module.
 */
export async function listMcpToolCatalogue(): Promise<(McpTool & { instanceOptedOut: boolean })[]> {
  const all = (await Promise.all(mcpProviders.map((p) => p.list()))).flat();
  return Promise.all(all.map(async (tool) => ({ ...tool, instanceOptedOut: !!tool.instanceId && (await getSetting<boolean>(mcpInstanceKey(tool.instanceId))) === false })));
}

/**
 * Tous les outils MCP disponibles, en respectant le retrait d'une instance (« Proposer ses actions à l'API MCP »).
 * `hint.name`: the tool about to be called. The tools of the core (maintenance, site, redirects…) are known without loading any module, so when the name is one of them
 * the module providers are not asked: a maintenance call right after a restart no longer loads the 70 modules of the site just to find its own tool.
 */
export async function listMcpTools(hint?: { name?: string }): Promise<McpTool[]> {
  const providers = hint?.name && CORE_TOOL_NAMES.has(hint.name) ? mcpProviders.filter((p) => !MODULE_PROVIDERS.has(p)) : mcpProviders;
  const all = (await Promise.all(providers.map((p) => p.list()))).flat();
  // The "withdrawn from MCP" settings are read at the same time, not one after the other.
  const hidden = await Promise.all(all.map(async (tool) => !!tool.instanceId && (await getSetting<boolean>(mcpInstanceKey(tool.instanceId))) === false));
  return all.filter((_, i) => !hidden[i]);
}
