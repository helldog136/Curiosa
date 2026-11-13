import { NextResponse } from "next/server";
import { currentUser, isMember } from "@/core/permissions";
import { looksLikeSvg, saveSvgUpload } from "@/core/logoUpload";
import { recordUpload } from "@/core/services/files";
import { MAX_VIDEO_BYTES, saveUpload, uploadProblem } from "@/core/services/uploads";
import { galleryAccept } from "@/core/gallery";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Connecté mais sans aucun accès à l'administration (aucun rôle utile) : pas d'envoi de fichier.
  if (!isMember(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  // Les logos (et seulement eux) peuvent être des SVG : nettoyés avant d'être enregistrés.
  if (form.get("kind") === "logo" && looksLikeSvg(buf)) {
    const svg = await saveSvgUpload(buf);
    return "url" in svg ? NextResponse.json({ url: svg.url }) : NextResponse.json(svg, { status: 400 });
  }
  // Un champ « son » (kind=audio) n'accepte que des sons : le type vient du contenu, jamais du nom ni du type annoncé.
  // Un champ « galerie » (kind=gallery, accept=image,video,audio) n'accepte que les genres que le module a déclarés : lus dans le contenu, jamais dans le nom.
  const kind = form.get("kind");
  const opts = kind === "audio" ? { only: "audio" as const } : kind === "gallery" ? { only: galleryAccept(String(form.get("accept") ?? "")) } : {};
  const url = await saveUpload(buf, opts);
  if (!url) return NextResponse.json({ error: opts.only ? uploadProblem(buf, opts) ?? "format" : "format" }, { status: 400 });
  // Revendiquable ensuite, par cette personne seulement et pour peu de temps, par un module qui a la permission « files » (services/files.ts).
  await recordUpload(url, user.id, buf.length);
  return NextResponse.json({ url });
}
