import { currentUser, isOwner } from "@/core/permissions";
import { readOperation } from "@/core/operations/tracker";
import { CORE_OP_ID, coreUpdateSnapshot } from "@/core/operations/coreUpdate";
import { readUpdateState } from "@/core/updates/service";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } as const;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

/**
 * Avancement d'une opération longue (lecture seule). Le navigateur ne l'interroge que pendant une opération QU'IL a lancée.
 * Droits : le suivi d'une personne n'est lisible que par elle ou par un propriétaire ; inconnu, oublié et interdit donnent la MÊME réponse (404).
 * `core-update` (mise à jour du site) : propriétaire seulement, lue sur le disque (survit au redémarrage du site).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const { id } = await ctx.params;
  const owner = isOwner(user);
  if (id === CORE_OP_ID) return owner ? json({ ok: true, operation: coreUpdateSnapshot(readUpdateState()) }) : json({ ok: false, error: "not-found" }, 404);
  const op = readOperation(id, { email: user.email, owner });
  return op ? json({ ok: true, operation: op }) : json({ ok: false, error: "not-found" }, 404);
}
