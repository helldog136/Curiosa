import { createBackup } from "@/core/backup/export";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { guardOwner } from "@/core/backup/guard";
import { currentUser, audit } from "@/core/permissions";

export const dynamic = "force-dynamic";

/** Une sauvegarde en un clic : le mot de passe est choisi ICI, il chiffre le fichier et n'est conservé nulle part. */
export async function POST(request: Request) {
  const denied = await guardOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (password !== String(form?.get("confirm") ?? "")) return Response.json({ ok: false, error: "mismatch" }, { status: 400 });
  if (password.length < MIN_PASSWORD_LENGTH) return Response.json({ ok: false, error: "too-short" }, { status: 400 });
  const { buffer, filename } = await createBackup(password);
  await audit((await currentUser())?.email ?? "owner", "backup.create");
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store", "content-length": String(buffer.length) },
  });
}
