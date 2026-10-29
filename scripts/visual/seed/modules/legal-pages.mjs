// Mentions légales : réponses fictives à toutes les étapes (pays « autre », éditeur personne, adresse d'exemple), puis publication (pages /legal/…, lien de pied de page).
export default async function legal(h) {
  const { ctx, dir } = await h.raw("legal-pages");
  const A = await import(`${dir}/answers.mjs`), Data = await import(`${dir}/data.mjs`), Facts = await import(`${dir}/facts.mjs`);
  const values = {
    country: { country: "BE" },
    who: { status: "person", name: "Camille Exemple", email: "contact@example.org" },
    address: { address: "12 rue de l'Exemple\n1000 Ville", phone: "+32 2 123 45 67" },
    business: { legalForm: "SRL", regNumber: "0123.456.789", vat: "", capital: "1 000 €", director: "Camille Exemple" },
    host: { hostName: "Hébergeur d'exemple SA", hostAddress: "1 avenue du Serveur\n75000 Ville", hostPhone: "+33 1 23 45 67 89", hostCountry: "" },
    collect: { collect_messages: "on", thirdPartyNames: "", listTool: "", unknownExt: "none", otherCollect: "" },
    keep: { retention: "y1" },
    sells: { sells: "no", sellsWhere: "" },
  };
  for (const id of ["country", "who", "address", "business", "host", "collect", "keep", "sells"]) {
    const facts = await Facts.gatherFacts(ctx);
    const a = A.withDefaults(await Data.readAnswers(ctx), facts);
    if (!A.stepById(id).applies(a)) continue;
    await h.act("legal-pages", "saveStep", { step: id, ...values[id] });
  }
  await h.act("legal-pages", "publish", { ack: "on" });
}
