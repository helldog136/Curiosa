// Suggestions de jeux : une liste de jeux proposés avec des statuts variés (les jaquettes viennent des corrections de « game-covers »).
export default async function gameSuggestions(h) {
  await h.setBoth("game-suggestions", "title", "Suggérez un jeu", "Suggest a game");
  await h.setBoth("game-suggestions", "intro", "Proposez le prochain jeu de la communauté et votez pour vos préférés.", "Suggest the community's next game and vote for your favourites.");
  const G = [["Stellar Drift", "proposed"], ["Pixel Harbor", "proposed"], ["Moss and Lantern", "planned"], ["Tiny Rails", "accepted"], ["Cave Chronicles", "finished"], ["Echo Garden", "already_played"], ["Jeu sans jaquette connue", "proposed"]];
  for (const [title] of G) await h.act("game-suggestions", "addGame", { title, status: "proposed", note: "" });
  const { ctx } = await h.raw("game-suggestions");
  const rows = await ctx.api.store.list("games", { limit: 50 }).catch(() => []);
  void rows;
}
