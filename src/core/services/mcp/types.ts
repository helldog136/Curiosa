import type { JsonSchemaLite } from "@/core/modules/types";
import type { ToolRequirement } from "./ownerCeiling";

/** Qui appelle : le nom du jeton et son identifiant (pour les réglages propres à un jeton). */
export type McpActor = { name: string; tokenId?: string; /** (0.46.0) The user who owns the calling access (a personal AI); absent for an independent access. Resolved from the access row, never from the request. */ ownerId?: string };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** Accordée par défaut aux nouveaux jetons (le module décide) ; l'admin peut accorder/retirer, jeton par jeton. */
  default: boolean;
  /** Défaut pour un jeton « maintenance » (access.ts). Seuls les outils de maintenance le déclarent. */
  profileDefault?: boolean;
  /**
   * (0.46.0) What a PERSONAL AI needs from the person who owns it to see and call this tool (ownerCeiling.ts). Core tools are classified by name in `CORE_REQUIREMENTS`;
   * a tool of a module declares it with `mcp[].right`. No requirement = the tool is hidden from personal AIs. Independent accesses ignore it.
   */
  requires?: ToolRequirement;
  /** L'outil consigne lui-même son action dans l'audit : le serveur n'ajoute pas sa ligne générique. */
  audited?: boolean;
  /** Irreversible (deletion...): never granted by default, confirmation when granted. */
  destructive: boolean;
  /**
   * The tool does not act by itself: it creates a request the owner approves (or, when the owner chose "act without asking" for this access, acts at once).
   * Distinct from `destructive`: a request is not a deletion. Profiles, the rights page and the confirmations read this field.
   */
  request?: boolean;
  /** Language of `description` when the tool comes from a module (`en` when the module has no text in the site language): maintenance_my_access reports the gaps. */
  descriptionLang?: string;
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
