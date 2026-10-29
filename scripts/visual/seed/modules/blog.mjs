// Blog : 14 billets (chaque billet porte un titre de niveau 6 : le rendu de ce niveau sous basic est ainsi vu par le harnais) (donc 2 pages de liste), français + anglais pour la plupart, avec couvertures, étiquettes, un billet mis en avant ; un second blog en liste ; un blog vide.
const TOPICS = [
  ["Les coulisses d'un atelier ouvert", "Behind the scenes of an open workshop"], ["Trois outils qui changent le quotidien", "Three tools that change daily life"], ["Carnet de bord : la saison commence", "Logbook: the season begins"],
  ["Pourquoi nous partageons nos brouillons", "Why we share our drafts"], ["Retour sur le week-end de la création", "Looking back at the makers' weekend"], ["Un mois de petits projets", "A month of small projects"],
  ["Ce que nous avons appris des erreurs", "What we learned from mistakes"], ["Le matériel que nous utilisons", "The gear we use"], ["Une journée type", "A typical day"], ["Questions fréquentes sur l'atelier", "Frequently asked questions about the workshop"],
  ["Nos lectures du moment", "What we are reading"], ["Prochaines étapes", "Next steps"], ["Merci à la communauté", "Thanks to the community"], ["Bienvenue sur le site", "Welcome to the site"],
];
const BODY = (t) => `## ${t}\n\nUn paragraphe d'introduction pour planter le décor, avec un peu de **texte en gras**, de l'*italique* et un [lien interne](/privacy).\n\n### Ce qui compte\n\n###### Rubrique de niveau 6\n\n- Une liste à puces, première idée\n- Une deuxième idée, un peu plus longue pour voir le retour à la ligne sur les petits écrans et comprendre comment le texte respire\n- Une troisième\n\n> Une citation courte, pour voir le style des citations dans un billet.\n\n1. Première étape\n2. Deuxième étape\n3. Troisième étape\n\nUn second paragraphe plus long : lorem ipsum n'est pas de mise ici, alors voici du texte français ordinaire qui s'étend sur plusieurs lignes pour que les largeurs de colonne, les interlignes et les marges soient bien visibles dans la comparaison d'images.\n\n\`code en ligne\` et un bloc :\n\n\`\`\`\nnpm run exemple\n\`\`\`\n\n| Colonne A | Colonne B |\n|---|---|\n| un | deux |\n| trois | quatre |\n`;
const BODY_EN = (t) => `## ${t}\n\nAn introduction paragraph to set the scene, with some **bold text**, *italics* and an [internal link](/en/privacy).\n\n### What matters\n\n###### Level 6 heading\n\n- A bullet list, first idea\n- A second idea, a bit longer to check wrapping on small screens\n- A third one\n\n> A short quote to see how quotes look in a post.\n\nA longer second paragraph of ordinary English text that runs over several lines so column widths, line heights and margins are visible in the image comparison.\n`;
export default async function blog(h, row) {
  await h.setBoth("blog", "title", "Journal de l'atelier", "Workshop journal").catch(() => {});
  for (let i = 0; i < TOPICS.length; i++) {
    const [fr, en] = TOPICS[i];
    await h.entry(row, {
      fr: { title: fr, summary: `Résumé du billet « ${fr} » : une ou deux phrases pour donner envie de lire la suite.`, body: BODY(fr) },
      en: i % 4 === 3 ? undefined : { title: en, summary: `Summary of “${en}”: a sentence or two to make you want to read on.`, body: BODY_EN(en) },
      at: h.day(-5 - i * 9), cover: i % 5 === 4 ? null : await h.img(i, 1200, 630), tags: [["atelier", "coulisses"], ["outils"], ["saison"]][i % 3], featured: i === 0,
    });
  }
  const journal = await h.extra("blog", { nickname: "Notes courtes", fr: "Notes courtes", en: "Short notes", display: "list", basePath: "notes" });
  for (let i = 0; i < 5; i++) await h.entry(journal, { fr: { title: `Note ${i + 1} : une idée en passant`, summary: "Une phrase d'explication.", body: "Un court texte.\n\nEt un second paragraphe." }, en: { title: `Note ${i + 1}: a passing idea`, summary: "One explanatory sentence.", body: "A short text." }, at: h.day(-2 - i * 3), cover: null });
  await h.extra("blog", { nickname: "Archives", fr: "Archives (vide)", en: "Archive (empty)", basePath: "archives" });
}
