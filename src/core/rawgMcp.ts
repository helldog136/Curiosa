import { buildContext } from "@/core/modules/context";
import { providerInstance } from "@/core/modules/dependencies";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";
import { COVERS_MODULE, COVERS_SERVICE } from "@/core/services/rawgHandover";

/**
 * ALIAS DES DEUX OUTILS DE L'ASSISTANT « JAQUETTES DE JEUX » — `rawg_covers_to_check` (lecture) et `rawg_cover_set` (écriture, jamais accordée d'office).
 *
 * Depuis la 0.3.0 ces outils appartiennent au module officiel « Jaquettes de jeux » : il les expose sous `<clé de l'instance>__rawg_covers_to_check` (le cœur n'a plus aucun code RAWG).
 * Ce fichier garde seulement les NOMS COURTS d'avant, pour que les jetons déjà délivrés et les consignes données à l'assistant continuent de marcher. Rien n'est recopié : la
 * description, le schéma des arguments, « lecture seule » et « accordé d'office ou non » sont lus dans le manifeste du module, les arguments sont validés par ce schéma
 * avant d'atteindre le module, et c'est le gestionnaire du module qui répond (mêmes règles, mêmes bornes, mêmes réponses). Module absent ou arrêté : les alias n'apparaissent pas.
 * Si l'instance du module est retirée de l'API MCP (case « Proposer ses actions à l'API MCP »), les alias le sont aussi.
 */
const ALIASES = ["rawg_covers_to_check", "rawg_cover_set"] as const;

export const rawgToolProvider: McpToolProvider = {
  id: "rawg",
  async list() {
    const provider = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
    if (!provider) return [];
    const tools: McpTool[] = [];
    for (const name of ALIASES) {
      const decl = (provider.mod.manifest.mcp ?? []).find((d) => d.name === name);
      if (!decl || typeof provider.mod.def.mcp?.[name] !== "function") continue;
      tools.push({
        name, title: name, description: decl.description, readOnly: decl.readOnly === true, destructive: decl.destructive === true,
        default: decl.destructive ? false : (decl.default ?? decl.readOnly === true),
        input: decl.input ?? { type: "object" },
        source: provider.instance.key, instanceId: provider.instance.id,
        // Le module est relu à chaque appel (il a pu être mis à jour ou retiré depuis la liste).
        call: async (args, actor) => {
          const now = await providerInstance(COVERS_SERVICE, COVERS_MODULE);
          const fn = now?.mod.def.mcp?.[name];
          if (!now || typeof fn !== "function") throw Object.assign(new Error("The Game covers module is not installed any more."), { expose: true });
          return fn(await buildContext(now.mod, now.instance), validateArgs(decl.input, args), actor);
        },
      });
    }
    return tools;
  },
};
