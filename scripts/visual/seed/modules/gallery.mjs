// Galeries : modèle « rétrospectives », 3 albums publiés (un de 14 photos avec légendes, un de 5 en portrait/paysage mêlés, un « externe » vers un autre service), un brouillon, une demande de retrait en attente (admin).
import { pathToFileURL } from "node:url";
export default async function gallery(h) {
  await h.act("gallery", "chooseTemplate", { id: "retro" });
  const { ctx, dir } = await h.raw("gallery");
  const D = await import(pathToFileURL(`${dir}/data.mjs`).href);
  const idOf = (r) => /album=([^&]+)/.exec(r.redirect)[1];
  async function album(title, date, desc, n, startVariant, status = "published") {
    const r = await h.act("gallery", "saveAlbum", { title, date, desc, mode: "hosted", status: "draft" });
    const id = idOf(r);
    const a = await D.getAlbum(ctx, id);
    const items = [];
    for (let i = 0; i < n; i++) {
      const portrait = i % 4 === 3, wide = i % 5 === 4;
      const w = portrait ? 800 : 1200, hgt = portrait ? 1100 : wide ? 600 : 800;
      const full = await h.img(startVariant + i, w, hgt), thumb = await h.img(startVariant + i, 480, Math.round(480 * hgt / w));
      items.push({ id: `p${startVariant}x${i}a`.slice(0, 12), caption: i % 3 === 0 ? `Légende de la photo ${i + 1}` : "", alt: `Photo de démonstration ${i + 1}`, hidden: false, full, thumb, url: "", turl: "", w, h: hgt, bytes: 100000, tbytes: 20000, name: `photo-${i + 1}.jpg`, at: h.NOW.getTime() });
    }
    await D.writePhotos(ctx, a, items);
    await D.refreshAlbum(ctx, a, items);
    if (status === "published") await h.act("gallery", "publish", { id });
    return id;
  }
  await album("Journée portes ouvertes", "2026-05-24", "Les moments forts de la journée portes ouvertes : démonstrations, ateliers et rencontres.", 14, 0);
  await album("Atelier de printemps", "2026-04-12", "Quelques images de l'atelier.", 5, 3);
  await album("Soirée de lancement", "2026-02-02", "Les coulisses de la soirée.", 1, 6);
  const ext = await h.act("gallery", "saveAlbum", { title: "Album chez un autre service", date: "2026-01-10", desc: "Cet album est hébergé ailleurs.", mode: "external", link: "https://example.org/album", status: "draft" });
  await h.act("gallery", "publish", { id: idOf(ext) });
  await h.act("gallery", "saveAlbum", { title: "Brouillon d'album", date: "2026-06-01", desc: "Pas encore publié.", mode: "hosted", status: "draft" });
}
