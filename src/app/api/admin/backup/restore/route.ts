import { guardOwner, MAX_UPLOAD } from "@/core/backup/guard";
import { stash } from "@/core/backup/files";
import { openBackup, planModules } from "@/core/backup/restore";

export const dynamic = "force-dynamic";

/** Étape 1 : déchiffrer et vérifier le fichier, puis montrer ce qui va se passer (aucune donnée n'est encore touchée). */
export async function POST(request: Request) {
  const denied = await guardOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const password = String(form?.get("password") ?? "");
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: "no-file" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return Response.json({ ok: false, error: "too-large" }, { status: 413 });
  const opened = openBackup(Buffer.from(await file.arrayBuffer()), password);
  if (!opened.ok) return Response.json({ ok: false, error: opened.error }, { status: 400 });
  const { manifest } = opened.backup;
  return Response.json({
    ok: true,
    token: stash(opened.plain),
    site: manifest.site,
    createdAt: manifest.createdAt,
    frameworkVersion: manifest.frameworkVersion,
    counts: manifest.counts,
    modules: await planModules(opened.backup.data.modules),
  });
}
