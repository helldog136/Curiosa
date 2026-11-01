// Mur des remerciements : deux groupes (modération, mécènes), une personne à l'honneur ce mois-ci, des petits mots, une personne masquée.
export default async function thanks(h) {
  const { cats, people } = h.shared;
  await h.set("thanks-wall", "category", cats.mods); await h.setBoth("thanks-wall", "groupTitle", "Modération", "Moderation");
  await h.set("thanks-wall", "category2", cats.patrons); await h.setBoth("thanks-wall", "groupTitle2", "Mécènes", "Patrons");
  await h.set("thanks-wall", "hide", cats.hidden);
  await h.setBoth("thanks-wall", "title", "Merci !", "Thank you!");
  await h.setBoth("thanks-wall", "intro", "Ces personnes rendent le projet possible.", "These people make the project possible.");
  const month = h.NOW.toISOString().slice(0, 7);
  await h.act("thanks-wall", "honorSave", { contactId: people.mods[0], month, why_fr: "Pour son aide constante tout au long de la saison.", why_en: "For constant help all season long." });
  for (const [i, id] of [...people.mods.slice(0, 4), ...people.patrons.slice(0, 3)].entries()) await h.act("thanks-wall", "messageSave", { contactId: id, text_fr: `Merci pour tout, personne n°${i + 1} !`, text_en: `Thanks for everything, person #${i + 1}!` });
}
