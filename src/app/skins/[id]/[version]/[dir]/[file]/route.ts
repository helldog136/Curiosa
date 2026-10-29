import fs from "node:fs";
import { Readable } from "node:stream";
import { assetHeaders, resolveSkinAsset } from "@/core/skins/serve";

/**
 * Polices et images embarquées d'un skin installé : /skins/<id>/<version>/fonts|images/<fichier>. Même origine que le site : aucune ressource de skin
 * n'est chargée d'ailleurs. Voir core/skins/serve.ts pour ce qui est servi (et ce qui ne l'est jamais).
 */
type Ctx = { params: Promise<{ id: string; version: string; dir: string; file: string }> };

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function GET(_req: Request, { params }: Ctx) {
  const { id, version, dir, file } = await params;
  const asset = resolveSkinAsset(id, version, dir, file);
  if (!asset) return NOT_FOUND();
  return new Response(Readable.toWeb(fs.createReadStream(asset.file)) as ReadableStream, { headers: assetHeaders(asset) });
}

export async function HEAD(_req: Request, { params }: Ctx) {
  const { id, version, dir, file } = await params;
  const asset = resolveSkinAsset(id, version, dir, file);
  return asset ? new Response(null, { headers: assetHeaders(asset) }) : NOT_FOUND();
}
