import fs from "node:fs";
import { Readable } from "node:stream";
import { assetHeaders, rasterHeaders, rasterizeSvg, resolveSkinAsset } from "@/core/skins/serve";

/**
 * Polices et images embarquées d'un skin installé : /skins/<id>/<version>/fonts|images/<fichier>. Même origine que le site : aucune ressource de skin
 * n'est chargée d'ailleurs. Voir core/skins/serve.ts pour ce qui est servi (et ce qui ne l'est jamais).
 */
type Ctx = { params: Promise<{ id: string; version: string; dir: string; file: string }> };

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function GET(req: Request, { params }: Ctx) {
  const { id, version, dir, file } = await params;
  const asset = resolveSkinAsset(id, version, dir, file);
  if (!asset) return NOT_FOUND();
  // (0.40.0) `?raster=1` on a vector picture: the same picture as a PNG (see serve.ts)
  if (asset.type === "image/svg+xml" && new URL(req.url).searchParams.get("raster") === "1") {
    const png = await rasterizeSvg(asset.file);
    return png ? new Response(new Uint8Array(png), { headers: rasterHeaders(png.length) }) : NOT_FOUND();
  }
  return new Response(Readable.toWeb(fs.createReadStream(asset.file)) as ReadableStream, { headers: assetHeaders(asset) });
}

export async function HEAD(req: Request, { params }: Ctx) {
  const { id, version, dir, file } = await params;
  const asset = resolveSkinAsset(id, version, dir, file);
  if (asset?.type === "image/svg+xml" && new URL(req.url).searchParams.get("raster") === "1") return new Response(null, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
  return asset ? new Response(null, { headers: assetHeaders(asset) }) : NOT_FOUND();
}
