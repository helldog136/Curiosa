import { handleMcpRequest, methodNotAllowed } from "@/core/services/mcp/server";
import { listMcpTools } from "@/core/platform";

export const dynamic = "force-dynamic";

/**
 * Connexion par adresse secrète : `/api/mcp/<jeton>`, pour les clients qui ne savent saisir qu'une adresse (les
 * « connecteurs personnalisés » de claude.ai). Réservé aux jetons dont le propriétaire a activé l'option ; l'adresse EST le mot de passe.
 * Le jeton n'est utilisé que pour s'authentifier : jamais journalisé, jamais renvoyé.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return handleMcpRequest(request, listMcpTools, { token });
}

// La réponse à GET/DELETE ne dépend pas du jeton : elle ne dit rien sur sa validité.
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
