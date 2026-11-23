import { can, currentUser } from "@/core/permissions";
import { readLatestCopy } from "@/core/backup/auto/store";
import { backupFilename } from "@/core/backup/format";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/**
 * Download of the latest automatic backup kept on the server (the same encrypted file that was e-mailed; docs/BACKUP.md). Same right as the manual backup (`core:backup`).
 * A plain GET (a link in the page): the answer is a file that only the passphrase opens, and a page of another site cannot read it.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!can(user, "core:backup")) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const copy = readLatestCopy();
  if (!copy) return Response.json({ ok: false, error: "none" }, { status: 404 });
  const filename = backupFilename((await getSiteConfig()).name, new Date(copy.at));
  return new Response(new Uint8Array(copy.content), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store", "content-length": String(copy.content.length) },
  });
}
