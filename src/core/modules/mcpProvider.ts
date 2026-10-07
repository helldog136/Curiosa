import { pickName } from "@/core/instances";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances } from "@/core/modules/registry";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";
import { getSiteConfig } from "@/core/settings";

/** Clé du réglage qui retire une instance de l'API MCP (case « Proposer ses actions à l'API MCP »). */
export const mcpInstanceKey = (instanceId: string) => `instance.${instanceId}.__mcp`;

/**
 * FOURNISSEUR D'OUTILS MCP — les actions déclarées par les modules.
 * Pour chaque instance active, chaque `mcp` du manifeste implémentée par le code du module devient
 * l'outil `<clé de l'instance>__<action>`. Les arguments sont validés selon le schéma déclaré avant
 * d'atteindre le module : il reçoit toujours des données conformes.
 */
export const moduleActionProvider: McpToolProvider = {
  id: "modules",
  async list() {
    const config = await getSiteConfig();
    const tools: McpTool[] = [];
    for (const { instance, mod } of await getActiveInstances()) {
      const label = pickName(instance, "en", config.defaultLocale);
      for (const decl of mod.manifest.mcp ?? []) {
        const handler = mod.def.mcp?.[decl.name];
        if (!handler) continue;
        tools.push({
          name: `${instance.key}__${decl.name}`,
          title: `${label}: ${decl.name}`,
          description: `[${label}] ${decl.description}`,
          readOnly: decl.readOnly === true,
          // Le module choisit ce qui est accordé d'office ; à défaut : la lecture seule oui, l'écriture non.
          default: decl.destructive ? false : (decl.default ?? decl.readOnly === true),
          destructive: decl.destructive === true,
          input: decl.input ?? { type: "object" },
          source: instance.key,
          instanceId: instance.id,
          call: async (args, actor) => handler(await buildContext(mod, instance, config.defaultLocale), validateArgs(decl.input, args), actor),
        });
      }
    }
    return tools;
  },
};
