import type { JsonSchemaLite } from "@/core/modules/types";

/** Qui appelle : le nom du jeton et son identifiant (pour les réglages propres à un jeton). */
export type McpActor = { name: string; tokenId?: string };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** Accordée par défaut aux nouveaux jetons (le module décide) ; l'admin peut accorder/retirer, jeton par jeton. */
  default: boolean;
  /** Défaut pour un jeton « maintenance » (access.ts). Seuls les outils de maintenance le déclarent. */
  profileDefault?: boolean;
  /** L'outil consigne lui-même son action dans l'audit : le serveur n'ajoute pas sa ligne générique. */
  audited?: boolean;
  /** Irreversible (deletion...): never granted by default, confirmation when granted. */
  destructive: boolean;
  /**
   * The tool does not act by itself: it creates a request the owner approves (or, when the owner chose "act without asking" for this access, acts at once).
   * Distinct from `destructive`: a request is not a deletion. Profiles, the rights page and the confirmations read this field.
   */
  request?: boolean;
  input: JsonSchemaLite;
  /** D'où vient l'outil : « core », ou la clé d'une instance (affiché dans l'admin). */
  source: string;
  /** Si l'outil appartient à une instance : permet au cœur de respecter son retrait du MCP. */
  instanceId?: string;
  /** Journal central : le module de l'instance (pour ranger la ligne d'audit dans son historique). */
  moduleId?: string;
  call: (args: Record<string, unknown>, actor: McpActor) => Promise<unknown>;
};

/**
 * Un fournisseur d'outils MCP. Le MÉCANISME MCP (serveur, jetons, validation) ne sait pas d'où
 * viennent les outils : il appelle les fournisseurs qu'on lui donne (voir src/core/platform.ts).
 */
export type McpToolProvider = { id: string; list(): Promise<McpTool[]> };
