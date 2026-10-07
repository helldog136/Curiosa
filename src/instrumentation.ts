// Exécuté une fois au démarrage du serveur Node (pas dans le navigateur ni à l'edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startUpdateScheduler } = await import("@/core/updates/scheduler");
  startUpdateScheduler();
  const { startTaskScheduler } = await import("@/core/services/scheduler");
  startTaskScheduler();
}
