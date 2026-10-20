// Exécuté une fois au démarrage du serveur Node (pas dans le navigateur ni à l'edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Balayage de conversion (0.2.0, src/core/modules/legacySweep.ts), AVANT toute tâche planifiée : ce qui était « éteint » avant la 0.1.20 devient
  // « désinstallé, données gardées » (retireLegacyOff, à retirer en phase 3), les lignes de modules héritées sont converties sans réseau, les migrations
  // de données en attente tournent, puis le marqueur `core.legacyCleared` est posé. Borné à 20 s (Next attend `register` avant de servir) ; ne lève jamais.
  // Inachevé : le site public est servi normalement, l'admin l'explique, et le démarrage suivant reprend.
  try {
    const { runLegacySweep } = await import("@/core/modules/legacySweep");
    await runLegacySweep();
  } catch (error) {
    console.error("[legacy] startup conversion failed:", (error as Error)?.name);
  }
  // Rôles (0.2.0) : les trois rôles prédéfinis existent et chaque personne a celui de son niveau (`User.role`). Idempotent, ne lève jamais.
  const { initRoles } = await import("@/core/auth/roles");
  await initRoles();
  // Une mise à jour interrompue pendant le redémarrage (la tâche a été arrêtée avec l'ancien serveur) est conclue ici, sur la version qui tourne vraiment.
  try {
    const { reconcileInterruptedUpdate } = await import("@/core/updates/service");
    const done = reconcileInterruptedUpdate();
    if (done) console.log(`[updates] interrupted update concluded at startup: ${done}`);
  } catch (error) {
    console.error("[updates] reconcile failed:", (error as Error)?.message);
  }
  const { startUpdateScheduler } = await import("@/core/updates/scheduler");
  startUpdateScheduler();
  const { startTaskScheduler } = await import("@/core/services/scheduler");
  startTaskScheduler();
  // Reprise unique d'une clé RAWG saisie autrefois dans un module (ne lève jamais).
  const { importRawgKeyFromModules } = await import("@/core/services/rawg");
  await importRawgKeyFromModules();
}
