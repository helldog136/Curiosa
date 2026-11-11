import { getInstanceLabeler } from "@/core/modules/labels";
import { asAssistant, buildContext } from "@/core/modules/context";
import { getActiveInstances } from "@/core/modules/registry";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";
import { getSiteConfig } from "@/core/settings";
import { chain } from "@/core/i18n/audit.mjs";

/**
 * The description of a tool for the assistant: the plain string of the manifest is English; `i18n.<lang>["mcp.<tool>"]` translates it.
 * Requested language -> site main language -> the English string. Never another language by accident.
 */
export function toolDescription(manifest: { i18n?: Record<string, Record<string, string>> }, tool: string, english: string, locale: string, main: string): string {
  return toolDescriptionLang(manifest, tool, english, locale, main).text;
}

/** Same as `toolDescription`, and says which language the text is in (`en` when the module has no translation for the requested language or the site language). */
export function toolDescriptionLang(manifest: { i18n?: Record<string, Record<string, string>> }, tool: string, english: string, locale: string, main: string): { text: string; lang: string } {
  const translations: Record<string, string> = { en: english };
  for (const [lang, table] of Object.entries(manifest.i18n ?? {})) if (table[`mcp.${tool}`]) translations[lang] = table[`mcp.${tool}`]!;
  for (const lang of chain(locale, main) as string[]) if (translations[lang]?.trim()) return { text: translations[lang]!, lang };
  return { text: english, lang: "en" };
}

/** Granted by default to a new access? The module decides; otherwise read-only yes, writing no; a destructive action never. One rule, used by the tool list and by the catalogue sheets. */
export const toolGrantedByDefault = (decl: { readOnly?: boolean; default?: boolean; destructive?: boolean }): boolean => (decl.destructive ? false : (decl.default ?? decl.readOnly === true));

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
    const adminLocale = config.adminLocale ?? config.defaultLocale;
    const labeler = await getInstanceLabeler("en", config.defaultLocale);
    for (const { instance, mod } of await getActiveInstances()) {
      const label = labeler.label(instance);
      for (const decl of mod.manifest.mcp ?? []) {
        const handler = mod.def.mcp?.[decl.name];
        if (!handler) continue;
        const text = toolDescriptionLang(mod.manifest, decl.name, decl.description, adminLocale, config.defaultLocale);
        tools.push({
          name: `${instance.key}__${decl.name}`,
          title: `${label}: ${decl.name}`,
          description: `[${label}] ${text.text}`,
          descriptionLang: text.lang,
          readOnly: decl.readOnly === true,
          // Le module choisit ce qui est accordé d'office ; à défaut : la lecture seule oui, l'écriture non.
          default: toolGrantedByDefault(decl),
          destructive: decl.destructive === true,
          input: decl.input ?? { type: "object" },
          source: instance.key,
          instanceId: instance.id,
          call: async (args, actor) => handler(asAssistant(await buildContext(mod, instance, config.defaultLocale), actor.name), validateArgs(decl.input, args), actor),
          moduleId: mod.manifest.id,
        });
      }
    }
    return tools;
  },
};
