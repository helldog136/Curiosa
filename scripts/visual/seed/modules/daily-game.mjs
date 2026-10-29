// Jeu du jour : le pack de 30 questions fourni par le module (publié d'emblée) ; la question du jour suit son plan.
export default async function dailyGame(h) {
  await h.act("daily-game", "applyTemplate", { id: "games" });
}
