import { dropStash, unstash } from "@/core/backup/files";
import { guardOwner } from "@/core/backup/guard";
import { applyRestore, parseBackup } from "@/core/backup/restore";
import { currentUser } from "@/core/permissions";

export const dynamic = "force-dynamic";

/** Étape 2 : l'administrateur a confirmé (et, pour chaque module personnel, accepté ou non de l'installer). */
export async function POST(request: Request) {
  const denied = await guardOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { token?: string; confirm?: unknown } | null;
  const plain = unstash(String(body?.token ?? ""));
  if (!plain) return Response.json({ ok: false, error: "expired" }, { status: 410 });
  const parsed = parseBackup(plain);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const confirm = Array.isArray(body?.confirm) ? body.confirm.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  const actor = (await currentUser())?.email ?? "owner";
  const report = await applyRestore(parsed.backup, { confirmCustom: confirm, actor });
  dropStash(String(body?.token));
  return Response.json(report, { status: report.ok ? 200 : 500 });
}
