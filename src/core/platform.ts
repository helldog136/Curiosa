/**
 * RACINE DE COMPOSITION : l'endroit unique où les services génériques du cœur sont reliés aux
 * fonctionnalités (modules, moteur de contenu).
 *
 *   src/core/services/   les HELPERS que le cœur offre (QR, MCP, stockage, sujets, envois) —
 *                        génériques, ils ne connaissent ni les modules ni le contenu
 *   src/modules-builtin/ les FONCTIONNALITÉS de base, livrées comme des modules
 *   modules-community/   les FONCTIONNALITÉS installables
 *
 * Ce fichier dit, par exemple, d'où le service MCP tire ses outils. Pour brancher une nouvelle source
 * d'outils, on l'ajoute ici — jamais dans le service.
 */
import { contentToolProvider } from "@/core/content/mcp";
import { pickName } from "@/core/instances";
import { mcpInstanceKey, moduleActionProvider } from "@/core/modules/mcpProvider";
import { getActiveInstances } from "@/core/modules/registry";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { getSetting, getSiteConfig } from "@/core/settings";

/** Outils propres à la plateforme (pas à un module) : de quoi s'orienter sur le site. */
const siteToolProvider: McpToolProvider = {
  id: "site",
  async list() {
    const config = await getSiteConfig();
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
            name: pickName(instance, config.defaultLocale, config.defaultLocale),
            path: instance.basePath,
            hasEntries: !!mod.manifest.content,
          })),
        }),
      },
    ];
  },
};

/** Les fournisseurs d'outils MCP de ce site, dans l'ordre. */
export const mcpProviders: McpToolProvider[] = [siteToolProvider, moduleActionProvider, contentToolProvider];

/**
 * Catalogue complet pour l'admin : tous les outils, y compris ceux d'une instance qui s'est retirée du MCP
 * (signalés), pour que l'administrateur voie et règle chaque action de chaque module.
 */
export async function listMcpToolCatalogue(): Promise<(McpTool & { instanceOptedOut: boolean })[]> {
  const all = (await Promise.all(mcpProviders.map((p) => p.list()))).flat();
  return Promise.all(all.map(async (tool) => ({ ...tool, instanceOptedOut: !!tool.instanceId && (await getSetting<boolean>(mcpInstanceKey(tool.instanceId))) === false })));
}

/** Tous les outils MCP disponibles, en respectant le retrait d'une instance (« Proposer ses actions à l'API MCP »). */
export async function listMcpTools(): Promise<McpTool[]> {
  const all = (await Promise.all(mcpProviders.map((p) => p.list()))).flat();
  const out: McpTool[] = [];
  for (const tool of all) {
    if (tool.instanceId && (await getSetting<boolean>(mcpInstanceKey(tool.instanceId))) === false) continue;
    out.push(tool);
  }
  return out;
}
