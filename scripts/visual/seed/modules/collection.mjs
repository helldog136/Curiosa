// Collections : « Projets » (cartes), « Ressources » (liste), « Raccourcis » (pastilles vers l'extérieur).
export default async function collection(h, row) {
  for (let i = 0; i < 6; i++) await h.entry(row, { fr: { title: `Projet ${["Aurore", "Brume", "Cèdre", "Dune", "Écume", "Flux"][i]}`, summary: "Une présentation en une phrase du projet.", body: "## Le projet\n\nUne description un peu plus longue, avec **du gras** et une liste :\n\n- objectif\n- méthode\n- résultat\n" }, en: { title: `Project ${["Dawn", "Mist", "Cedar", "Dune", "Foam", "Flow"][i]}`, summary: "A one-sentence presentation of the project.", body: "## The project\n\nA longer description." }, at: h.day(-20 - i * 6), position: i });
  const res = await h.extra("collection", { nickname: "Ressources", fr: "Ressources", en: "Resources", display: "list", basePath: "ressources" });
  for (let i = 0; i < 5; i++) await h.entry(res, { fr: { title: `Guide pratique n°${i + 1}`, summary: "À lire avant de commencer.", body: "Le contenu du guide." }, en: { title: `Practical guide #${i + 1}`, summary: "Read before you start.", body: "The guide content." }, at: h.day(-40 - i * 4), position: i });
  const sc = await h.extra("collection", { nickname: "Raccourcis", fr: "Raccourcis", en: "Shortcuts", display: "links", clickAction: "external", basePath: "raccourcis" });
  for (let i = 0; i < 6; i++) await h.entry(sc, { fr: { title: `Raccourci ${i + 1}` }, en: { title: `Shortcut ${i + 1}` }, url: `https://example.org/r${i + 1}`, at: h.day(-50 - i), position: i });
}
