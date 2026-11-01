// Commandes : file ouverte (3 places), formules tarifées.
export default async function commissions(h) {
  await h.setBoth("commissions", "title", "Commandes", "Commissions");
  await h.setBoth("commissions", "intro", "Je prends quelques commandes à la fois. Choisissez une formule et envoyez votre demande.", "I take a few commissions at a time. Pick a package and send your request.");
  await h.act("commissions", "setMode", { id: "open" }).catch((e) => console.error(String(e.message)));
  await h.act("commissions", "saveQueue", { slots: "3", reopenOn: "", message: "" });
  for (const [i, [name, price, delay, includes]] of [["Croquis", "25 €", "3 jours", "Un croquis noir et blanc\nUne révision"], ["Illustration couleur", "80 €", "2 semaines", "Illustration complète\nDeux révisions\nFichier haute définition"], ["Série de quatre", "250 €", "6 semaines", "Quatre illustrations liées\nTrois révisions"]].entries())
    await h.act("commissions", "saveFormula", { id: "", name, price, delay, includes, position: String(i + 1), visible: "on" });
}
