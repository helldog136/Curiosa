// Mascotte : les phrases d'accueil fournies par le module, publiée sur toutes les pages. (Elle est animée : les captures la figent.)
export default async function mascot(h) {
  await h.act("mascot", "applyTemplate", { id: "welcome" });
  await h.act("mascot", "publish", { go: "1" });
}
