import fs from "node:fs";
import { Readable } from "node:stream";
import { fontHeaders, resolveFontAsset } from "@/core/fonts/serve";

/**
 * Polices servies par le site lui-même : la bibliothèque embarquée et les polices que la personne a envoyées. Même origine, aucune ressource d'ailleurs.
 * Voir core/fonts/serve.ts pour ce qui est servi (et ce qui ne l'est jamais). Public : un visiteur doit pouvoir lire ces fichiers.
 */
type Ctx = { params: Promise<{ file: string }> };

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function GET(_req: Request, { params }: Ctx) {
  const { file } = await params;
  const asset = resolveFontAsset(file);
  if (!asset) return NOT_FOUND();
  return new Response(Readable.toWeb(fs.createReadStream(asset.file)) as ReadableStream, { headers: fontHeaders(asset) });
}

export async function HEAD(_req: Request, { params }: Ctx) {
  const { file } = await params;
  const asset = resolveFontAsset(file);
  return asset ? new Response(null, { headers: fontHeaders(asset) }) : NOT_FOUND();
}
