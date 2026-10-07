import type { JsonSchemaLite } from "@/core/modules/types";

export type McpActor = { name: string };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: JsonSchemaLite;
  /** D'où vient l'outil : « core », ou la clé d'une instance (affiché dans l'admin). */
  source: string;
  /** Si l'outil appartient à une instance : permet au cœur de respecter son retrait du MCP. */
  instanceId?: string;
  call: (args: Record<string, unknown>, actor: McpActor) => Promise<unknown>;
};

/**
 * Un fournisseur d'outils MCP. Le MÉCANISME MCP (serveur, jetons, validation) ne sait pas d'où
 * viennent les outils : il appelle les fournisseurs qu'on lui donne (voir src/core/platform.ts).
 */
export type McpToolProvider = { id: string; list(): Promise<McpTool[]> };
