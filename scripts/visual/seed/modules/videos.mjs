// Vidéos : modèle « conférences », 12 vidéos publiées (adresses YouTube fictives, titres saisis : aucune recherche réseau), un brouillon, une série.
export default async function videos(h) {
  await h.act("videos", "applyTemplate", { template: "talks" });
  const T = ["Présentation de l'atelier", "Gravure : les bases", "Reliure japonaise pas à pas", "Visite du studio", "Questions des spectateurs", "Retour sur la saison", "Matériel conseillé", "Atelier enfants", "Conférence d'ouverture", "Démonstration d'impression", "Coulisses d'une exposition", "Table ronde"];
  const { ctx } = await h.raw("videos");
  const cats = (await ctx.api.store.list("cats", { limit: 20 })).map((r) => r.data.k);
  for (const [i, t] of T.entries()) {
    const id = `vid${String(i).padStart(8, "0")}`.slice(0, 11).padEnd(11, "x");
    await h.act("videos", "add", { url: `https://www.youtube.com/watch?v=${id}`, title: t, cat: String(cats[i % Math.max(1, cats.length)] ?? ""), state: "published" });
  }
  await h.act("videos", "add", { url: "https://www.youtube.com/watch?v=draftvideo1", title: "Brouillon de vidéo", state: "draft" });
  await h.act("videos", "seriesAdd", { name_fr: "Saison 1", name_en: "Season 1" });
}
