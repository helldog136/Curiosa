import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { UPLOADS_DIR } from "@/core/config";
import { isVideoName, mimeFor, UPLOAD_NAME_RE } from "@/core/services/uploads";

const HEADERS = { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "accept-ranges": "bytes" };

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!UPLOAD_NAME_RE.test(name)) return new Response("Not found", { status: 404 });
  const file = path.join(UPLOADS_DIR, name);
  let size: number;
  try { size = fs.statSync(file).size; } catch { return new Response("Not found", { status: 404 }); }
  const type = mimeFor(name);

  // Les vidéos se lisent par morceaux (en-tête Range) : sans cela, Safari refuse de les lire et aucun navigateur ne peut avancer dans la vidéo.
  const range = isVideoName(name) ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "") : null;
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...HEADERS, "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  if (isVideoName(name)) return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...HEADERS, "content-type": type, "content-length": String(size) } });
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { ...HEADERS, "content-type": type } });
}
