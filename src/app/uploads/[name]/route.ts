import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { mimeFor, UPLOAD_NAME_RE } from "@/core/uploads";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!UPLOAD_NAME_RE.test(name)) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(UPLOADS_DIR, name));
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mimeFor(name),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
