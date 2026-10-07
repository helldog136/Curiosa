import type { JsonSchemaLite } from "../modules/types";

/** Erreur d'une action MCP destinée à l'agent (message lisible, jamais de détail interne). */
export class McpToolError extends Error {}

/**
 * Valide les arguments d'une action selon un sous-ensemble de JSON Schema (objet plat,
 * types simples). Les propriétés inconnues sont refusées : un agent doit savoir que son
 * argument n'a pas été pris en compte plutôt que de croire qu'il l'a été.
 */
export function validateArgs(schema: JsonSchemaLite | undefined, args: unknown): Record<string, unknown> {
  const input = (args ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw new McpToolError("arguments must be an object");
  const props = schema?.properties ?? {};
  for (const key of Object.keys(input)) if (!(key in props)) throw new McpToolError(`unexpected argument "${key}"`);
  for (const key of schema?.required ?? []) if (input[key] === undefined || input[key] === null || input[key] === "") throw new McpToolError(`missing required argument "${key}"`);

  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    const fail = (what: string) => new McpToolError(`argument "${key}" must be ${what}`);
    switch (def.type) {
      case "string":
        if (typeof v !== "string") throw fail("a string");
        if (def.maxLength !== undefined && v.length > def.maxLength) throw fail(`at most ${def.maxLength} characters`);
        if (def.enum && !def.enum.includes(v)) throw fail(`one of: ${def.enum.join(", ")}`);
        break;
      case "number":
      case "integer":
        if (typeof v !== "number" || !Number.isFinite(v) || (def.type === "integer" && !Number.isInteger(v))) throw fail(def.type === "integer" ? "an integer" : "a number");
        if (def.minimum !== undefined && v < def.minimum) throw fail(`at least ${def.minimum}`);
        if (def.maximum !== undefined && v > def.maximum) throw fail(`at most ${def.maximum}`);
        break;
      case "boolean":
        if (typeof v !== "boolean") throw fail("a boolean");
        break;
      case "array":
        if (!Array.isArray(v) || v.length > 100 || !v.every((x) => typeof x === "string" && x.length <= 200)) throw fail("an array of short strings");
        break;
    }
    out[key] = v;
  }
  return out;
}
