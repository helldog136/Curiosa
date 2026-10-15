// Exécuté une fois au démarrage du serveur Node (pas dans le navigateur ni à l'edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // TEMPORAIRE (retrait en 0.3.0) : AVANT toute tâche planifiée, ce qui était « éteint » avant la 0.1.20 devient « désinstallé, données gardées » (ne lève jamais).
  try {
    const { retireLegacyOff } = await import("@/core/modules/legacyOff");
    const done = await retireLegacyOff();
    if (done.modules.length || done.instances.length) console.log(`[modules] switched-off items set aside with their data kept: modules ${done.modules.join(", ") || "none"}; instances ${done.instances.length}`);
  } catch (error) {
    console.error("[modules] legacy off migration failed:", (error as Error)?.message);
  }
  const { startUpdateScheduler } = await import("@/core/updates/scheduler");
  startUpdateScheduler();
  const { startTaskScheduler } = await import("@/core/services/scheduler");
  startTaskScheduler();
  // Reprise unique d'une clé RAWG saisie autrefois dans un module (ne lève jamais).
  const { importRawgKeyFromModules } = await import("@/core/services/rawg");
  await importRawgKeyFromModules();
}
