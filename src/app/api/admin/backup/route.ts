import { createBackup } from "@/core/backup/export";
import { MIN_PASSWORD_LENGTH } from "@/core/backup/crypto";
import { guardOwner } from "@/core/backup/guard";
import { currentUser, audit } from "@/core/permissions";
import { opIdOf, secretKeyPart, trackOperation } from "@/core/operations/run";

export const dynamic = "force-dynamic";

/** Une sauvegarde en un clic : le mot de passe est choisi ICI, il chiffre le fichier et n'est conservé nulle part. */
export async function POST(request: Request) {
  const denied = await guardOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (password !== String(form?.get("confirm") ?? "")) return Response.json({ ok: false, error: "mismatch" }, { status: 400 });
  if (password.length < MIN_PASSWORD_LENGTH) return Response.json({ ok: false, error: "too-short" }, { status: 400 });
  const email = (await currentUser())?.email ?? "owner";
  // Suivi d'opération. La clé dépend du mot de passe : deux personnes qui choisissent des mots de passe différents n'obtiennent jamais le fichier de l'autre ;
  // un double clic avec le même mot de passe rejoint la sauvegarde en cours.
  const run = await trackOperation({ email }, { kind: "backup", key: `backup:${secretKeyPart(password)}`, opId: opIdOf(form?.get("_op")) }, () => createBackup(password));
  if (run.busy) return Response.json({ ok: false, error: "busy" }, { status: 409 });
  const { buffer, filename } = run.result;
  if (!run.joined) await audit(email, "backup.create");
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store", "content-length": String(buffer.length) },
  });
}
